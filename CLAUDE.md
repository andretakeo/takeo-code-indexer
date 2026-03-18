# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build          # Build with tsup (ESM output to dist/)
npm run dev            # Run CLI in dev mode: npx tsx src/cli/index.ts <command>
npm test               # Run tests (vitest)
npm run test:watch     # Run tests in watch mode
npm run typecheck      # Type check without emitting
npm run lint           # ESLint on src/
```

Run the CLI in development:
```bash
npx tsx src/cli/index.ts index --dir /path/to/project
npx tsx src/cli/index.ts index --fresh --dir /path/to/project
npx tsx src/cli/index.ts search "query"
npx tsx src/cli/index.ts status
npx tsx src/cli/index.ts clear --file "src/**/*.test.ts"
npx tsx src/cli/index.ts install [--global | --local]
```

Run a single test file:
```bash
npx vitest run tests/chunker.test.ts
```

## Architecture

Semantic code search CLI: scans files → chunks them → generates embeddings → stores vectors → searches via cosine similarity. Default store is embedded LanceDB (no server required); Qdrant is supported as an alternative.

**Pipeline flow:** `CLI (commander) → Indexer → Chunker + EmbeddingProvider + VectorStore`

- **`src/cli/index.ts`** — Entry point. Five commands: `index`, `search`, `status`, `clear`, `install`. Wires up config, embedder, store factory, and indexer.
- **`src/cli/install.ts`** — `install` command. Writes Claude Code skill files to `~/.claude/skills/` (global) or `.claude/skills/` (local). Interactive prompt when no flag given.
- **`src/cli/skills.ts`** — Skill template definitions. Five skills: `code-indexer-index`, `code-indexer-search`, `code-indexer-status`, `code-indexer-setup`, `code-indexer-clear`.
- **`src/indexer/indexer.ts`** — Orchestrator with smart sync. Discovers files → computes content hashes → diffs against stored hashes → only re-embeds new/changed files. Supports `--fresh` flag to drop and re-index.
- **`src/chunker/text-chunker.ts`** — Language-agnostic text chunker using a sliding window with natural break detection (blank lines, closing braces, function/class declarations, comment separators). Configurable via `chunkMaxLines` and `chunkOverlap`.
- **`src/embeddings/`** — Provider pattern behind `EmbeddingProvider` interface. Factory in `index.ts`, implementations in `openai.ts` (batched, uses OpenAI SDK) and `ollama.ts` (sequential, uses fetch to `/api/embed`).
- **`src/store/index.ts`** — Store factory. Creates LanceDB or Qdrant store based on config.
- **`src/store/lancedb.ts`** — `VectorStore` implementation for LanceDB (embedded, stores data in `.code-indexer/`).
- **`src/store/qdrant.ts`** — `VectorStore` implementation for Qdrant (remote). Converts chunk IDs (sha256 hex) to numeric IDs by parsing the first 13 hex chars. Batches upserts in groups of 100.
- **`src/utils/config.ts`** — Config loading via cosmiconfig. Searches for `.code-indexer.json`, `.code-indexer.yaml`, etc. Merges user config with `DEFAULT_CONFIG` from `types.ts`. Supports backwards-compat for old `qdrant` config key.
- **`src/utils/helpers.ts`** — File discovery (glob), chunk ID generation (sha256), file content hashing, language inference from extension, score formatting.
- **`src/types.ts`** — All shared interfaces (`CodeChunk`, `EmbeddingProvider`, `VectorStore`, `StoreConfig`, `CodeIndexerConfig`) and `DEFAULT_CONFIG`.

## Key Patterns

- ESM-only (`"type": "module"` in package.json). All internal imports use `.js` extensions.
- Interfaces for extension points: `EmbeddingProvider` and `VectorStore` are the abstractions to implement for new providers/stores.
- Config is loaded via cosmiconfig from the project root being indexed (not this repo's root).
- Tests use vitest with globals enabled. Test fixtures are created in temp dirs that are cleaned up in `afterAll`.

## Prerequisites

- Node.js >= 20
- `OPENAI_API_KEY` env var for OpenAI embeddings, or Ollama running locally
- No external database required (LanceDB is embedded by default)
