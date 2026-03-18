import { describe, it, expect } from "vitest";
import { SKILLS } from "../src/cli/skills.js";

describe("skill templates", () => {
  it("should export 4 skills", () => {
    expect(SKILLS).toHaveLength(4);
  });

  it("each skill should have name, dirName, and content", () => {
    for (const skill of SKILLS) {
      expect(skill.dirName).toBeTruthy();
      expect(skill.content).toContain("---");
      expect(skill.content).toContain("name:");
      expect(skill.content).toContain("description:");
    }
  });

  it("should include all expected skills", () => {
    const names = SKILLS.map((s) => s.dirName);
    expect(names).toContain("code-indexer-index");
    expect(names).toContain("code-indexer-search");
    expect(names).toContain("code-indexer-status");
    expect(names).toContain("code-indexer-setup");
  });
});
