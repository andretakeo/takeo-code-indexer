import { cosmiconfig } from "cosmiconfig";
import { DEFAULT_CONFIG, type CodeIndexerConfig, type StoreConfig } from "../types.js";

const MODULE_NAME = "code-indexer";

const explorer = cosmiconfig(MODULE_NAME, {
  searchPlaces: [
    `.${MODULE_NAME}.json`,
    `.${MODULE_NAME}.yaml`,
    `.${MODULE_NAME}.yml`,
    `.${MODULE_NAME}rc`,
    `${MODULE_NAME}.config.js`,
    `${MODULE_NAME}.config.ts`,
  ],
});

export async function loadConfig(
  cwd: string = process.cwd(),
): Promise<CodeIndexerConfig> {
  const result = await explorer.search(cwd);

  if (!result || result.isEmpty) {
    return { ...DEFAULT_CONFIG };
  }

  const userConfig = result.config as Partial<CodeIndexerConfig> & {
    qdrant?: { url?: string; collectionName?: string; apiKey?: string };
  };

  // Resolve store config: new `store` key takes precedence over legacy `qdrant` key
  let store: StoreConfig;
  if (userConfig.store) {
    store = { ...DEFAULT_CONFIG.store, ...userConfig.store };
  } else if (userConfig.qdrant) {
    store = {
      type: "qdrant",
      url: userConfig.qdrant.url,
      collectionName: userConfig.qdrant.collectionName,
      apiKey: userConfig.qdrant.apiKey,
    };
  } else {
    store = DEFAULT_CONFIG.store;
  }

  return {
    include: userConfig.include ?? DEFAULT_CONFIG.include,
    exclude: userConfig.exclude ?? DEFAULT_CONFIG.exclude,
    chunkMaxLines: userConfig.chunkMaxLines ?? DEFAULT_CONFIG.chunkMaxLines,
    chunkOverlap: userConfig.chunkOverlap ?? DEFAULT_CONFIG.chunkOverlap,
    embedding: {
      ...DEFAULT_CONFIG.embedding,
      ...userConfig.embedding,
    },
    store,
  };
}
