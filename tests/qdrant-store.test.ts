import { describe, it, expect } from "vitest";
import { QdrantStore } from "../src/store/qdrant.js";

describe("QdrantStore", () => {
  it("should implement getIndexedFilePaths", () => {
    const store = new QdrantStore("http://localhost:6333", "test");
    expect(typeof store.getIndexedFilePaths).toBe("function");
  });
});
