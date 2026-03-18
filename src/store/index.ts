import type { StoreConfig, VectorStore } from "../types.js";
import { LanceStore } from "./lancedb.js";
import { QdrantStore } from "./qdrant.js";

export function createStore(config: StoreConfig, rootDir: string): VectorStore {
  switch (config.type) {
    case "lancedb": {
      const dbPath = `${rootDir}/.code-indexer`;
      return new LanceStore(dbPath);
    }
    case "qdrant": {
      const url = config.url ?? "http://localhost:6333";
      const collectionName = config.collectionName ?? "code-indexer";
      return new QdrantStore(url, collectionName, config.apiKey);
    }
    default:
      throw new Error(`Unknown store type: ${(config as any).type}`);
  }
}
