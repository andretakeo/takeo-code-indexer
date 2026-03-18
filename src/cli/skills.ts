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
code-indexer index                    # Index current directory
code-indexer index --dir /path/to/project  # Index a specific directory
\`\`\`

During development (not installed globally):
\`\`\`sh
npx tsx src/cli/index.ts index --dir /path/to/project
\`\`\`

## When to re-index

- After adding, renaming, or deleting files
- After significant code changes across many files
- After changing \`.code-indexer.json\` include/exclude patterns
- After switching embedding provider or model

## Output

Shows stats after indexing: files found, files processed, chunks generated, chunks indexed, and duration.
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

- **Files on disk**: total files matching include/exclude patterns
- **Files indexed**: files that have been embedded and stored in Qdrant
- **Coverage**: percentage of discoverable files that are indexed
- **Vectors stored**: total chunk count in Qdrant

## When coverage is low

If coverage is below 100%, the index is out of date. Run \`code-indexer index\` to re-index.

If Qdrant shows "unreachable", ensure Qdrant is running:
\`\`\`sh
docker run -p 6333:6333 qdrant/qdrant
\`\`\`
`,
  },
  {
    dirName: "code-indexer-setup",
    content: `---
name: code-indexer-setup
description: Use code-indexer to configure semantic search settings. Use when the user wants to set up code-indexer, change which files are indexed, ignore files, switch embedding providers, or configure Qdrant.
---

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
  },
  "qdrant": {
    "url": "http://localhost:6333",
    "collectionName": "my-project"
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
**Important**: \`baseUrl\` is the Ollama server URL (default: \`http://localhost:11434\`). If Ollama runs on a different machine, update this. This is separate from the Qdrant \`url\` — do not confuse them.

## Qdrant setup

Start Qdrant locally with Docker:
\`\`\`sh
docker run -p 6333:6333 qdrant/qdrant
\`\`\`

Use a custom URL or collection name:
\`\`\`json
{
  "qdrant": {
    "url": "http://localhost:6333",
    "collectionName": "my-project",
    "apiKey": "optional-api-key"
  }
}
\`\`\`
`,
  },
];
