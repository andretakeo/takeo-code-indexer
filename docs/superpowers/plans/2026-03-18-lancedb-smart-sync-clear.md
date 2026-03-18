# LanceDB Migration, Smart Sync & Clear Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Qdrant with embedded LanceDB as default store, add incremental smart sync to `index`, and add a `clear` command.

**Architecture:** LanceDB runs in-process storing data in `.code-indexer/` in the project root. The `VectorStore` interface gains three new methods (`getIndexedFileHashes`, `deleteByFilePaths`, `drop`). The `Indexer` uses content hashes (sha256) to diff files on disk vs index, only re-embedding changed files. A `clear` CLI command provides full wipe and per-file deletion.

**Tech Stack:** `@lancedb/lancedb` (embedded vector DB), `node:crypto` (sha256), `minimatch` from `glob` package (glob matching for `clear --file`)

**Review fixes applied:**
- `__dirname` replaced with ESM-compatible `import.meta.url` in all test files
- `contentHash` added to `CodeChunk` interface instead of as `upsert` third param (keeps VectorStore signature clean)
- `join` import added to `helpers.ts` (was not already imported)
- SQL filter strings escape single quotes to prevent injection
- `**/.code-indexer/**` added to `DEFAULT_CONFIG.exclude` to prevent self-indexing
- Status command updated for store-agnostic display

**Spec:** `docs/superpowers/specs/2026-03-18-smart-sync-and-clear-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/types.ts` | Modify | Add new VectorStore methods, update config types, add `contentHash` to upsert flow |
| `src/store/lancedb.ts` | Create | LanceDB VectorStore implementation |
| `src/store/qdrant.ts` | Modify | Add new VectorStore methods to Qdrant implementation |
| `src/store/index.ts` | Create | Store factory — creates LanceDB or Qdrant store from config |
| `src/utils/config.ts` | Modify | Handle new `store` config key, backwards-compat for `qdrant` key |
| `src/utils/helpers.ts` | Modify | Add `fileContentHash()` helper |
| `src/indexer/indexer.ts` | Modify | Smart sync logic (diff, skip, add, update, remove) |
| `src/cli/index.ts` | Modify | Add `clear` command, `--fresh` flag, use store factory, update stats display |
| `src/cli/skills.ts` | Modify | Update setup skill, add clear skill |
| `tests/lancedb-store.test.ts` | Create | LanceDB store tests |
| `tests/smart-sync.test.ts` | Create | Smart sync integration tests |
| `tests/clear.test.ts` | Create | Clear command tests |
| `package.json` | Modify | Add `@lancedb/lancedb`, add `minimatch` |

---

### Task 1: Install dependencies & update types

**Files:**
- Modify: `package.json`
- Modify: `src/types.ts`

- [ ] **Step 1: Install LanceDB and minimatch**

```bash
npm install @lancedb/lancedb minimatch
npm install -D @types/minimatch
```

- [ ] **Step 2: Add `contentHash` to `CodeChunk` and update `VectorStore` in `src/types.ts`**

Add `contentHash` to `CodeChunk` (travels with the chunk, keeps `upsert` signature clean):

```typescript
export interface CodeChunk {
  id: string;
  filePath: string;
  content: string;
  startLine: number;
  endLine: number;
  language: string;
  metadata?: Record<string, unknown>;
  contentHash?: string;  // NEW — sha256 of full file contents
}
```

Add three new methods to `VectorStore` (do NOT change `upsert` signature):

```typescript
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
```

- [ ] **Step 3: Update config types in `src/types.ts`**

Replace the `qdrant` config key with a generic `store` key. Keep `qdrant` as an optional field for backwards compatibility:

```typescript
export interface StoreConfig {
  type: "lancedb" | "qdrant";
  url?: string;
  collectionName?: string;
  apiKey?: string;
}

export interface CodeIndexerConfig {
  include: string[];
  exclude: string[];
  chunkMaxLines: number;
  chunkOverlap: number;
  embedding: EmbeddingProviderConfig;
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
```

- [ ] **Step 4: Update IndexStats in `src/indexer/indexer.ts`**

```typescript
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
```

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/types.ts src/indexer/indexer.ts
git commit -m "feat: update types for LanceDB, smart sync, and store abstraction"
```

---

### Task 2: Create LanceDB store implementation

**Files:**
- Create: `src/store/lancedb.ts`
- Create: `tests/lancedb-store.test.ts`

- [ ] **Step 1: Write failing tests for LanceDB store**

Create `tests/lancedb-store.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { LanceStore } from "../src/store/lancedb.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_DB_DIR = join(__dirname, "__test_lancedb__");

