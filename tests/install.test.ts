import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, rm, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { writeSkills } from "../src/cli/install.js";

const TEST_DIR = join(process.cwd(), "__test_install__");

beforeAll(async () => {
  await mkdir(TEST_DIR, { recursive: true });
});

afterAll(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe("writeSkills", () => {
  it("should create skill directories and files", async () => {
    const written = await writeSkills(TEST_DIR);
    expect(written).toHaveLength(4);

    for (const skillPath of written) {
      const content = await readFile(skillPath, "utf-8");
      expect(content).toContain("---");
      expect(content).toContain("name:");
    }
  });

  it("should create the expected directory structure", async () => {
    const dirs = await readdir(TEST_DIR);
    expect(dirs).toContain("code-indexer-index");
    expect(dirs).toContain("code-indexer-search");
    expect(dirs).toContain("code-indexer-status");
    expect(dirs).toContain("code-indexer-setup");
  });

  it("should overwrite existing skills on re-run", async () => {
    const written = await writeSkills(TEST_DIR);
    expect(written).toHaveLength(4);
  });
});
