import type {
  ProviderStatus,
  TranscriptEvent,
  TranslationEvent,
  TranslationLanguages,
  TranslationProvider,
  TTSEvent,
} from "./types";

export class RelayProvider implements TranslationProvider {
  private languages: TranslationLanguages = { source: "auto", target: "en" };

  async connect(): Promise<void> {}

  async disconnect(): Promise<void> {}

  processAudioChunk(_audio: Buffer): void {}

  onTranscript(_handler: (event: TranscriptEvent) => void): void {}

  onTranslation(_handler: (event: TranslationEvent) => void): void {}

  onTTS(_handler: (event: TTSEvent) => void): void {}

  async setLanguages(languages: TranslationLanguages): Promise<void> {
    this.languages = languages;
  }

  getStatus(): ProviderStatus {
    return {
      name: "relay",
      connected: true,
      reconnecting: false,
    };
  }
}
