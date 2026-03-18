import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CodeChunk, CodeIndexerConfig } from "../types.js";
import { chunkId, inferLanguage } from "../utils/helpers.js";

/**
 * Language-agnostic text chunker.
 *
 * Strategy:
 *  1. Split file into lines.
 *  2. Walk with a sliding window of `chunkMaxLines` lines.
 *  3. Try to break at "natural boundaries" (blank lines, closing braces,
 *     dedent) to keep semantic units together.
 *  4. Overlap by `chunkOverlap` lines between consecutive chunks.
 */
export async function chunkFile(
  rootDir: string,
  filePath: string,
  config: CodeIndexerConfig,
): Promise<CodeChunk[]> {
  const fullPath = join(rootDir, filePath);
  const raw = await readFile(fullPath, "utf-8");
  const lines = raw.split("\n");

  // Skip empty / trivially small files
  if (lines.length <= 3) return [];

  const { chunkMaxLines, chunkOverlap } = config;
  const language = inferLanguage(filePath);
  const chunks: CodeChunk[] = [];

  let cursor = 0;
  let index = 0;

  while (cursor < lines.length) {
    let end = Math.min(cursor + chunkMaxLines, lines.length);

    // Try to find a natural break point near the end of the window
    if (end < lines.length) {
      const searchStart = Math.max(cursor + Math.floor(chunkMaxLines * 0.6), cursor);
      let bestBreak = -1;

      for (let i = end; i >= searchStart; i--) {
        if (isNaturalBreak(lines[i])) {
          bestBreak = i + 1; // include the break line
          break;
        }
      }

      if (bestBreak > cursor) {
        end = bestBreak;
      }
    }

    const chunkLines = lines.slice(cursor, end);
    const content = chunkLines.join("\n").trim();

    // If this would be a tiny trailing fragment, merge it into the previous chunk
    const minChunkLines = Math.max(Math.floor(chunkMaxLines * 0.1), 5);
    if (content.length > 0 && (end - cursor) >= minChunkLines) {
      chunks.push({
        id: chunkId(filePath, index),
        filePath,
        content,
        startLine: cursor + 1,
        endLine: end,
        language,
      });
      index++;
    } else if (content.length > 0 && chunks.length > 0) {
      // Merge tiny trailing fragment into previous chunk
      const prev = chunks[chunks.length - 1];
      const mergedLines = lines.slice(prev.startLine - 1, end);
      prev.content = mergedLines.join("\n").trim();
      prev.endLine = end;
    } else if (content.length > 0) {
      // First chunk is tiny (very small file) — still emit it
      chunks.push({
        id: chunkId(filePath, index),
        filePath,
        content,
        startLine: cursor + 1,
        endLine: end,
        language,
      });
      index++;
    }

    // Advance cursor; only apply overlap if there are more lines ahead
    if (end >= lines.length) {
      break;
    }
    const advance = end - cursor - chunkOverlap;
    cursor += Math.max(advance, 1);
  }

  return chunks;
}

/** Heuristic: is this line a "natural boundary" to break on? */
function isNaturalBreak(line: string | undefined): boolean {
  if (line === undefined) return false;
  const trimmed = line.trim();

  // Blank line
  if (trimmed === "") return true;
  // Closing braces / brackets (end of block)
  if (/^[}\])\;]+$/.test(trimmed)) return true;
  // Python-style: line that starts a new def/class
  if (/^(def |class |async def |export |import |from )/.test(trimmed)) return true;
  // Comment-only line (often a section separator)
  if (/^(\/\/|#|\/\*|\*|--)\s*[-=]{3,}/.test(trimmed)) return true;

  return false;
}

/** Chunk all discovered files */
export async function chunkFiles(
  rootDir: string,
  filePaths: string[],
  config: CodeIndexerConfig,
): Promise<CodeChunk[]> {
  const allChunks: CodeChunk[] = [];

  for (const fp of filePaths) {
    try {
      const chunks = await chunkFile(rootDir, fp, config);
      allChunks.push(...chunks);
    } catch (err) {
      // Skip files we can't read (binary, permissions, etc.)
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`⚠ Skipping ${fp}: ${msg}`);
    }
  }

  return allChunks;
}
