import { createHash } from "node:crypto";
import { extname, join } from "node:path";
import { readFile } from "node:fs/promises";
import { glob } from "glob";
import type { CodeIndexerConfig } from "../types.js";

/** Generate a deterministic chunk ID from file path and index */
export function chunkId(filePath: string, index: number): string {
  const hash = createHash("sha256")
    .update(`${filePath}:${index}`)
    .digest("hex")
    .slice(0, 12);
  return `${hash}`;
}

/** Discover files matching the config include/exclude patterns */
export async function discoverFiles(
  rootDir: string,
  config: CodeIndexerConfig,
): Promise<string[]> {
  const files = await glob(config.include, {
    cwd: rootDir,
    ignore: config.exclude,
    nodir: true,
    absolute: false,
  });

  return files.sort();
}

/** Infer language from file extension */
export function inferLanguage(filePath: string): string {
  const ext = extname(filePath).toLowerCase().replace(".", "");

  const languageMap: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    py: "python",
    rs: "rust",
    go: "go",
    java: "java",
    rb: "ruby",
    cpp: "cpp",
    c: "c",
    h: "c",
    hpp: "cpp",
    cs: "csharp",
    swift: "swift",
    kt: "kotlin",
    lua: "lua",
    sh: "shell",
    bash: "shell",
    zsh: "shell",
    sql: "sql",
    md: "markdown",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
    xml: "xml",
    html: "html",
    css: "css",
    scss: "scss",
  };

  return languageMap[ext] ?? "text";
}

/** Compute sha256 hash of a file's contents */
export async function fileContentHash(rootDir: string, filePath: string): Promise<string> {
  const fullPath = join(rootDir, filePath);
  const content = await readFile(fullPath, "utf-8");
  return createHash("sha256").update(content).digest("hex");
}

/** Format a score as a percentage string */
export function formatScore(score: number): string {
  return `${(score * 100).toFixed(1)}%`;
}
