export type ProviderName = "ollama" | "openai" | "google" | "azure" | "deepl" | "gemini" | "claude";

export interface TranslationLanguages {
  source: string;
  target: string;
  targets?: string[];
}

export interface TranscriptEvent {
  text: string;
  language?: string;
  isFinal: boolean;
  timestamp: number;
}

export interface TranslationEvent {
  text: string;
  sourceText?: string;
  language: string;
  isFinal: boolean;
  timestamp: number;
}

export interface TTSEvent {
  audio: Buffer;
  mimeType: string;
  timestamp: number;
}

export interface ProviderStatus {
  name: ProviderName;
  connected: boolean;
  reconnecting: boolean;
  error?: string;
}

export interface TranslationProvider {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  processAudioChunk(audio: Buffer): void;
  processTranscriptText?(text: string): void | Promise<void>;
  onTranscript(handler: (event: TranscriptEvent) => void): void;
  onTranslation(handler: (event: TranslationEvent) => void): void;
  onTTS(handler: (event: TTSEvent) => void): void;
  setLanguages(languages: TranslationLanguages): Promise<void>;
  getStatus(): ProviderStatus;
}
