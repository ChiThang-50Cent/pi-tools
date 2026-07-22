import { describe, expect, it, vi } from "vitest";

vi.mock("@earendil-works/pi-coding-agent", () => ({}));
vi.mock("typebox", () => ({
  Type: new Proxy({}, { get: () => () => ({}) }),
}));
vi.mock("@earendil-works/pi-tui", () => ({
  Text: class MockText {
    constructor(public content = "") {}
  },
}));

import { registerCodeSearch } from "../tools/code_search.js";
import { registerWebSearch } from "../tools/web_search.js";

type RegisteredTool = {
  description: string;
  promptGuidelines: string[];
};

function capture(registerFn: (pi: { registerTool: (tool: RegisteredTool) => void }) => void): RegisteredTool {
  let tool!: RegisteredTool;
  registerFn({ registerTool: (value) => { tool = value; } });
  return tool;
}

describe("search prompt guidance", () => {
  it("discourages repeated web searches and removes spam-oriented MUST wording", () => {
    const tool = capture(registerWebSearch);
    const guidance = tool.promptGuidelines.join(" ");

    expect(tool.description).not.toContain("MUST");
    expect(guidance).toContain("Reuse relevant results");
    expect(guidance).toContain("one well-formed query");
    expect(guidance).toContain("equivalent queries in parallel");
    expect(guidance).toContain("stated cooldown");
    expect(guidance).toContain("do not retry during it");
  });

  it("applies the same reuse and cooldown guidance to code search", () => {
    const tool = capture(registerCodeSearch);
    const guidance = tool.promptGuidelines.join(" ");

    expect(guidance).toContain("Reuse relevant code-search results");
    expect(guidance).toContain("one well-formed query");
    expect(guidance).toContain("equivalent queries in parallel");
    expect(guidance).toContain("stated cooldown");
    expect(guidance).toContain("do not retry during it");
  });
});
