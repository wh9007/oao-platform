import { OllamaLocalProvider } from "./ollama-local";
import { OpenAIRealtimeProvider } from "./openai-realtime";
import { RelayProvider } from "./relay-provider";
import {
  AzureProvider,
  ClaudeProvider,
  DeepLProvider,
  GeminiProvider,
  GoogleProvider
} from "./stub-provider";
import type { ProviderName, TranslationProvider } from "./types";

export function createProvider(name: ProviderName): TranslationProvider {
  switch (name) {
    case "ollama":
      return new OllamaLocalProvider();
    case "openai":
      return new OpenAIRealtimeProvider();
    case "google":
      return new GoogleProvider();
    case "azure":
      return new AzureProvider();
    case "deepl":
      return new DeepLProvider();
    case "gemini":
      return new GeminiProvider();
    case "claude":
      return new ClaudeProvider();
    case "relay":
      return new RelayProvider();
  }
}
