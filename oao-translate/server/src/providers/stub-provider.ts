import type {
  ProviderName,
  ProviderStatus,
  TranscriptEvent,
  TranslationEvent,
  TranslationLanguages,
  TranslationProvider,
  TTSEvent
} from "./types";

export abstract class UnconfiguredProvider implements TranslationProvider {
  protected languages: TranslationLanguages = { source: "auto", target: "en" };

  protected constructor(private readonly name: ProviderName) {}

  async connect(): Promise<void> {
    throw new Error(`${this.name} provider is not configured`);
  }

  async disconnect(): Promise<void> {}

  processAudioChunk(_audio: Buffer): void {
    throw new Error(`${this.name} provider is not configured`);
  }

  onTranscript(_handler: (event: TranscriptEvent) => void): void {}

  onTranslation(_handler: (event: TranslationEvent) => void): void {}

  onTTS(_handler: (event: TTSEvent) => void): void {}

  async setLanguages(languages: TranslationLanguages): Promise<void> {
    this.languages = languages;
  }

  getStatus(): ProviderStatus {
    return {
      name: this.name,
      connected: false,
      reconnecting: false,
      error: `${this.name} provider is not configured`
    };
  }
}

export class GoogleProvider extends UnconfiguredProvider {
  constructor() {
    super("google");
  }
}

export class AzureProvider extends UnconfiguredProvider {
  constructor() {
    super("azure");
  }
}

export class DeepLProvider extends UnconfiguredProvider {
  constructor() {
    super("deepl");
  }
}

export class GeminiProvider extends UnconfiguredProvider {
  constructor() {
    super("gemini");
  }
}

export class ClaudeProvider extends UnconfiguredProvider {
  constructor() {
    super("claude");
  }
}
