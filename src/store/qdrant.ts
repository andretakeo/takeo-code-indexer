import { QdrantClient } from "@qdrant/js-client-rest";
import type { CodeChunk, SearchResult, VectorStore } from "../types.js";

export class QdrantStore implements VectorStore {
  private client: QdrantClient;
  private collectionName: string;

  constructor(url: string, collectionName: string, apiKey?: string) {
    this.client = new QdrantClient({ url, apiKey, checkCompatibility: false });
    this.collectionName = collectionName;
  }

  async initialize(dimensions: number): Promise<void> {
    const collections = await this.client.getCollections();
    const exists = collections.collections.some(
      (c) => c.name === this.collectionName,
    );

    if (!exists) {
      await this.client.createCollection(this.collectionName, {
        vectors: {
          size: dimensions,
          distance: "Cosine",
        },
        optimizers_config: {
          default_segment_number: 2,
        },
      });
    }
  }

  async upsert(chunks: CodeChunk[], vectors: number[][]): Promise<void> {
    if (chunks.length === 0) return;

    const batchSize = 100;

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batchChunks = chunks.slice(i, i + batchSize);
      const batchVectors = vectors.slice(i, i + batchSize);

      const points = batchChunks.map((chunk, idx) => ({
        id: this.hashToUint(chunk.id),
        vector: batchVectors[idx],
        payload: {
          chunkId: chunk.id,
          filePath: chunk.filePath,
          content: chunk.content,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          language: chunk.language,
          metadata: chunk.metadata ?? {},
        },
      }));

      await this.client.upsert(this.collectionName, {
        wait: true,
        points,
      });
    }
  }

  async search(vector: number[], limit: number): Promise<SearchResult[]> {
    const results = await this.client.search(this.collectionName, {
      vector,
      limit,
      with_payload: true,
    });

    return results.map((r) => ({
      chunk: {
        id: (r.payload?.chunkId as string) ?? "",
        filePath: (r.payload?.filePath as string) ?? "",
        content: (r.payload?.content as string) ?? "",
        startLine: (r.payload?.startLine as number) ?? 0,
        endLine: (r.payload?.endLine as number) ?? 0,
        language: (r.payload?.language as string) ?? "text",
        metadata: (r.payload?.metadata as Record<string, unknown>) ?? {},
      },
      score: r.score,
    }));
  }

  async delete(ids: string[]): Promise<void> {
    if (ids.length === 0) return;

    await this.client.delete(this.collectionName, {
      wait: true,
      points: ids.map((id) => this.hashToUint(id)),
    });
  }

  async count(): Promise<number> {
    const info = await this.client.getCollection(this.collectionName);
    return info.points_count ?? 0;
  }

  async getIndexedFilePaths(): Promise<string[]> {
    const filePaths = new Set<string>();
    let offset: string | number | undefined = undefined;

    while (true) {
      const result = await this.client.scroll(this.collectionName, {
        limit: 100,
        offset,
        with_payload: ["filePath"],
        with_vector: false,
      });

      for (const point of result.points) {
        const fp = point.payload?.filePath as string | undefined;
        if (fp) filePaths.add(fp);
      }

      const next = result.next_page_offset;
      if (!next || typeof next === "object") break;
      offset = next;
    }

    return [...filePaths].sort();
  }

  /** Convert a hex hash string to a numeric ID for Qdrant */
  private hashToUint(hex: string): number {
    // Take first 13 hex chars → fits safely in a JS number (52-bit mantissa)
    return parseInt(hex.slice(0, 13), 16);
  }
}