describe("LanceStore", () => {
  let store: LanceStore;

  beforeEach(async () => {
    rmSync(TEST_DB_DIR, { recursive: true, force: true });
    store = new LanceStore(TEST_DB_DIR);
    await store.initialize(3); // 3-dimensional vectors for testing
  });

  afterAll(() => {
    rmSync(TEST_DB_DIR, { recursive: true, force: true });
  });

  it("should count zero vectors in empty store", async () => {
    expect(await store.count()).toBe(0);
  });

  it("should upsert and count chunks", async () => {
    const chunks = [
      { id: "abc123", filePath: "src/a.ts", content: "hello", startLine: 1, endLine: 5, language: "typescript", contentHash: "hash_a" },
      { id: "def456", filePath: "src/a.ts", content: "world", startLine: 6, endLine: 10, language: "typescript", contentHash: "hash_a" },
    ];
    const vectors = [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]];
    await store.upsert(chunks, vectors);
    expect(await store.count()).toBe(2);
  });

  it("should search and return results sorted by score", async () => {
    const chunks = [
      { id: "abc123", filePath: "src/a.ts", content: "hello", startLine: 1, endLine: 5, language: "typescript", contentHash: "hash_a" },
      { id: "def456", filePath: "src/b.ts", content: "world", startLine: 1, endLine: 5, language: "typescript", contentHash: "hash_b" },
    ];
    const vectors = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]];
    await store.upsert(chunks, vectors);
    const results = await store.search([1.0, 0.0, 0.0], 2);
    expect(results.length).toBe(2);
    expect(results[0].chunk.filePath).toBe("src/a.ts");
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it("should get indexed file paths", async () => {
    const chunks = [
      { id: "a1", filePath: "src/a.ts", content: "a", startLine: 1, endLine: 1, language: "typescript", contentHash: "hash_a" },
      { id: "b1", filePath: "src/b.ts", content: "b", startLine: 1, endLine: 1, language: "typescript", contentHash: "hash_b" },
      { id: "a2", filePath: "src/a.ts", content: "a2", startLine: 2, endLine: 2, language: "typescript", contentHash: "hash_a" },
    ];
    const vectors = [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6], [0.7, 0.8, 0.9]];
    await store.upsert(chunks, vectors);
    const paths = await store.getIndexedFilePaths();
    expect(paths).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("should get indexed file hashes", async () => {
    const chunksA = [
      { id: "a1", filePath: "src/a.ts", content: "a", startLine: 1, endLine: 1, language: "typescript", contentHash: "hash_a" },
    ];
    const chunksB = [
      { id: "b1", filePath: "src/b.ts", content: "b", startLine: 1, endLine: 1, language: "typescript", contentHash: "hash_b" },
    ];
    await store.upsert(chunksA, [[0.1, 0.2, 0.3]]);
    await store.upsert(chunksB, [[0.4, 0.5, 0.6]]);
    const hashes = await store.getIndexedFileHashes();
    expect(hashes.get("src/a.ts")).toBe("hash_a");
    expect(hashes.get("src/b.ts")).toBe("hash_b");
  });

  it("should delete by file paths", async () => {
    const chunks = [
      { id: "a1", filePath: "src/a.ts", content: "a", startLine: 1, endLine: 1, language: "typescript", contentHash: "hash_a" },
      { id: "b1", filePath: "src/b.ts", content: "b", startLine: 1, endLine: 1, language: "typescript", contentHash: "hash_b" },
    ];
    const vectors = [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]];
    await store.upsert(chunks, vectors);
    await store.deleteByFilePaths(["src/a.ts"]);
    expect(await store.count()).toBe(1);
    const paths = await store.getIndexedFilePaths();
    expect(paths).toEqual(["src/b.ts"]);
  });

  it("should drop and recreate", async () => {
    const chunks = [
      { id: "a1", filePath: "src/a.ts", content: "a", startLine: 1, endLine: 1, language: "typescript", contentHash: "hash_a" },
    ];
    await store.upsert(chunks, [[0.1, 0.2, 0.3]]);
    expect(await store.count()).toBe(1);
    await store.drop();
    await store.initialize(3);
    expect(await store.count()).toBe(0);
  });

  it("should handle drop on non-existent table", async () => {
    await store.drop();
    // Should not throw
    await store.drop();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/lancedb-store.test.ts
```

Expected: FAIL — `LanceStore` does not exist.

- [ ] **Step 3: Implement LanceDB store**

Create `src/store/lancedb.ts`:

```typescript
import lancedb from "@lancedb/lancedb";
import type { CodeChunk, SearchResult, VectorStore } from "../types.js";

export class LanceStore implements VectorStore {
  private dbPath: string;
  private db: Awaited<ReturnType<typeof lancedb.connect>> | null = null;
  private table: any | null = null;
  private tableName = "chunks";

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async initialize(dimensions: number): Promise<void> {
    this.db = await lancedb.connect(this.dbPath);
    const tableNames = await this.db.tableNames();
    if (tableNames.includes(this.tableName)) {
      this.table = await this.db.openTable(this.tableName);
    } else {
      this.table = null;
    }
  }

  async upsert(chunks: CodeChunk[], vectors: number[][]): Promise<void> {
    if (chunks.length === 0) return;
    if (!this.db) throw new Error("Store not initialized");

    const records = chunks.map((chunk, idx) => ({
      id: chunk.id,
      filePath: chunk.filePath,
      content: chunk.content,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      language: chunk.language,
      contentHash: chunk.contentHash ?? "",
      vector: vectors[idx],
    }));

    if (!this.table) {
      this.table = await this.db.createTable(this.tableName, records);
    } else {
      await this.table.add(records);
    }
  }

  async search(vector: number[], limit: number): Promise<SearchResult[]> {
    if (!this.table) return [];

    const results = await this.table.search(vector).limit(limit).toArray();

    return results.map((r: any) => ({
      chunk: {
        id: r.id ?? "",
        filePath: r.filePath ?? "",
        content: r.content ?? "",
        startLine: r.startLine ?? 0,
        endLine: r.endLine ?? 0,
        language: r.language ?? "text",
      },
      score: 1 - (r._distance ?? 1), // LanceDB returns distance, convert to similarity
    }));
  }

  private escapeSQL(value: string): string {
    return value.replace(/'/g, "''");
  }

  async delete(ids: string[]): Promise<void> {
    if (!this.table || ids.length === 0) return;
    const idList = ids.map((id) => `'${this.escapeSQL(id)}'`).join(", ");
    await this.table.delete(`id IN (${idList})`);
  }

  async count(): Promise<number> {
    if (!this.table) return 0;
    return await this.table.countRows();
  }

  async getIndexedFilePaths(): Promise<string[]> {
    if (!this.table) return [];
    const rows = await this.table.query().select(["filePath"]).toArray();
    const paths = new Set<string>();
    for (const row of rows) {
      if (row.filePath) paths.add(row.filePath);
    }
    return [...paths].sort();
  }

  async getIndexedFileHashes(): Promise<Map<string, string>> {
    if (!this.table) return new Map();
    const rows = await this.table.query().select(["filePath", "contentHash"]).toArray();
    const hashes = new Map<string, string>();
    for (const row of rows) {
      if (row.filePath && row.contentHash) {
        hashes.set(row.filePath, row.contentHash);
      }
    }
    return hashes;
  }

  async deleteByFilePaths(paths: string[]): Promise<void> {
    if (!this.table || paths.length === 0) return;
    for (const filePath of paths) {
      await this.table.delete(`filePath = '${this.escapeSQL(filePath)}'`);
    }
  }

  async drop(): Promise<void> {
    if (!this.db) return;
    await this.db.dropTable(this.tableName, { ignoreMissing: true });
    this.table = null;
  }
}
```

The `contentHash` is read from `chunk.contentHash` (set by the Indexer before calling upsert), keeping the `VectorStore.upsert` signature unchanged.

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/lancedb-store.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/store/lancedb.ts tests/lancedb-store.test.ts src/types.ts
git commit -m "feat: add LanceDB vector store implementation with tests"
```

---

### Task 3: Create store factory and update config loading

**Files:**
- Create: `src/store/index.ts`
- Modify: `src/utils/config.ts`
- Modify: `src/store/qdrant.ts`

- [ ] **Step 1: Create store factory `src/store/index.ts`**

```typescript
import type { StoreConfig, VectorStore } from "../types.js";
import { LanceStore } from "./lancedb.js";
import { QdrantStore } from "./qdrant.js";

export function createStore(config: StoreConfig, rootDir: string): VectorStore {
  switch (config.type) {
    case "lancedb": {
      const dbPath = `${rootDir}/.code-indexer`;
      return new LanceStore(dbPath);
    }
    case "qdrant": {
      const url = config.url ?? "http://localhost:6333";
      const collectionName = config.collectionName ?? "code-indexer";
      return new QdrantStore(url, collectionName, config.apiKey);
    }
    default:
      throw new Error(`Unknown store type: ${config.type}`);
  }
}
```

- [ ] **Step 2: Update config loading for backwards compatibility**

Modify `src/utils/config.ts` to handle both old `qdrant` key and new `store` key:

```typescript
import { cosmiconfig } from "cosmiconfig";
import { DEFAULT_CONFIG, type CodeIndexerConfig, type StoreConfig } from "../types.js";

const MODULE_NAME = "code-indexer";

const explorer = cosmiconfig(MODULE_NAME, {
  searchPlaces: [
    `.${MODULE_NAME}.json`,
    `.${MODULE_NAME}.yaml`,
    `.${MODULE_NAME}.yml`,
    `.${MODULE_NAME}rc`,
    `${MODULE_NAME}.config.js`,
    `${MODULE_NAME}.config.ts`,
  ],
});

export async function loadConfig(
  cwd: string = process.cwd(),
): Promise<CodeIndexerConfig> {
  const result = await explorer.search(cwd);

  if (!result || result.isEmpty) {
    return { ...DEFAULT_CONFIG };
  }

  const userConfig = result.config as Record<string, any>;

  // Backwards compatibility: convert old `qdrant` key to new `store` key
  let store: StoreConfig;
  if (userConfig.store) {
    store = { ...DEFAULT_CONFIG.store, ...userConfig.store };
  } else if (userConfig.qdrant) {
    store = {
      type: "qdrant",
      url: userConfig.qdrant.url,
      collectionName: userConfig.qdrant.collectionName,
      apiKey: userConfig.qdrant.apiKey,
    };
  } else {
    store = { ...DEFAULT_CONFIG.store };
  }

  return {
    include: userConfig.include ?? DEFAULT_CONFIG.include,
    exclude: userConfig.exclude ?? DEFAULT_CONFIG.exclude,
    chunkMaxLines: userConfig.chunkMaxLines ?? DEFAULT_CONFIG.chunkMaxLines,
    chunkOverlap: userConfig.chunkOverlap ?? DEFAULT_CONFIG.chunkOverlap,
    embedding: {
      ...DEFAULT_CONFIG.embedding,
      ...userConfig.embedding,
    },
    store,
  };
}
```

- [ ] **Step 3: Add new methods to QdrantStore**

Add `getIndexedFileHashes`, `deleteByFilePaths`, `drop`, and the `contentHash` parameter to `upsert` in `src/store/qdrant.ts`:

In `upsert`, add `contentHash` to the payload (read from `chunk.contentHash`):

```typescript
// In the points mapping inside upsert(), add to the payload object:
//   contentHash: chunk.contentHash ?? "",
```

Add new methods:

```typescript
async getIndexedFileHashes(): Promise<Map<string, string>> {
  const hashes = new Map<string, string>();
  let offset: string | number | undefined = undefined;

  while (true) {
    const result = await this.client.scroll(this.collectionName, {
      limit: 100,
      offset,
      with_payload: ["filePath", "contentHash"],
      with_vector: false,
    });

    for (const point of result.points) {
      const fp = point.payload?.filePath as string | undefined;
      const hash = point.payload?.contentHash as string | undefined;
      if (fp && hash) hashes.set(fp, hash);
    }

    const next = result.next_page_offset;
    if (!next || typeof next === "object") break;
    offset = next;
  }

  return hashes;
}

async deleteByFilePaths(paths: string[]): Promise<void> {
  if (paths.length === 0) return;

  const batchSize = 100;
  for (let i = 0; i < paths.length; i += batchSize) {
    const batch = paths.slice(i, i + batchSize);
    await this.client.delete(this.collectionName, {
      wait: true,
      filter: {
        must: [{ key: "filePath", match: { any: batch } }],
      },
    });
  }
}

async drop(): Promise<void> {
  try {
    await this.client.deleteCollection(this.collectionName);
  } catch {
    // Collection may not exist — ignore
  }
}
```

- [ ] **Step 4: Run all existing tests to ensure nothing is broken**

```bash
npx vitest run
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/store/index.ts src/utils/config.ts src/store/qdrant.ts
git commit -m "feat: add store factory, backwards-compat config, and new Qdrant methods"
```

---

### Task 4: Add file content hash helper

**Files:**
- Modify: `src/utils/helpers.ts`

- [ ] **Step 1: Add `fileContentHash` function to `src/utils/helpers.ts`**

Add `readFile` and `join` imports at the top of `src/utils/helpers.ts` (only `createHash` and `extname` are currently imported):

```typescript
import { createHash } from "node:crypto";
import { extname, join } from "node:path";
import { readFile } from "node:fs/promises";
import { glob } from "glob";
import type { CodeIndexerConfig } from "../types.js";
```

Then add the function:

```typescript
/** Compute sha256 hash of a file's contents */
export async function fileContentHash(rootDir: string, filePath: string): Promise<string> {
  const fullPath = join(rootDir, filePath);
  const content = await readFile(fullPath, "utf-8");
  return createHash("sha256").update(content).digest("hex");
}
```

- [ ] **Step 2: Commit**

```bash
git add src/utils/helpers.ts
git commit -m "feat: add fileContentHash helper"
```

---

### Task 5: Implement smart sync in Indexer

**Files:**
- Modify: `src/indexer/indexer.ts`
- Create: `tests/smart-sync.test.ts`

- [ ] **Step 1: Write failing tests for smart sync**

Create `tests/smart-sync.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdirSync, writeFileSync, rmSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Indexer } from "../src/indexer/indexer.js";
import { LanceStore } from "../src/store/lancedb.js";
import type { CodeIndexerConfig, EmbeddingProvider } from "../src/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, "__test_sync_fixtures__");
const DB_DIR = join(FIXTURE_DIR, ".code-indexer");

/** Fake embedding provider that returns deterministic vectors */
class FakeEmbedder implements EmbeddingProvider {
  readonly name = "fake";
  readonly dimensions = 3;
  embedCallCount = 0;

  async embed(texts: string[]): Promise<number[][]> {
    this.embedCallCount += texts.length;
    return texts.map((_, i) => [Math.random(), Math.random(), Math.random()]);
  }
}

const baseConfig: CodeIndexerConfig = {
  include: ["**/*.ts"],
  exclude: [],
  chunkMaxLines: 60,
  chunkOverlap: 5,
  embedding: { provider: "openai", model: "test", dimensions: 3 },
  store: { type: "lancedb" },
};

function writeFixture(name: string, content: string) {
  writeFileSync(join(FIXTURE_DIR, name), content, "utf-8");
}

describe("Smart Sync", () => {
  let store: LanceStore;
  let embedder: FakeEmbedder;

  beforeEach(() => {
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
    mkdirSync(FIXTURE_DIR, { recursive: true });
    store = new LanceStore(DB_DIR);
    embedder = new FakeEmbedder();
  });

  afterAll(() => {
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
  });

  it("should index all files on first run", async () => {
    writeFixture("a.ts", "const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\n");
    writeFixture("b.ts", "const x = 1;\nconst y = 2;\nconst z = 3;\nconst w = 4;\n");

    const indexer = new Indexer({ config: baseConfig, embeddingProvider: embedder, store, rootDir: FIXTURE_DIR });
    const stats = await indexer.index();

    expect(stats.filesFound).toBe(2);
    expect(stats.filesAdded).toBe(2);
    expect(stats.filesSkipped).toBe(0);
    expect(stats.filesUpdated).toBe(0);
    expect(stats.filesRemoved).toBe(0);
  });

  it("should skip unchanged files on second run", async () => {
    writeFixture("a.ts", "const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\n");

    const indexer = new Indexer({ config: baseConfig, embeddingProvider: embedder, store, rootDir: FIXTURE_DIR });
    await indexer.index();

    const countBefore = embedder.embedCallCount;
    const stats = await indexer.index();

    expect(stats.filesSkipped).toBe(1);
    expect(stats.filesAdded).toBe(0);
    expect(embedder.embedCallCount).toBe(countBefore); // No new embed calls
  });

  it("should re-embed changed files", async () => {
    writeFixture("a.ts", "const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\n");

    const indexer = new Indexer({ config: baseConfig, embeddingProvider: embedder, store, rootDir: FIXTURE_DIR });
    await indexer.index();

    writeFixture("a.ts", "const a = CHANGED;\nconst b = 2;\nconst c = 3;\nconst d = 4;\n");

    const stats = await indexer.index();
    expect(stats.filesUpdated).toBe(1);
    expect(stats.filesSkipped).toBe(0);
  });

  it("should remove deleted files from index", async () => {
    writeFixture("a.ts", "const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\n");
    writeFixture("b.ts", "const x = 1;\nconst y = 2;\nconst z = 3;\nconst w = 4;\n");

    const indexer = new Indexer({ config: baseConfig, embeddingProvider: embedder, store, rootDir: FIXTURE_DIR });
    await indexer.index();

    unlinkSync(join(FIXTURE_DIR, "b.ts"));

    const stats = await indexer.index();
    expect(stats.filesRemoved).toBe(1);
    expect(stats.filesSkipped).toBe(1);
    expect(await store.count()).toBeGreaterThan(0);
    const paths = await store.getIndexedFilePaths();
    expect(paths).toEqual(["a.ts"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/smart-sync.test.ts
```

Expected: FAIL — Indexer still uses old logic, new stats fields don't exist.

- [ ] **Step 3: Implement smart sync in `src/indexer/indexer.ts`**

Rewrite the `index()` method:

```typescript
import pLimit from "p-limit";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
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

    // Compute hashes for files on disk
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

  async search(query: string, limit = 10): Promise<SearchResult[]> {
    const [queryVector] = await this.embedder.embed([query]);
    return this.store.search(queryVector, limit);
  }

  private buildEmbeddingText(chunk: CodeChunk): string {
    return `File: ${chunk.filePath} (${chunk.language})\nLines ${chunk.startLine}-${chunk.endLine}\n\n${chunk.content}`;
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/smart-sync.test.ts
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/indexer/indexer.ts tests/smart-sync.test.ts
git commit -m "feat: implement smart sync with content hash-based change detection"
```

---

### Task 6: Update CLI — store factory, `--fresh` flag, updated stats display

**Files:**
- Modify: `src/cli/index.ts`

- [ ] **Step 1: Update CLI to use store factory and new stats**

Replace the Qdrant-specific store creation with the factory, add `--fresh` flag to `index`, update stats display:

Key changes to `src/cli/index.ts`:

1. Replace `import { QdrantStore } from "../store/qdrant.js"` with `import { createStore } from "../store/index.js"`
2. In the `index` action, replace `new QdrantStore(...)` with `createStore(config.store, rootDir)`
3. Add `--fresh` option to the `index` command
4. Pass `fresh` option to the `Indexer` constructor
5. Update stats display to show new fields (added, updated, skipped, removed)
6. In the `search` action, replace `new QdrantStore(...)` with `createStore(config.store, rootDir)`
7. In the `status` action, replace `new QdrantStore(...)` with `createStore(config.store, rootDir)`

Stats display:
```typescript
console.log(`  Files found:      ${chalk.cyan(stats.filesFound)}`);
console.log(`  Files added:      ${chalk.green(stats.filesAdded)}`);
console.log(`  Files updated:    ${chalk.yellow(stats.filesUpdated)}`);
console.log(`  Files skipped:    ${chalk.dim(stats.filesSkipped)}`);
console.log(`  Files removed:    ${chalk.red(stats.filesRemoved)}`);
console.log(`  Chunks generated: ${chalk.cyan(stats.chunksGenerated)}`);
console.log(`  Chunks indexed:   ${chalk.cyan(stats.chunksIndexed)}`);
```

- [ ] **Step 2: Run the full test suite**

```bash
npx vitest run
```

Expected: All tests pass. Some tests may need updating if they reference old `IndexStats` fields.

- [ ] **Step 3: Build and smoke test**

```bash
npm run build
code-indexer index --dir .
code-indexer index --dir .   # second run should show files skipped
code-indexer index --fresh --dir .  # should re-index everything
```

- [ ] **Step 4: Commit**

```bash
git add src/cli/index.ts
git commit -m "feat: update CLI to use store factory, add --fresh flag, show sync stats"
```

---

### Task 7: Add `clear` command

**Files:**
- Modify: `src/cli/index.ts`
- Create: `tests/clear.test.ts`

- [ ] **Step 1: Write failing test for clear command logic**

Create `tests/clear.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { LanceStore } from "../src/store/lancedb.js";
import { minimatch } from "minimatch";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_DB_DIR = join(__dirname, "__test_clear__");

describe("clear command logic", () => {
  let store: LanceStore;

  beforeEach(async () => {
    rmSync(TEST_DB_DIR, { recursive: true, force: true });
    store = new LanceStore(TEST_DB_DIR);
    await store.initialize(3);

    // Seed with test data
    const chunks = [
      { id: "a1", filePath: "src/auth.ts", content: "auth", startLine: 1, endLine: 5, language: "typescript", contentHash: "hash_auth" },
      { id: "a2", filePath: "src/auth.ts", content: "auth2", startLine: 6, endLine: 10, language: "typescript", contentHash: "hash_auth" },
      { id: "b1", filePath: "src/hooks/useAuth.ts", content: "hook", startLine: 1, endLine: 5, language: "typescript", contentHash: "hash_hook" },
      { id: "c1", filePath: "src/utils/config.ts", content: "config", startLine: 1, endLine: 5, language: "typescript", contentHash: "hash_config" },
    ];
    const vectors = [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6], [0.7, 0.8, 0.9], [0.3, 0.3, 0.3]];
    await store.upsert(chunks, vectors);
  });

  afterAll(() => {
    rmSync(TEST_DB_DIR, { recursive: true, force: true });
  });

  it("should drop entire store", async () => {
    expect(await store.count()).toBe(4);
    await store.drop();
    await store.initialize(3);
    expect(await store.count()).toBe(0);
  });

  it("should delete by exact file path", async () => {
    await store.deleteByFilePaths(["src/auth.ts"]);
    expect(await store.count()).toBe(2);
    const paths = await store.getIndexedFilePaths();
    expect(paths).not.toContain("src/auth.ts");
  });

  it("should delete by glob pattern (matched client-side)", async () => {
    const allPaths = await store.getIndexedFilePaths();
    const pattern = "src/hooks/**";
    const matched = allPaths.filter((p) => minimatch(p, pattern));
    expect(matched).toEqual(["src/hooks/useAuth.ts"]);
    await store.deleteByFilePaths(matched);
    expect(await store.count()).toBe(3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail or pass**

```bash
npx vitest run tests/clear.test.ts
```

- [ ] **Step 3: Add `clear` command to `src/cli/index.ts`**

Add after the `install` command:

```typescript
import { minimatch } from "minimatch";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

program
  .command("clear")
  .description("Clear the index (all or specific files)")
  .option("-d, --dir <path>", "Project root (for config loading)", ".")
  .option("-f, --file <path>", "File path or glob pattern to remove")
  .option("-y, --yes", "Skip confirmation prompt")
  .action(async (opts) => {
    const rootDir = resolve(opts.dir);

    try {
      const config = await loadConfig(rootDir);
      const store = createStore(config.store, rootDir);
      await store.initialize(config.embedding.dimensions ?? 1536);

      if (opts.file) {
        // Delete specific file(s)
        const allPaths = await store.getIndexedFilePaths();
        const matched = allPaths.filter(
          (p) => p === opts.file || minimatch(p, opts.file),
        );

        if (matched.length === 0) {
          console.log(chalk.yellow(`No indexed files match "${opts.file}"`));
          return;
        }

        if (!opts.yes) {
          const rl = createInterface({ input: stdin, output: stdout });
          const answer = await rl.question(
            `Delete ${chalk.cyan(matched.length)} file(s) from index? (y/n) `,
          );
          rl.close();
          if (answer.trim().toLowerCase() !== "y") {
            console.log("Cancelled.");
            return;
          }
        }

        const spinner = ora(`Removing ${matched.length} file(s)…`).start();
        await store.deleteByFilePaths(matched);
        spinner.succeed(`Removed ${matched.length} file(s) from index`);

        for (const p of matched) {
          console.log(`  ${chalk.red("−")} ${p}`);
        }
      } else {
        // Drop entire index
        const vectorCount = await store.count();

        if (!opts.yes) {
          const rl = createInterface({ input: stdin, output: stdout });
          const answer = await rl.question(
            `This will delete all ${chalk.cyan(vectorCount)} vectors. Continue? (y/n) `,
          );
          rl.close();
          if (answer.trim().toLowerCase() !== "y") {
            console.log("Cancelled.");
            return;
          }
        }

        const spinner = ora("Clearing index…").start();
        await store.drop();
        spinner.succeed("Index cleared");
      }

      console.log();
    } catch (err) {
      if (err instanceof Error) {
        console.error(chalk.red(err.message || err.name));
        if (err.cause) console.error(chalk.dim(String(err.cause)));
      } else {
        console.error(chalk.red(String(err)));
      }
      process.exit(1);
    }
  });
```

- [ ] **Step 4: Run all tests**

```bash
npx vitest run
```

Expected: All tests pass.

- [ ] **Step 5: Build and smoke test**

```bash
npm run build
code-indexer clear --help
code-indexer index --dir .
code-indexer clear --file "src/cli/**" --dir . -y
code-indexer status --dir .
code-indexer clear --dir . -y
code-indexer status --dir .
```

- [ ] **Step 6: Commit**

```bash
git add src/cli/index.ts tests/clear.test.ts
git commit -m "feat: add clear command with per-file and glob pattern support"
```

---

### Task 8: Update skills and documentation

**Files:**
- Modify: `src/cli/skills.ts`
- Modify: `README.md`

- [ ] **Step 1: Update the setup skill in `src/cli/skills.ts`**

In the `code-indexer-setup` skill, replace Qdrant-first messaging with LanceDB-first:

- Change the default config example to show `"store": { "type": "lancedb" }` (or no store config at all since it's default)
- Move Qdrant config to an "Advanced: Remote Qdrant" section
- Add note about `.code-indexer/` in `.gitignore`
- Remove the "Start Qdrant locally with Docker" section as the default path

- [ ] **Step 2: Add `code-indexer-clear` skill to `src/cli/skills.ts`**

```typescript
{
  dirName: "code-indexer-clear",
  content: `---
name: code-indexer-clear
description: Use code-indexer to clear or remove files from the search index. Use when the user wants to reset the index, remove specific files, or clean up stale entries.
---

## Clear the index

\`\`\`sh
code-indexer clear                          # drop entire index (with confirmation)
code-indexer clear -y                       # drop without confirmation
code-indexer clear --file src/auth.ts       # remove one file
code-indexer clear --file "src/hooks/**"    # remove files matching glob pattern
\`\`\`

## When to use

- After restructuring/renaming many files (then re-index)
- To remove specific files you don't want in search results
- To start fresh: \`code-indexer clear -y && code-indexer index\`
- Alternatively: \`code-indexer index --fresh\` does clear + re-index in one step

## Notes

- \`clear\` without \`--file\` asks for confirmation unless \`-y\` is passed
- Glob patterns match against indexed file paths (e.g., \`"src/**/*.test.ts"\`)
- The \`--fresh\` flag on \`index\` is equivalent to clear + re-index
`,
},
```

- [ ] **Step 3: Update README.md**

Add the `clear` command to the usage section. Update prerequisites to remove the Docker/Qdrant requirement as mandatory. Mention LanceDB as the default (embedded, no setup). Add `--fresh` flag.

- [ ] **Step 4: Run tests and build**

```bash
npx vitest run
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/cli/skills.ts README.md
git commit -m "docs: update skills and README for LanceDB, clear command, smart sync"
```

---

### Task 9: Final integration test and cleanup

- [ ] **Step 1: Full end-to-end smoke test**

```bash
npm run build

# Fresh index with LanceDB (no server needed)
code-indexer index --dir .
code-indexer status --dir .
code-indexer search "vector store" --dir .

# Smart sync — second run should skip unchanged
code-indexer index --dir .

# Clear a specific file
code-indexer clear --file "src/store/qdrant.ts" --dir . -y
code-indexer status --dir .

# Full clear + fresh re-index
code-indexer index --fresh --dir .

# Verify .code-indexer directory was created
ls -la .code-indexer/
```

- [ ] **Step 2: Run full test suite**

```bash
npx vitest run
npm run typecheck
npm run lint
```

- [ ] **Step 3: Clean up .code-indexer from this project (test artifacts)**

```bash
rm -rf .code-indexer
echo ".code-indexer/" >> .gitignore
```

- [ ] **Step 4: Final commit**

```bash
git add .gitignore
git commit -m "chore: add .code-indexer to gitignore"
```
