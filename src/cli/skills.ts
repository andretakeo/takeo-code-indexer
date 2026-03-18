export interface SkillTemplate {
  dirName: string;
  content: string;
}

export const SKILLS: SkillTemplate[] = [
  {
    dirName: "code-indexer-index",
    content: `---
name: code-indexer-index
description: Use code-indexer to index or re-index a codebase for semantic search. Use when the user wants to index files, re-index after changes, or set up semantic search for a project.
---

## Index a codebase

\`\`\`sh
code-indexer index                            # Index current directory
code-indexer index --dir /path/to/project     # Index a specific directory
code-indexer index --fresh                    # Drop index and re-index from scratch
\`\`\`

During development (not installed globally):
\`\`\`sh
npx tsx src/cli/index.ts index --dir /path/to/project
\`\`\`

## Smart sync

Re-running \`index\` only processes changed files:
- **New files** are chunked, embedded, and added
- **Changed files** (content hash differs) are re-embedded
- **Unchanged files** are skipped (no embedding cost)
- **Deleted files** are removed from the index

Use \`--fresh\` to force a full re-index from scratch.

## Output

Shows stats after indexing: files found, added, updated, skipped, removed, chunks generated/indexed, and duration.
`,
  },
  {
    dirName: "code-indexer-search",
    content: `---
name: code-indexer-search
description: Use code-indexer to search a codebase semantically. Use when the user wants to find code by natural language query, locate where something is implemented, or explore the codebase.
---

## Search the indexed codebase

\`\`\`sh
code-indexer search "authentication middleware"
code-indexer search "database connection pool" --limit 10
code-indexer search "error handling" --dir /path/to/project
\`\`\`

During development (not installed globally):
\`\`\`sh
npx tsx src/cli/index.ts search "query" --limit 5
\`\`\`

## Interpreting results

- Each result shows: file path, line range, relevance score (percentage)
- **> 80%** (green): strong match
- **60-80%** (yellow): partial match
- **< 60%** (red): weak match
- Results include a 3-line preview of the matched chunk

## Query tips

- Use natural language: "where is the user login handled"
- Be specific: "JWT token validation" works better than "tokens"
- Describe behavior: "function that sends emails" finds email-related code
- Use domain terms: match the language used in the codebase
`,
  },
  {
    dirName: "code-indexer-status",
    content: `---
name: code-indexer-status
description: Use code-indexer to check index health and coverage. Use when the user wants to know if the index is up to date, how much of the codebase is indexed, or verify the configuration.
---

## Check index status

\`\`\`sh
code-indexer status
code-indexer status --dir /path/to/project
\`\`\`

During development (not installed globally):
\`\`\`sh
npx tsx src/cli/index.ts status
\`\`\`

## Output fields

- **Store**: vector store type (lancedb or qdrant)
- **Files on disk**: total files matching include/exclude patterns
- **Files indexed**: files that have been embedded and stored
- **Coverage**: percentage of discoverable files that are indexed
- **Vectors stored**: total chunk count in the store

## When coverage is low

If coverage is below 100%, the index is out of date. Run \`code-indexer index\` to sync.

Smart sync will only process new and changed files — unchanged files are skipped.
`,
  },
  {
    dirName: "code-indexer-setup",
    content: `---
name: code-indexer-setup
description: Use code-indexer to configure semantic search settings. Use when the user wants to set up code-indexer, change which files are indexed, ignore files, switch embedding providers, or configure the vector store.
---

## Quick start

No external services required! code-indexer uses embedded LanceDB by default — just run:

\`\`\`sh
export OPENAI_API_KEY=sk-...
code-indexer index --dir /path/to/project
\`\`\`

Data is stored in \`.code-indexer/\` in the project root. Add it to \`.gitignore\`.

## Configuration file

Create \`.code-indexer.json\` in the project root:

\`\`\`json
{
  "include": ["src/**/*.{ts,tsx,js,jsx}"],
  "exclude": ["**/node_modules/**", "**/dist/**", "**/*.test.*"],
  "chunkMaxLines": 60,
  "chunkOverlap": 5,
  "embedding": {
    "provider": "openai",
    "model": "text-embedding-3-small",
    "dimensions": 1536
  }
}
\`\`\`

Also supports: \`.code-indexer.yaml\`, \`.code-indexer.yml\`, \`.code-indexerrc\`, \`code-indexer.config.js\`

## Ignoring files

Add glob patterns to the \`exclude\` array:

\`\`\`json
{
  "exclude": [
    "**/node_modules/**",
    "**/dist/**",
    "**/*.test.*",
    "**/*.spec.*",
    "**/fixtures/**",
    "**/generated/**"
  ]
}
\`\`\`

## Embedding providers

### OpenAI (default, requires API key)
\`\`\`json
{
  "embedding": {
    "provider": "openai",
    "model": "text-embedding-3-small",
    "dimensions": 1536
  }
}
\`\`\`
Requires \`OPENAI_API_KEY\` environment variable.

### Ollama (no API key needed)
\`\`\`sh
ollama pull nomic-embed-text
\`\`\`
\`\`\`json
{
  "embedding": {
    "provider": "ollama",
    "model": "nomic-embed-text",
    "baseUrl": "http://localhost:11434",
    "dimensions": 768
  }
}
\`\`\`
**Important**: \`baseUrl\` is the Ollama server URL (default: \`http://localhost:11434\`).

## Advanced: Remote Qdrant

To use Qdrant instead of the embedded LanceDB:

\`\`\`sh
docker run -p 6333:6333 qdrant/qdrant
\`\`\`

\`\`\`json
{
  "store": {
    "type": "qdrant",
    "url": "http://localhost:6333",
    "collectionName": "my-project",
    "apiKey": "optional-api-key"
  }
}
\`\`\`

The legacy \`qdrant\` config key is still supported for backwards compatibility.
`,
  },
  {
    dirName: "code-indexer-clear",
    content: `---
name: code-indexer-clear
description: Use code-indexer to clear or remove files from the search index. Use when the user wants to reset the index, remove specific files, or clean up stale entries.
---

## Clear the index

\`\`\`sh
code-indexer clear                          # drop entire index (with confirmation)
code-indexer clear -y                       # drop without confirmation
code-indexer clear --file src/auth.ts       # remove one file
code-indexer clear --file "src/hooks/**"    # remove files matching glob pattern
\`\`\`

## When to use

- After restructuring/renaming many files (then re-index)
- To remove specific files you don't want in search results
- To start fresh: \`code-indexer clear -y && code-indexer index\`
- Alternatively: \`code-indexer index --fresh\` does clear + re-index in one step

## Notes

- \`clear\` without \`--file\` asks for confirmation unless \`-y\` is passed
- Glob patterns match against indexed file paths (e.g., \`"src/**/*.test.ts"\`)
- The \`--fresh\` flag on \`index\` is equivalent to clear + re-index
`,
  },
];
