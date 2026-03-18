// ── Chunk ────────────────────────────────────────────────────────────────────

export interface CodeChunk {
  /** Unique ID derived from file path + chunk index */
  id: string;
  /** Relative file path from project root */
  filePath: string;
  /** Raw text content of the chunk */
  content: string;
  /** Start line number (1-based) */
  startLine: number;
  /** End line number (1-based) */
  endLine: number;
  /** Language hint inferred from file extension */
  language: string;
  /** Optional metadata (function name, class name, etc.) */
  metadata?: Record<string, unknown>;
  /** sha256 of full file contents — used for smart sync */
  contentHash?: string;
}

// ── Embeddings ───────────────────────────────────────────────────────────────

export interface EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

export interface EmbeddingProviderConfig {
  provider: "openai" | "ollama";
  model: string;
  baseUrl?: string;
  apiKey?: string;
  dimensions?: number;
}

// ── Vector Store ─────────────────────────────────────────────────────────────

export interface SearchResult {
  chunk: CodeChunk;
  score: number;
}

export interface VectorStore {
  initialize(dimensions: number): Promise<void>;
  upsert(chunks: CodeChunk[], vectors: number[][]): Promise<void>;
  search(vector: number[], limit: number): Promise<SearchResult[]>;
  delete(ids: string[]): Promise<void>;
  count(): Promise<number>;
  getIndexedFilePaths(): Promise<string[]>;
  getIndexedFileHashes(): Promise<Map<string, string>>;
  deleteByFilePaths(paths: string[]): Promise<void>;
  drop(): Promise<void>;
}

// ── Config ───────────────────────────────────────────────────────────────────

export interface StoreConfig {
  type: "lancedb" | "qdrant";
  url?: string;
  collectionName?: string;
  apiKey?: string;
}

export interface CodeIndexerConfig {
  /** Glob patterns for files to include */
  include: string[];
  /** Glob patterns for files to exclude */
  exclude: string[];
  /** Max chunk size in lines */
  chunkMaxLines: number;
  /** Overlap between chunks in lines */
  chunkOverlap: number;
  /** Embedding provider configuration */
  embedding: EmbeddingProviderConfig;
  /** Vector store configuration */
  store: StoreConfig;
}

export const DEFAULT_CONFIG: CodeIndexerConfig = {
  include: ["**/*.{ts,tsx,js,jsx,py,rs,go,java,rb,cpp,c,h,hpp,cs,swift,kt,lua,sh,sql,md}"],
  exclude: [
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**",
    "**/.git/**",
    "**/vendor/**",
    "**/__pycache__/**",
    "**/venv/**",
    "**/.next/**",
    "**/coverage/**",
    "**/*.min.*",
    "**/package-lock.json",
    "**/yarn.lock",
    "**/pnpm-lock.yaml",
    "**/.code-indexer/**",
  ],
  chunkMaxLines: 60,
  chunkOverlap: 5,
  embedding: {
    provider: "openai",
    model: "text-embedding-3-small",
    dimensions: 1536,
  },
  store: {
    type: "lancedb",
  },
};
