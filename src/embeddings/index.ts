import type { EmbeddingProvider, EmbeddingProviderConfig } from "../types.js";
import { OpenAIEmbeddingProvider } from "./openai.js";
import { OllamaEmbeddingProvider } from "./ollama.js";

export function createEmbeddingProvider(
  config: EmbeddingProviderConfig,
): EmbeddingProvider {
  switch (config.provider) {
    case "openai":
      return new OpenAIEmbeddingProvider(config);
    case "ollama":
      return new OllamaEmbeddingProvider(config);
    default:
      throw new Error(`Unknown embedding provider: ${config.provider}`);
  }
}

export type { EmbeddingProvider } from "../types.js";
