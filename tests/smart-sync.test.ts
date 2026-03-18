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
    return texts.map(() => [Math.random(), Math.random(), Math.random()]);
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
