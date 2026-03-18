import pLimit from "p-limit";
import type {
  CodeChunk,
  CodeIndexerConfig,
  EmbeddingProvider,
  SearchResult,
  VectorStore,
} from "../types.js";
import { chunkFiles } from "../chunker/text-chunker.js";
import { discoverFiles } from "../utils/helpers.js";

export interface IndexStats {
  filesFound: number;
  filesAdded: number;
  filesUpdated: number;
  filesSkipped: number;
  filesRemoved: number;
  chunksGenerated: number;
  chunksIndexed: number;
  durationMs: number;
}

export interface IndexerOptions {
  config: CodeIndexerConfig;
  embeddingProvider: EmbeddingProvider;
  store: VectorStore;
  rootDir: string;
  onProgress?: (msg: string) => void;
}

export class Indexer {
  private config: CodeIndexerConfig;
  private embedder: EmbeddingProvider;
  private store: VectorStore;
  private rootDir: string;
  private onProgress: (msg: string) => void;

  constructor(opts: IndexerOptions) {
    this.config = opts.config;
    this.embedder = opts.embeddingProvider;
    this.store = opts.store;
    this.rootDir = opts.rootDir;
    this.onProgress = opts.onProgress ?? (() => {});
  }

  /** Index the codebase: discover → chunk → embed → store */
  async index(): Promise<IndexStats> {
    const start = Date.now();

    // 1. Initialize vector store
    this.onProgress("Initializing vector store…");
    await this.store.initialize(this.embedder.dimensions);

    // 2. Discover files
    this.onProgress("Discovering files…");
    const files = await discoverFiles(this.rootDir, this.config);
    this.onProgress(`Found ${files.length} files`);

    if (files.length === 0) {
      return {
        filesFound: 0,
        filesAdded: 0,
        filesUpdated: 0,
        filesSkipped: 0,
        filesRemoved: 0,
        chunksGenerated: 0,
        chunksIndexed: 0,
        durationMs: Date.now() - start,
      };
    }

    // 3. Chunk files
    this.onProgress("Chunking files…");
    const chunks = await chunkFiles(this.rootDir, files, this.config);
    this.onProgress(`Generated ${chunks.length} chunks from ${files.length} files`);

    if (chunks.length === 0) {
      return {
        filesFound: files.length,
        filesAdded: 0,
        filesUpdated: 0,
        filesSkipped: files.length,
        filesRemoved: 0,
        chunksGenerated: 0,
        chunksIndexed: 0,
        durationMs: Date.now() - start,
      };
    }

    // 4. Generate embeddings in batches
    this.onProgress("Generating embeddings…");
    const embeddingBatchSize = 256;
    const allVectors: number[][] = [];
    const limit = pLimit(3); // concurrency limit

    const batches: CodeChunk[][] = [];
    for (let i = 0; i < chunks.length; i += embeddingBatchSize) {
      batches.push(chunks.slice(i, i + embeddingBatchSize));
    }

    const batchResults = await Promise.all(
      batches.map((batch, idx) =>
        limit(async () => {
          this.onProgress(
            `Embedding batch ${idx + 1}/${batches.length} (${batch.length} chunks)…`,
          );
          const texts = batch.map((c) => this.buildEmbeddingText(c));
          return this.embedder.embed(texts);
        }),
      ),
    );

    for (const vectors of batchResults) {
      allVectors.push(...vectors);
    }

    // 5. Store in Qdrant
    this.onProgress("Storing vectors in Qdrant…");
    await this.store.upsert(chunks, allVectors);

    const durationMs = Date.now() - start;
    this.onProgress(`Indexing complete in ${(durationMs / 1000).toFixed(1)}s`);

    return {
      filesFound: files.length,
      filesAdded: files.length,
      filesUpdated: 0,
      filesSkipped: 0,
      filesRemoved: 0,
      chunksGenerated: chunks.length,
      chunksIndexed: chunks.length,
      durationMs,
    };
  }

  /** Search the indexed codebase */
  async search(query: string, limit = 10): Promise<SearchResult[]> {
    const [queryVector] = await this.embedder.embed([query]);
    return this.store.search(queryVector, limit);
  }

  /** Build the text that gets embedded — includes file path for context */
  private buildEmbeddingText(chunk: CodeChunk): string {
    return `File: ${chunk.filePath} (${chunk.language})\nLines ${chunk.startLine}-${chunk.endLine}\n\n${chunk.content}`;
  }
}
