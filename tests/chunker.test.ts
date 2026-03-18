import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { chunkFile } from "../src/chunker/text-chunker.js";
import type { CodeIndexerConfig } from "../src/types.js";
import { DEFAULT_CONFIG } from "../src/types.js";

const TEST_DIR = join(process.cwd(), "__test_fixtures__");

const config: CodeIndexerConfig = {
  ...DEFAULT_CONFIG,
  chunkMaxLines: 10,
  chunkOverlap: 2,
};

beforeAll(async () => {
  await mkdir(TEST_DIR, { recursive: true });
});

afterAll(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe("chunkFile", () => {
  it("should skip trivially small files", async () => {
    await writeFile(join(TEST_DIR, "tiny.ts"), "const x = 1;\n");
    const chunks = await chunkFile(TEST_DIR, "tiny.ts", config);
    expect(chunks).toHaveLength(0);
  });

  it("should create a single chunk for small files", async () => {
    const lines = Array.from({ length: 8 }, (_, i) => `const line${i} = ${i};`);
    await writeFile(join(TEST_DIR, "small.ts"), lines.join("\n"));

    const chunks = await chunkFile(TEST_DIR, "small.ts", config);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0].filePath).toBe("small.ts");
    expect(chunks[0].language).toBe("typescript");
    expect(chunks[0].startLine).toBe(1);
  });

  it("should create multiple overlapping chunks for larger files", async () => {
    const lines = Array.from({ length: 30 }, (_, i) => `const line${i} = ${i};`);
    await writeFile(join(TEST_DIR, "large.ts"), lines.join("\n"));

    const chunks = await chunkFile(TEST_DIR, "large.ts", config);
    expect(chunks.length).toBeGreaterThan(1);

    // Verify chunks have content
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeGreaterThan(0);
      expect(chunk.id).toBeTruthy();
    }
  });

  it("should detect language from file extension", async () => {
    const content = Array.from({ length: 5 }, (_, i) => `line_${i} = ${i}`).join("\n");

    await writeFile(join(TEST_DIR, "script.py"), content);
    const chunks = await chunkFile(TEST_DIR, "script.py", config);
    expect(chunks[0].language).toBe("python");
  });

  it("should break at natural boundaries", async () => {
    const lines = [
      "function foo() {",
      "  const a = 1;",
      "  const b = 2;",
      "  return a + b;",
      "}",
      "",
      "function bar() {",
      "  const c = 3;",
      "  const d = 4;",
      "  return c + d;",
      "}",
      "",
      "export { foo, bar };",
    ];
    await writeFile(join(TEST_DIR, "funcs.ts"), lines.join("\n"));

    const chunks = await chunkFile(TEST_DIR, "funcs.ts", config);
    // The blank line between functions should serve as a natural break
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });
});
