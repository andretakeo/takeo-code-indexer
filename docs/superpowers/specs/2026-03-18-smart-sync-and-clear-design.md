# Smart Sync, Clear Command & LanceDB Migration Design

## Problem

The current `index` command always re-embeds everything and never removes stale data:
- **Deleted files** remain in the index
- **Renamed files** create duplicates (old + new path)
- **Changed files** leave stale chunks at old line ranges
- **No way to reset** — no CLI command to wipe or selectively clean the index
- **Qdrant requires a separate server** — Docker or remote instance needed, heavy for a dev tool

## Design

### 1. Replace Qdrant with LanceDB (embedded)

Switch the default vector store from Qdrant (requires separate server) to LanceDB (embedded, runs in-process).

**Why LanceDB:**
- Truly embedded in Node.js — no Docker, no external process
- Data stored as files in the project directory (`.code-indexer/`)
- Works offline, zero setup
- Supports cosine similarity search natively
- npm package: `@lancedb/lancedb`

**Storage location:** `.code-indexer/` in the project root being indexed. Users should add this to `.gitignore`.

**LanceDB API mapping:**
```typescript
import lancedb from "@lancedb/lancedb";

// connect — opens or creates the database directory
const db = await lancedb.connect(".code-indexer");

// create table — pass array of objects with a `vector` field
const table = await db.createTable("chunks", data, { mode: "overwrite" });

// insert
await table.add(records);

// search — cosine similarity by default
const results = await table.search(queryVector).limit(10).toArray();

// delete — SQL-like filter string
await table.delete('filePath = "src/auth.ts"');

// drop table
await db.dropTable("chunks", { ignoreMissing: true });
```

**Table schema (single table: "chunks"):**
```typescript
{
  id: string;            // chunk ID (sha256 hex)
  filePath: string;
  content: string;
  startLine: number;
  endLine: number;
  language: string;
  contentHash: string;   // sha256 of full file contents
  vector: number[];      // embedding vector
}
```

**Migration approach:**
- Create `src/store/lancedb.ts` implementing `VectorStore`
- Make LanceDB the default store (no config needed — just works)
- Keep `QdrantStore` as an optional alternative for users with remote Qdrant setups
- Add `store` config option: `{ type: "lancedb" }` (default) or `{ type: "qdrant", url, collectionName, apiKey }`
- Remove `@qdrant/js-client-rest` from required dependencies, move to optional/peer

### 2. Smart Sync (default `index` behavior)

The `index` command becomes a sync operation:

1. Discover files on disk (existing logic)
2. Get indexed file paths + content hashes from the store
3. Diff the two sets:
   - **Files on disk but not in index** → add (chunk + embed + upsert)
   - **Files in index but not on disk** → remove (delete by filePath)
   - **Files in both** → compare content hash (sha256 of file contents). Changed → remove old chunks + re-add. Unchanged → skip
4. Report expanded stats

Content hash (sha256 of file contents) is stored in the vector store alongside existing fields. No external state file needed.

#### Change detection

- Hash: `sha256(fileContents)` stored as `contentHash` for every chunk
- On re-index, read each file, hash it, compare against stored hash
- If hash matches → skip entirely (no embedding call)
- If hash differs → delete all existing chunks for that file, re-chunk, re-embed, upsert

**Edge cases:**
- **First run / empty store**: `getIndexedFileHashes()` returns empty map → all files classified as "new" → full index. No special-case handling needed.
- **`initialize()` ordering**: must always be called before `getIndexedFileHashes()` to ensure table exists.
- Deletion uses `deleteByFilePaths` (filter by `filePath`), NOT `delete(ids)` — chunk IDs shift when file content changes, so file-level deletion is the correct granularity.

**Alternatives considered:**
- mtime-based detection was rejected: unreliable across systems (git checkout, network drives), and reading files to hash is negligible compared to embedding cost.

#### Expanded IndexStats

