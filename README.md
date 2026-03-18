# Code Indexer

Semantic code search CLI powered by embeddings and Qdrant vector database.

Index your entire codebase and search it using natural language queries — "find the authentication middleware", "where is the database connection configured", etc.

## Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────────┐     ┌─────────┐
│  File System  │────▶│   Chunker    │────▶│ Embedding Provider│────▶│ Qdrant  │
│  (glob scan)  │     │ (text-based) │     │ (OpenAI/Ollama)  │     │ (store) │
└──────────────┘     └──────────────┘     └──────────────────┘     └─────────┘
```

## Quick Start

### Prerequisites

- Node.js ≥ 20
- Qdrant running locally (or remote)
- OpenAI API key (or Ollama for local embeddings)

### Install & Run

```bash
# Clone and install
git clone <repo-url> && cd code-indexer
npm install

# Build and link the CLI globally
npm run build && npm link

# Start Qdrant (Docker)
docker run -p 6333:6333 qdrant/qdrant

# Set your OpenAI key
export OPENAI_API_KEY=sk-...

# Index your codebase
code-indexer index --dir /path/to/your/project

# Search
code-indexer search "authentication middleware"

# Check status
code-indexer status
```

### Using Ollama (local, no API key needed)

```bash
# Pull an embedding model
ollama pull nomic-embed-text

# Configure .code-indexer.json
{
  "embedding": {
    "provider": "ollama",
    "model": "nomic-embed-text",
    "dimensions": 768
  }
}
```

## Configuration

Create a `.code-indexer.json` in your project root:

```json
{
  "include": ["src/**/*.{ts,tsx,js,jsx}"],
  "exclude": ["**/node_modules/**", "**/dist/**"],
  "chunkMaxLines": 60,
  "chunkOverlap": 5,
  "embedding": {
    "provider": "openai",
    "model": "text-embedding-3-small",
    "dimensions": 1536
  },
  "qdrant": {
    "url": "http://localhost:6333",
    "collectionName": "my-project"
  }
}
```

### Config Options

| Option | Default | Description |
|--------|---------|-------------|
| `include` | Wide pattern | Glob patterns for files to index |
| `exclude` | node_modules, dist, etc. | Glob patterns to skip |
| `chunkMaxLines` | 60 | Max lines per chunk |
| `chunkOverlap` | 5 | Overlapping lines between chunks |
| `embedding.provider` | `openai` | `openai` or `ollama` |
| `embedding.model` | `text-embedding-3-small` | Model name |
| `embedding.dimensions` | 1536 | Vector dimensions |
| `qdrant.url` | `http://localhost:6333` | Qdrant server URL |
| `qdrant.collectionName` | `code-indexer` | Collection name |

## CLI Commands

### `code-indexer index`

Scans, chunks, embeds, and stores your codebase.

```bash
code-indexer index [--dir <path>]
```

### `code-indexer search <query>`

Natural language search over your indexed code.

```bash
code-indexer search "database connection pool" [--limit 10] [--dir <path>]
```

### `code-indexer status`

Shows current config and index stats.

```bash
code-indexer status [--dir <path>]
```

### `code-indexer install`

Installs Claude Code skill files so Claude can use code-indexer via slash commands.

```bash
code-indexer install              # interactive prompt
code-indexer install --global     # install to ~/.claude/skills/
code-indexer install --local      # install to .claude/skills/ in current project
```

## How Chunking Works

The chunker is language-agnostic and uses a text-based sliding window approach:

1. Files are split into lines
2. A window of `chunkMaxLines` slides through the file
3. Break points are chosen at "natural boundaries":
   - Blank lines
   - Closing braces `}`
   - Function/class declarations
   - Comment separators (`// ---`, `# ===`, etc.)
4. Consecutive chunks overlap by `chunkOverlap` lines for context continuity

Each chunk is embedded with its file path and language for richer semantic context.

## Development

```bash
# Run tests
npm test

# Type check
npm run typecheck

# Build for distribution
npm run build
```

## Roadmap

- [ ] Incremental indexing (only re-index changed files)
- [ ] AST-aware chunking for supported languages
- [ ] Watch mode for auto-reindexing
- [ ] TUI interface with interactive results
- [ ] Support for more embedding providers (Cohere, local GGUF)
- [ ] Export results as JSON/Markdown
```
