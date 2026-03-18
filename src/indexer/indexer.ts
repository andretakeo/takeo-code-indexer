import pLimit from "p-limit";
import type {
  CodeChunk,
  CodeIndexerConfig,
  EmbeddingProvider,
  SearchResult,
  VectorStore,
} from "../types.js";
import { chunkFiles } from "../chunker/text-chunker.js";
import { discoverFiles, fileContentHash } from "../utils/helpers.js";

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
  fresh?: boolean;
  onProgress?: (msg: string) => void;
}

export class Indexer {
  private config: CodeIndexerConfig;
  private embedder: EmbeddingProvider;
  private store: VectorStore;
  private rootDir: string;
  private fresh: boolean;
  private onProgress: (msg: string) => void;

  constructor(opts: IndexerOptions) {
    this.config = opts.config;
    this.embedder = opts.embeddingProvider;
    this.store = opts.store;
    this.rootDir = opts.rootDir;
    this.fresh = opts.fresh ?? false;
    this.onProgress = opts.onProgress ?? (() => {});
  }

  /** Index the codebase with smart sync: discover → diff → chunk → embed → store */
  async index(): Promise<IndexStats> {
    const start = Date.now();

    // 1. Initialize (or drop + reinitialize if --fresh)
    if (this.fresh) {
      this.onProgress("Dropping existing index…");
      await this.store.drop();
    }
    this.onProgress("Initializing vector store…");
    await this.store.initialize(this.embedder.dimensions);

    // 2. Discover files on disk
    this.onProgress("Discovering files…");
    const files = await discoverFiles(this.rootDir, this.config);
    const diskFiles = new Set(files);

    // 3. Get current index state
    this.onProgress("Loading index state…");
    const indexedHashes = this.fresh ? new Map<string, string>() : await this.store.getIndexedFileHashes();

    // 4. Diff
    const toAdd: string[] = [];
    const toUpdate: string[] = [];
    const toSkip: string[] = [];
    const toRemove: string[] = [];

    const diskHashes = new Map<string, string>();
    for (const file of files) {
      const hash = await fileContentHash(this.rootDir, file);
      diskHashes.set(file, hash);

      const existingHash = indexedHashes.get(file);
      if (!existingHash) {
        toAdd.push(file);
      } else if (existingHash !== hash) {
        toUpdate.push(file);
      } else {
        toSkip.push(file);
      }
    }

    // Files in index but not on disk
    for (const indexedFile of indexedHashes.keys()) {
      if (!diskFiles.has(indexedFile)) {
        toRemove.push(indexedFile);
      }
    }

    this.onProgress(
      `Sync: ${toAdd.length} new, ${toUpdate.length} changed, ${toSkip.length} unchanged, ${toRemove.length} removed`,
    );

    // 5. Remove deleted files
    if (toRemove.length > 0) {
      this.onProgress(`Removing ${toRemove.length} deleted files…`);
      await this.store.deleteByFilePaths(toRemove);
    }

    // 6. Remove changed files (will be re-added)
    if (toUpdate.length > 0) {
      this.onProgress(`Removing stale chunks for ${toUpdate.length} changed files…`);
      await this.store.deleteByFilePaths(toUpdate);
    }

    // 7. Chunk + embed + upsert new and changed files
    const filesToProcess = [...toAdd, ...toUpdate];

    if (filesToProcess.length === 0) {
      return {
        filesFound: files.length,
        filesAdded: toAdd.length,
        filesUpdated: toUpdate.length,
        filesSkipped: toSkip.length,
        filesRemoved: toRemove.length,
        chunksGenerated: 0,
        chunksIndexed: 0,
        durationMs: Date.now() - start,
      };
    }

    this.onProgress(`Chunking ${filesToProcess.length} files…`);
    const chunks = await chunkFiles(this.rootDir, filesToProcess, this.config);

    if (chunks.length === 0) {
      return {
        filesFound: files.length,
        filesAdded: toAdd.length,
        filesUpdated: toUpdate.length,
        filesSkipped: toSkip.length,
        filesRemoved: toRemove.length,
        chunksGenerated: 0,
        chunksIndexed: 0,
        durationMs: Date.now() - start,
      };
    }

    // 8. Embed in batches
    this.onProgress("Generating embeddings…");
    const embeddingBatchSize = 256;
    const allVectors: number[][] = [];
    const limit = pLimit(3);

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

    // 9. Set contentHash on each chunk, then upsert
    this.onProgress("Storing vectors…");
    for (const chunk of chunks) {
      chunk.contentHash = diskHashes.get(chunk.filePath) ?? "";
    }
    await this.store.upsert(chunks, allVectors);

    const durationMs = Date.now() - start;
    this.onProgress(`Indexing complete in ${(durationMs / 1000).toFixed(1)}s`);

    return {
      filesFound: files.length,
      filesAdded: toAdd.length,
      filesUpdated: toUpdate.length,
      filesSkipped: toSkip.length,
      filesRemoved: toRemove.length,
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