```typescript
interface IndexStats {
  filesFound: number;        // files discovered on disk
  filesAdded: number;        // new files indexed
  filesUpdated: number;      // re-embedded (content changed)
  filesSkipped: number;      // unchanged (hash match)
  filesRemoved: number;      // deleted from index (not on disk)
  chunksGenerated: number;
  chunksIndexed: number;
  durationMs: number;
}
```

**Invariants:**
- `filesFound === filesAdded + filesUpdated + filesSkipped`
- `filesRemoved` is disjoint from `filesFound` (files NOT on disk)

### 3. `--fresh` flag

`code-indexer index --fresh` skips the diff — drops the table and re-indexes everything from scratch.

Implementation: drop table → `initialize` recreates it → index all files (no diff logic).

### 4. `clear` command

```
code-indexer clear                          # drop entire table
code-indexer clear --file src/auth.ts       # remove chunks for one file
code-indexer clear --file "src/hooks/**"    # glob pattern
code-indexer clear -y                       # skip confirmation prompt
```

- **No args**: drops the table. Shows confirmation prompt: "This will delete all N vectors. Continue? (y/n)"
- **`--file <path>`**: deletes matching rows. For LanceDB: `table.delete('filePath = "src/auth.ts"')`. Glob patterns matched client-side against indexed file paths using `minimatch`.
- **`-y, --yes`**: skip confirmation for scripting.

### 5. VectorStore interface changes

```typescript
interface VectorStore {
  // existing
  initialize(dimensions: number): Promise<void>;
  upsert(chunks: CodeChunk[], vectors: number[][]): Promise<void>;
  search(vector: number[], limit: number): Promise<SearchResult[]>;
  delete(ids: string[]): Promise<void>;
  count(): Promise<number>;
  getIndexedFilePaths(): Promise<string[]>;

  // new
  getIndexedFileHashes(): Promise<Map<string, string>>;  // filePath → contentHash
  deleteByFilePaths(paths: string[]): Promise<void>;      // delete all chunks matching file paths
  drop(): Promise<void>;                                  // drop table/collection (idempotent)
}
```

**LanceDB implementation notes:**
- `getIndexedFileHashes()`: query all rows selecting only `filePath` and `contentHash` columns, deduplicate by filePath into a Map.
- `deleteByFilePaths()`: for each path, `table.delete(\`filePath = "${path}"\`)`. Batch if needed.
- `drop()`: `db.dropTable("chunks", { ignoreMissing: true })`.
- `upsert()`: LanceDB `add()` for new rows. For updates, delete old rows first then add new ones.
- `search()`: `table.search(vector).limit(limit).toArray()` — returns results with `_distance` field (lower = more similar for cosine).

### 6. Config changes

```typescript
interface CodeIndexerConfig {
  // existing fields...

  // replace qdrant-specific config with generic store config
  store: {
    type: "lancedb" | "qdrant";
    // lancedb: no extra config needed (uses .code-indexer/ in project root)
    // qdrant: url, collectionName, apiKey
    url?: string;
    collectionName?: string;
    apiKey?: string;
  };
}
```

Default config:
```typescript
store: {
  type: "lancedb",
}
```

Backwards compatibility: if config has `qdrant` key (old format), treat as `{ type: "qdrant", ...qdrant }`.

### 7. CLI changes summary

```
code-indexer index [--dir <path>] [--fresh]    # smart sync by default, --fresh for full rebuild
code-indexer clear [--file <path>] [-y]        # wipe table or remove specific files
code-indexer status [--dir <path>]             # show store type, vector count, coverage
code-indexer search <query> [--limit N]        # unchanged
code-indexer install [--global | --local]      # unchanged
```

### 8. Dependency changes

- **Add**: `@lancedb/lancedb`
- **Keep**: `@qdrant/js-client-rest` (for users who configure Qdrant)
- No new dependencies for the smart sync logic (sha256 from `node:crypto`, minimatch from `glob`)

### 9. Skill updates

- Update `code-indexer-setup` skill: show LanceDB as default (no server needed), Qdrant as optional
- Add `code-indexer-clear` skill template describing the new commands
- Update setup skill to mention `.code-indexer/` should be in `.gitignore`
