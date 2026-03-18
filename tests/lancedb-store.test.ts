import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LanceStore } from "../src/store/lancedb.js";
import type { CodeChunk } from "../src/types.js";

const DIMENSIONS = 3;

function makeChunk(overrides: Partial<CodeChunk> & { id: string }): CodeChunk {
  return {
    filePath: "src/main.ts",
    content: "console.log('hello');",
    startLine: 1,
    endLine: 5,
    language: "typescript",
    contentHash: "abc123",
    ...overrides,
  };
}

let tempDir: string;
let store: LanceStore;

beforeEach(async () => {
  // Create fresh temp dir and store for each test
  tempDir = mkdtempSync(join(tmpdir(), "lancedb-test-"));
  store = new LanceStore(tempDir);
  await store.initialize(DIMENSIONS);
});

afterAll(() => {
  // Clean up any remaining temp dirs
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe("LanceStore", () => {
  it("should count zero vectors in empty store", async () => {
    expect(await store.count()).toBe(0);
  });

  it("should upsert and count chunks", async () => {
    const chunks = [
      makeChunk({ id: "chunk-1", filePath: "a.ts", contentHash: "h1" }),
      makeChunk({ id: "chunk-2", filePath: "b.ts", contentHash: "h2" }),
      makeChunk({ id: "chunk-3", filePath: "c.ts", contentHash: "h3" }),
    ];
    const vectors = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];

    await store.upsert(chunks, vectors);
    expect(await store.count()).toBe(3);
  });

  it("should search and return results sorted by score", async () => {
    const chunks = [
      makeChunk({ id: "chunk-x", filePath: "x.ts", contentHash: "hx" }),
      makeChunk({ id: "chunk-y", filePath: "y.ts", contentHash: "hy" }),
    ];
    const vectors = [
      [1, 0, 0],
      [0, 1, 0],
    ];

    await store.upsert(chunks, vectors);

    // Search for a vector close to [1, 0, 0]
    const results = await store.search([1, 0, 0], 10);
    expect(results.length).toBe(2);

    // First result should be the closest match
    expect(results[0].chunk.id).toBe("chunk-x");
    expect(results[0].score).toBeGreaterThan(results[1].score);

    // Score for exact match should be close to 1
    expect(results[0].score).toBeCloseTo(1, 1);
  });

  it("should return empty array when searching empty store", async () => {
    const results = await store.search([1, 0, 0], 10);
    expect(results).toEqual([]);
  });

  it("should get indexed file paths (deduplicated, sorted)", async () => {
    const chunks = [
      makeChunk({ id: "c1", filePath: "src/b.ts", contentHash: "h1" }),
      makeChunk({ id: "c2", filePath: "src/a.ts", contentHash: "h2" }),
      makeChunk({ id: "c3", filePath: "src/b.ts", contentHash: "h3" }),
    ];
    const vectors = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];

    await store.upsert(chunks, vectors);

    const paths = await store.getIndexedFilePaths();
    expect(paths).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("should get indexed file hashes", async () => {
    const chunks = [
      makeChunk({ id: "c1", filePath: "src/a.ts", contentHash: "hash-a" }),
      makeChunk({ id: "c2", filePath: "src/b.ts", contentHash: "hash-b" }),
    ];
    const vectors = [
      [1, 0, 0],
      [0, 1, 0],
    ];

    await store.upsert(chunks, vectors);

    const hashes = await store.getIndexedFileHashes();
    expect(hashes.get("src/a.ts")).toBe("hash-a");
    expect(hashes.get("src/b.ts")).toBe("hash-b");
    expect(hashes.size).toBe(2);
  });

  it("should delete by file paths", async () => {
    const chunks = [
      makeChunk({ id: "c1", filePath: "keep.ts", contentHash: "h1" }),
      makeChunk({ id: "c2", filePath: "remove.ts", contentHash: "h2" }),
      makeChunk({ id: "c3", filePath: "remove.ts", contentHash: "h3" }),
    ];
    const vectors = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];

    await store.upsert(chunks, vectors);
    expect(await store.count()).toBe(3);

    await store.deleteByFilePaths(["remove.ts"]);
    expect(await store.count()).toBe(1);

    const paths = await store.getIndexedFilePaths();
    expect(paths).toEqual(["keep.ts"]);
  });

  it("should drop and allow recreation", async () => {
    const chunks = [
      makeChunk({ id: "c1", contentHash: "h1" }),
    ];
    const vectors = [[1, 0, 0]];

    await store.upsert(chunks, vectors);
    expect(await store.count()).toBe(1);

    await store.drop();
    expect(await store.count()).toBe(0);

    // Should be able to upsert again after drop
    await store.upsert(chunks, vectors);
    expect(await store.count()).toBe(1);
  });

  it("should drop idempotently on non-existent table", async () => {
    // Drop without ever creating a table — should not throw
    await expect(store.drop()).resolves.not.toThrow();
    // Drop again for good measure
    await expect(store.drop()).resolves.not.toThrow();
  });
});
