import lancedb from "@lancedb/lancedb";
import type { Connection, Table } from "@lancedb/lancedb";
import type { CodeChunk, SearchResult, VectorStore } from "../types.js";

interface LanceRecord {
  [key: string]: unknown;
  id: string;
  filePath: string;
  content: string;
  startLine: number;
  endLine: number;
  language: string;
  contentHash: string;
  vector: number[];
}

export class LanceStore implements VectorStore {
  private dbPath: string;
  private db: Connection | null = null;
  private table: Table | null = null;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async initialize(_dimensions: number): Promise<void> {
    this.db = await lancedb.connect(this.dbPath);
    const names = await this.db.tableNames();
    if (names.includes("chunks")) {
      this.table = await this.db.openTable("chunks");
    }
  }

  async upsert(chunks: CodeChunk[], vectors: number[][]): Promise<void> {
    if (chunks.length === 0) return;

    const records: LanceRecord[] = chunks.map((chunk, idx) => ({
      id: chunk.id,
      filePath: chunk.filePath,
      content: chunk.content,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      language: chunk.language,
      contentHash: chunk.contentHash ?? "",
      vector: vectors[idx],
    }));

    if (this.table === null) {
      this.table = await this.db!.createTable("chunks", records);
    } else {
      await this.table.add(records);
    }
  }

  async search(vector: number[], limit: number): Promise<SearchResult[]> {
    if (this.table === null) return [];

    const query = this.table.search(vector) as any;
    const results = await (query.distanceType ? query.distanceType("cosine") : query)
      .limit(limit)
      .toArray();

    return results.map((r: any) => ({
      chunk: {
        id: r.id,
        filePath: r.filePath,
        content: r.content,
        startLine: r.startLine,
        endLine: r.endLine,
        language: r.language,
        contentHash: r.contentHash,
      },
      score: 1 - r._distance,
    }));
  }

  async delete(ids: string[]): Promise<void> {
    if (this.table === null || ids.length === 0) return;

    const escaped = ids.map((id) => `'${this.escapeSQL(id)}'`).join(", ");
    await this.table.delete(`id IN (${escaped})`);
  }

  async count(): Promise<number> {
    if (this.table === null) return 0;
    return this.table.countRows();
  }

  async getIndexedFilePaths(): Promise<string[]> {
    if (this.table === null) return [];

    const rows = await this.table
      .query()
      .select(["filePath"])
      .toArray();

    const paths = new Set<string>();
    for (const row of rows) {
      paths.add(row.filePath);
    }
    return [...paths].sort();
  }

  async getIndexedFileHashes(): Promise<Map<string, string>> {
    if (this.table === null) return new Map();

    const rows = await this.table
      .query()
      .select(["filePath", "contentHash"])
      .toArray();

    const hashes = new Map<string, string>();
    for (const row of rows) {
      hashes.set(row.filePath, row.contentHash);
    }
    return hashes;
  }

  async deleteByFilePaths(paths: string[]): Promise<void> {
    if (this.table === null || paths.length === 0) return;

    for (const p of paths) {
      await this.table.delete(`filePath = '${this.escapeSQL(p)}'`);
    }
  }

  async drop(): Promise<void> {
    if (this.db === null) return;

    const names = await this.db.tableNames();
    if (names.includes("chunks")) {
      await this.db.dropTable("chunks");
    }
    this.table = null;
  }

  private escapeSQL(value: string): string {
    return value.replace(/'/g, "''");
  }
}
