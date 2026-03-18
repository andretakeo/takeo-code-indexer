# Smart Sync & Clear Command Design

## Problem

The current `index` command always re-embeds everything and never removes stale data:
- **Deleted files** remain in the index
- **Renamed files** create duplicates (old + new path)
- **Changed files** leave stale chunks at old line ranges
- **No way to reset** — no CLI command to wipe or selectively clean the index

## Design

### 1. Smart Sync (default `index` behavior)

The `index` command becomes a sync operation:

1. Discover files on disk (existing logic)
2. Get indexed file paths + content hashes from Qdrant
3. Diff the two sets:
   - **Files on disk but not in index** → add (chunk + embed + upsert)
   - **Files in index but not on disk** → remove (delete vectors by filePath)
   - **Files in both** → compare content hash (sha256 of file contents). Changed → remove old chunks + re-add. Unchanged → skip
4. Report expanded stats

Content hash (sha256 of file contents) is stored in Qdrant payload alongside existing fields. No external state file needed.

#### Change detection

- Hash: `sha256(fileContents)` stored as `contentHash` in every chunk's payload for that file
- On re-index, read each file, hash it, compare against stored hash
- If hash matches → skip entirely (no embedding call)
- If hash differs → delete all existing chunks for that file, re-chunk, re-embed, upsert

**Edge cases:**
- **First run / empty collection**: `getIndexedFileHashes()` returns empty map → all files classified as "new" → full index. No special-case handling needed.
- **`initialize()` ordering**: must always be called before `getIndexedFileHashes()` to ensure collection exists.
- Deletion uses `deleteByFilePaths` (filter by `filePath` payload), NOT `delete(ids)` — chunk IDs shift when file content changes, so file-level deletion is the correct granularity.

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

### 2. `--fresh` flag

`code-indexer index --fresh` skips the diff — drops the collection and re-indexes everything from scratch.

Implementation: drop collection → `initialize` recreates it → index all files (no diff logic).

### 3. `clear` command

```
code-indexer clear                          # drop entire collection
code-indexer clear --file src/auth.ts       # remove chunks for one file
code-indexer clear --file "src/hooks/**"    # glob pattern
code-indexer clear -y                       # skip confirmation prompt
```

- **No args**: drops the entire collection. Shows confirmation prompt: "This will delete all N vectors. Continue? (y/n)"
- **`--file <path>`**: filters by `filePath` payload in Qdrant, deletes matching points. Supports exact paths and glob patterns (matched client-side against indexed file paths using `minimatch` from the existing `glob` dependency).
- **`-y, --yes`**: skip confirmation for scripting.

### 4. VectorStore interface changes

New methods on `VectorStore`:

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
  drop(): Promise<void>;                                  // drop entire collection (idempotent — no-op if collection doesn't exist)
}
```

**Implementation notes:**
- `getIndexedFileHashes()` scrolls all points with `with_payload: ["filePath", "contentHash"]`, deduplicating by filePath. Cost is O(total_chunks) per call — acceptable for typical projects, but worth noting.
- `deleteByFilePaths()` uses Qdrant's filter API: `{ must: [{ key: "filePath", match: { any: paths } }] }`. Batch into groups of 100 paths if the list is large. Returns void since Qdrant's delete response doesn't include a count.
- `drop()` must handle "collection not found" gracefully (no-op).
- A Qdrant payload index on `filePath` should be created during `initialize()` for filter performance.

### 5. Payload schema change

Every chunk's Qdrant payload gains a `contentHash` field:

```typescript
{
  chunkId: string;
  filePath: string;
  content: string;
  startLine: number;
  endLine: number;
  language: string;
  metadata: Record<string, unknown>;
  contentHash: string;  // NEW — sha256 of full file contents
}
```

All chunks from the same file share the same `contentHash`. This is redundant per-chunk but avoids needing a separate file-level index.

### 6. CLI changes summary

```
code-indexer index [--dir <path>] [--fresh]    # smart sync by default, --fresh for full rebuild
code-indexer clear [--file <path>] [-y]        # wipe collection or remove specific files
```

### 7. Skill updates

Update `code-indexer-setup` and add a `code-indexer-clear` skill template describing the new commands.
