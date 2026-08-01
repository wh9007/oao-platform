export type SessionStatus = "idle" | "recording" | "paused";

export type Settings = {
  autoDetect: boolean;
  autoTranslate: boolean;
  autoPlay: boolean;
  bilingual: boolean;
  multiLang: boolean;
  autoScroll: boolean;
  aiPolish: boolean;
  noiseReduction: boolean;
  vad: boolean;
  speakerDetection: boolean;
  timestamp: boolean;
  fullscreenSubtitle: boolean;
  presentationMode: boolean;
  dialogueMode: boolean;
  autoReconnect: boolean;
  autoRecover: boolean;
  autoSave: boolean;
};

export type TranslationResult = {
  language: string;
  label: string;
  text: string;
};

export type TranscriptLine = {
  id: string;
  source: string;
  translation: string;
  translations: TranslationResult[];
  language: string;
  time: string;
  speaker?: string;
};

export type HistorySession = {
  id: string;
  title: string;
  date: string;
  duration: string;
  lines: TranscriptLine[];
};
