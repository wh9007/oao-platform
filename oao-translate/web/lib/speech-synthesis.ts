export type VoiceOption = {
  id: string;
  label: string;
  lang: string;
};

function getSynth() {
  if (typeof window === "undefined") return null;
  return window.speechSynthesis ?? null;
}

export function isSpeechSynthesisSupported(): boolean {
  return !!getSynth() && typeof SpeechSynthesisUtterance !== "undefined";
}

export function waitForVoices(timeoutMs = 2500): Promise<SpeechSynthesisVoice[]> {
  const synth = getSynth();
  if (!synth) return Promise.resolve([]);

  const existing = synth.getVoices();
  if (existing.length > 0) return Promise.resolve(existing);

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      synth.removeEventListener("voiceschanged", finish);
      resolve(synth.getVoices());
    };

    synth.addEventListener("voiceschanged", finish);
    setTimeout(finish, timeoutMs);
  });
}

export async function listVoiceOptions(): Promise<VoiceOption[]> {
  const voices = await waitForVoices();
  return voices.map((voice) => ({
    id: voice.voiceURI || voice.name,
    label: `${voice.name} (${voice.lang})${voice.default ? " · 默认" : ""}`,
    lang: voice.lang,
  }));
}

function pickVoiceById(voiceId: string, langHint?: string): SpeechSynthesisVoice | null {
  const synth = getSynth();
  if (!synth) return null;
  const voices = synth.getVoices();
  if (!voices.length) return null;

  if (voiceId) {
    const matched =
      voices.find((voice) => voice.voiceURI === voiceId) ||
      voices.find((voice) => voice.name === voiceId);
    if (matched) return matched;
  }

  const hint = (langHint || "").toLowerCase();
  if (hint.startsWith("zh") || hint.includes("中文")) {
    return (
      voices.find((voice) => voice.lang.toLowerCase().startsWith("zh-cn")) ||
      voices.find((voice) => voice.lang.toLowerCase().startsWith("zh")) ||
      voices.find((voice) => /chinese|huihui|xiaoxiao|yunxi|kangkang/i.test(voice.name)) ||
      null
    );
  }
  if (hint.startsWith("en")) {
    return voices.find((voice) => voice.lang.toLowerCase().startsWith("en")) || null;
  }
  if (hint.startsWith("ja")) {
    return voices.find((voice) => voice.lang.toLowerCase().startsWith("ja")) || null;
  }

  return voices.find((voice) => voice.default) || voices[0] || null;
}

export type SpeakOptions = {
  voiceId?: string;
  langHint?: string;
  rate?: number;
  pitch?: number;
  volume?: number;
};

export async function speakText(text: string, options: SpeakOptions = {}): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("没有可朗读的内容");

  const synth = getSynth();
  if (!synth) throw new Error("当前浏览器不支持语音朗读");

  await waitForVoices();
  synth.cancel();
  if (synth.paused) synth.resume();

  const utterance = new SpeechSynthesisUtterance(trimmed);
  const voice = pickVoiceById(options.voiceId || "", options.langHint);
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  } else if (options.langHint) {
    utterance.lang = options.langHint;
  }

  utterance.rate = Math.min(2, Math.max(0.5, options.rate ?? 1));
  utterance.pitch = Math.min(2, Math.max(0, options.pitch ?? 1));
  utterance.volume = Math.min(1, Math.max(0, options.volume ?? 1));

  await new Promise<void>((resolve, reject) => {
    utterance.onend = () => resolve();
    utterance.onerror = (event) => {
      reject(new Error(event.error || "speech-synthesis-failed"));
    };
    synth.speak(utterance);
  });
}

export function stopSpeaking(): void {
  getSynth()?.cancel();
}
