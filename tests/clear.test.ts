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
