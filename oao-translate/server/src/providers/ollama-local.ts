import { env } from "../config/env";
import type {
  ProviderStatus,
  TranscriptEvent,
  TranslationEvent,
  TranslationLanguages,
  TranslationProvider,
  TTSEvent
} from "./types";

type EventHandler<T> = (event: T) => void;

const PROCESS_INTERVAL_MS = 3200;
const MIN_AUDIO_BYTES = 800;

export class OllamaLocalProvider implements TranslationProvider {
  private languages: TranslationLanguages = { source: "auto", target: "zh" };
  private transcriptHandlers: EventHandler<TranscriptEvent>[] = [];
  private translationHandlers: EventHandler<TranslationEvent>[] = [];
  private ttsHandlers: EventHandler<TTSEvent>[] = [];
  private audioChunks: Buffer[] = [];
  private connected = false;
  private processing = false;
  private processTimer?: NodeJS.Timeout;
  private processScheduled = false;
  private lastError?: string;

  async connect(): Promise<void> {
    if (this.connected) return;
    const response = await fetch(`${env.OLLAMA_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(5000)
    }).catch(() => null);
    if (!response?.ok) {
      throw new Error(
        `无法连接本地 Ollama（${env.OLLAMA_BASE_URL}）。请确认 Ollama 已启动并可用。`
      );
    }
    this.connected = true;
    this.lastError = undefined;
    this.processTimer = setInterval(() => {
      void this.processBufferedAudio();
    }, PROCESS_INTERVAL_MS);
  }

  async disconnect(): Promise<void> {
    if (this.processTimer) clearInterval(this.processTimer);
    this.processTimer = undefined;
    this.audioChunks = [];
    this.connected = false;
    this.processing = false;
  }

  processAudioChunk(audio: Buffer): void {
    if (!this.connected) {
      throw new Error("Ollama local provider is not connected");
    }
    if (audio.length === 0) return;
    this.audioChunks.push(audio);
    this.scheduleProcessAudio();
  }

  processTranscriptText(
    text: string,
    options?: { speaker?: string; dialogueRole?: "self" | "guest" }
  ): void {
    const transcript = text.trim();
    if (!transcript) return;
    void this.publishTranscriptAndTranslations(transcript, options);
  }

  async translateText(text: string, targetCode: string): Promise<string> {
    const trimmed = text.trim();
    if (!trimmed) return "";
    return this.translate(trimmed, targetCode);
  }

  onTranscript(handler: EventHandler<TranscriptEvent>): void {
    this.transcriptHandlers.push(handler);
  }

  onTranslation(handler: EventHandler<TranslationEvent>): void {
    this.translationHandlers.push(handler);
  }

  onTTS(handler: EventHandler<TTSEvent>): void {
    this.ttsHandlers.push(handler);
  }

  async setLanguages(languages: TranslationLanguages): Promise<void> {
    this.languages = languages;
  }

  getStatus(): ProviderStatus {
    return {
      name: "ollama",
      connected: this.connected,
      reconnecting: false,
      error: this.lastError
    };
  }

  private scheduleProcessAudio(): void {
    if (this.processScheduled || this.processing) return;
    this.processScheduled = true;
    setImmediate(() => {
      this.processScheduled = false;
      void this.processBufferedAudio();
    });
  }

  private async processBufferedAudio(): Promise<void> {
    if (this.processing || this.audioChunks.length === 0) return;
    this.processing = true;
    const merged = Buffer.concat(this.audioChunks);
    this.audioChunks = [];
    try {
      if (merged.length < MIN_AUDIO_BYTES) return;
      const transcript = await this.transcribe(merged);
      if (!transcript) return;
      await this.publishTranscriptAndTranslations(transcript);
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : "Ollama processing failed";
    } finally {
      this.processing = false;
      if (this.audioChunks.length > 0) {
        this.scheduleProcessAudio();
      }
    }
  }

  private async publishTranscriptAndTranslations(
    transcript: string,
    options?: { speaker?: string; dialogueRole?: "self" | "guest" }
  ): Promise<void> {
    const timestamp = Date.now();
    this.emit(this.transcriptHandlers, {
      text: transcript,
      language: this.languages.source,
      speaker: options?.speaker || (dialogueRole === "guest" ? "对方" : dialogueRole ? "我方" : undefined),
      isFinal: true,
      timestamp
    });

    const targetsConfigured =
      (this.languages.targets?.filter(Boolean).length ?? 0) > 0 || !!(this.languages.target || "").trim();

    let dialogueRole = options?.dialogueRole;
    if (!dialogueRole && targetsConfigured) {
      dialogueRole = this.inferDialogueRole(transcript);
    }

    const isGuest = dialogueRole === "guest";
    if (isGuest) {
      const sourceTarget = this.resolveSourceLanguageCode(transcript);
      if (sourceTarget) {
        const translation = await this.translate(transcript, sourceTarget);
        if (translation) {
          this.emit(this.translationHandlers, {
            text: translation,
            sourceText: transcript,
            language: sourceTarget,
            isFinal: true,
            timestamp: Date.now()
          });
        }
      }
      return;
    }

    const targets = this.getTargetLanguages(transcript);
    for (const target of targets) {
      const translation = await this.translate(transcript, target);
      if (!translation) continue;
      this.emit(this.translationHandlers, {
        text: translation,
        sourceText: transcript,
        language: target,
        isFinal: true,
        timestamp: Date.now()
      });
    }
  }

  private resolveSourceLanguageCode(sourceText?: string): string {
    const source = (this.languages.source || "auto").toLowerCase();
    if (source !== "auto") return source.slice(0, 2);
    if (sourceText && /[\u4e00-\u9fff]/.test(sourceText)) return "zh";
    return "zh";
  }

  private inferDialogueRole(text: string): "self" | "guest" {
    const chinese = /[\u4e00-\u9fff]/.test(text);
    const latin = /[a-zA-Z]/.test(text);
    const targets = this.getTargetLanguages(text);
    if (!targets.length) return "self";
    if (chinese && !latin) return "self";
    if (latin && !chinese) return "guest";
    return chinese ? "self" : "guest";
  }

  private async transcribe(audio: Buffer): Promise<string> {
    const language = this.resolveWhisperLanguage();
    const isWav = audio.length > 12 && audio.subarray(0, 4).toString("ascii") === "RIFF";
    const mimeType = isWav ? "audio/wav" : "audio/webm";
    const fileName = isWav ? "chunk.wav" : "chunk.webm";
    const base64 = audio.toString("base64");
    const dataUri = `data:${mimeType};base64,${base64}`;

    const jsonAttempts = [
      { model: env.OLLAMA_WHISPER_MODEL, file: dataUri, language },
      { model: env.OLLAMA_WHISPER_MODEL, file: base64, language },
      { model: env.OLLAMA_WHISPER_MODEL, prompt: "", file: dataUri },
    ];

    for (const body of jsonAttempts) {
      try {
        const response = await fetch(`${env.OLLAMA_BASE_URL}/api/transcribe`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(env.OLLAMA_TIMEOUT_MS),
        });
        if (!response.ok) continue;
        const data = (await response.json()) as Record<string, string>;
        const text = (data.text || data.response || data.transcript || "").trim();
        if (text) return text;
      } catch {
        /* try next attempt */
      }
    }

    const form = new FormData();
    form.append("file", new Blob([audio], { type: mimeType }), fileName);
    form.append("model", env.OLLAMA_WHISPER_MODEL);
    if (language !== "auto") form.append("language", language);

    const response = await fetch(`${env.OLLAMA_BASE_URL}/api/transcribe`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(env.OLLAMA_TIMEOUT_MS),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Whisper 转写失败（HTTP ${response.status}）${detail ? `: ${detail.slice(0, 120)}` : ""}`);
    }
    const data = (await response.json()) as Record<string, string>;
    return (data.text || data.response || data.transcript || "").trim();
  }

  private getTargetLanguages(sourceText?: string): string[] {
    const targets = this.languages.targets?.map((item) => item.trim()).filter(Boolean);
    let list: string[];
    if (targets && targets.length > 0) {
      list = [...new Set(targets)];
    } else {
      const single = (this.languages.target || "").trim();
      list = single ? [single] : [];
    }
    const source = (this.languages.source || "auto").toLowerCase();
    const looksChinese = !!(sourceText && /[\u4e00-\u9fff]/.test(sourceText));
    return list.filter((code) => {
      const c = (code || "").toLowerCase();
      if (!c || c === "auto") return false;
      if (source !== "auto" && source.slice(0, 2) === c.slice(0, 2)) return false;
      if ((source.startsWith("zh") || looksChinese) && (c === "zh" || c.startsWith("zh"))) return false;
      return true;
    });
  }

  private async translate(text: string, targetCode: string): Promise<string> {
    const target = this.resolveTargetLabel(targetCode);
    const prompt = `You are a professional simultaneous interpreter. Translate the following into ${target} only. Rules:\n- Output ONLY the translation in ${target}\n- Do NOT include the source text\n- Do NOT add notes, labels, or Chinese unless ${target} is Chinese\n\nSource:\n${text}`;

    const response = await fetch(`${env.OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: env.OLLAMA_CHAT_MODEL,
        stream: false,
        messages: [{ role: "user", content: prompt }]
      }),
      signal: AbortSignal.timeout(env.OLLAMA_TIMEOUT_MS)
    });

    if (!response.ok) {
      throw new Error(`Ollama 翻译失败（HTTP ${response.status}）`);
    }

    const data = (await response.json()) as {
      message?: { content?: string };
      response?: string;
    };
    return (data.message?.content || data.response || "").trim();
  }

  private resolveTargetLabel(code: string): string {
    const normalized = (code || "").toLowerCase();
    const map: Record<string, string> = {
      auto: "English",
      zh: "Chinese",
      en: "English",
      ja: "Japanese",
      ko: "Korean",
      fr: "French",
      de: "German",
      es: "Spanish",
      it: "Italian",
      pt: "Portuguese",
      ru: "Russian",
      ar: "Arabic",
      th: "Thai",
      vi: "Vietnamese",
      id: "Indonesian",
      hi: "Hindi"
    };
    return map[normalized] || code;
  }

  private resolveWhisperLanguage(): string {
    const source = (this.languages.source || "auto").toLowerCase();
    if (source === "auto" || source === "auto detect") return "auto";
    if (source.startsWith("zh") || source.includes("中文")) return "zh";
    if (source.startsWith("en") || source.includes("english")) return "en";
    if (source.startsWith("ja")) return "ja";
    if (source.startsWith("ko")) return "ko";
    return source.slice(0, 2);
  }

  private emit<T>(handlers: EventHandler<T>[], event: T): void {
    handlers.forEach((handler) => handler(event));
  }
}
