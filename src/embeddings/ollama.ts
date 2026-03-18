import type { EmbeddingProvider, EmbeddingProviderConfig } from "../types.js";

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly name = "ollama";
  readonly dimensions: number;
  private baseUrl: string;
  private model: string;

  constructor(config: EmbeddingProviderConfig) {
    this.model = config.model;
    this.dimensions = config.dimensions ?? 768;
    this.baseUrl = config.baseUrl ?? "http://localhost:11434";
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const embeddings: number[][] = [];

    // Ollama doesn't support batch embedding natively, process sequentially
    for (const text of texts) {
      const response = await fetch(`${this.baseUrl}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          input: text,
        }),
      });

      if (!response.ok) {
        throw new Error(
          `Ollama embedding failed: ${response.status} ${response.statusText}`,
        );
      }

      const data = (await response.json()) as { embeddings: number[][] };
      embeddings.push(data.embeddings[0]);
    }

    return embeddings;
  }
}
