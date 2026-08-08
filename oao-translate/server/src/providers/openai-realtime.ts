import WebSocket from "ws";
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

interface RealtimeEvent {
  type: string;
  delta?: string;
  transcript?: string;
  audio?: string;
  error?: { message?: string };
}

export class OpenAIRealtimeProvider implements TranslationProvider {
  private socket?: WebSocket;
  private languages: TranslationLanguages = { source: "auto", target: "en" };
  private transcriptHandlers: EventHandler<TranscriptEvent>[] = [];
  private translationHandlers: EventHandler<TranslationEvent>[] = [];
  private ttsHandlers: EventHandler<TTSEvent>[] = [];
  private connected = false;
  private reconnecting = false;
  private shouldReconnect = false;
  private reconnectAttempts = 0;
  private reconnectTimer?: NodeJS.Timeout;
  private lastError?: string;

  async connect(): Promise<void> {
    if (this.connected) return;
    if (!env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is required when using the OpenAI provider");
    }
    this.shouldReconnect = true;
    await this.openSocket();
  }

  async disconnect(): Promise<void> {
    this.shouldReconnect = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.reconnecting = false;
    this.socket?.close(1000, "Session closed");
    this.socket = undefined;
    this.connected = false;
  }

  processAudioChunk(audio: Buffer): void {
    if (!this.connected || this.socket?.readyState !== WebSocket.OPEN) {
      throw new Error("OpenAI Realtime provider is not connected");
    }
    this.send({
      type: "input_audio_buffer.append",
      audio: audio.toString("base64")
    });
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
    if (this.connected) this.sendSessionUpdate();
  }

  getStatus(): ProviderStatus {
    return {
      name: "openai",
      connected: this.connected,
      reconnecting: this.reconnecting,
      error: this.lastError
    };
  }

  private async openSocket(): Promise<void> {
    const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(env.OPENAI_REALTIME_MODEL)}`;
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(url, {
        headers: {
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
          "OpenAI-Beta": "realtime=v1"
        }
      });
      this.socket = socket;
      let settled = false;

      socket.once("open", () => {
        settled = true;
        this.connected = true;
        this.reconnecting = false;
        this.reconnectAttempts = 0;
        this.lastError = undefined;
        this.sendSessionUpdate();
        resolve();
      });
      socket.on("message", (data) => this.handleMessage(data.toString()));
      socket.once("error", (error) => {
        this.lastError = error.message;
        if (!settled) {
          settled = true;
          reject(error);
        }
      });
      socket.on("close", () => {
        this.connected = false;
        if (!settled) {
          settled = true;
          reject(new Error("OpenAI Realtime connection closed before it opened"));
        }
        this.scheduleReconnect();
      });
    });
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect || this.reconnectTimer) return;
    this.reconnecting = true;
    const delay = Math.min(1_000 * 2 ** this.reconnectAttempts, 30_000);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.openSocket().catch(() => this.scheduleReconnect());
    }, delay);
  }

  private sendSessionUpdate(): void {
    this.send({
      type: "session.update",
      session: {
        modalities: ["text", "audio"],
        input_audio_format: "pcm16",
        output_audio_format: "pcm16",
        input_audio_transcription: { model: "gpt-4o-transcribe" },
        turn_detection: { type: "server_vad", create_response: true },
        voice: "alloy",
        instructions: `You are a simultaneous interpreter. Transcribe speech in ${this.languages.source} and immediately translate it into ${this.languages.target}. Return only the translation in your text and spoken response. Preserve names, numbers, and intent.`
      }
    });
  }

  private send(payload: object): void {
    this.socket?.send(JSON.stringify(payload));
  }

  private handleMessage(raw: string): void {
    let event: RealtimeEvent;
    try {
      event = JSON.parse(raw) as RealtimeEvent;
    } catch {
      return;
    }
    const timestamp = Date.now();
    if (event.type === "error") {
      this.lastError = event.error?.message ?? "OpenAI Realtime API error";
      return;
    }
    if (
      event.type === "conversation.item.input_audio_transcription.delta" ||
      event.type === "conversation.item.input_audio_transcription.completed"
    ) {
      this.emit(this.transcriptHandlers, {
        text: event.delta ?? event.transcript ?? "",
        language: this.languages.source,
        isFinal: event.type.endsWith(".completed"),
        timestamp
      });
      return;
    }
    if (event.type === "response.audio_transcript.delta" || event.type === "response.audio_transcript.done") {
      this.emit(this.translationHandlers, {
        text: event.delta ?? event.transcript ?? "",
        language: this.languages.target,
        isFinal: event.type.endsWith(".done"),
        timestamp
      });
      return;
    }
    if (event.type === "response.audio.delta" && event.delta) {
      this.emit(this.ttsHandlers, {
        audio: Buffer.from(event.delta, "base64"),
        mimeType: "audio/pcm;rate=24000",
        timestamp
      });
    }
  }

  private emit<T>(handlers: EventHandler<T>[], event: T): void {
    handlers.forEach((handler) => handler(event));
  }
}
