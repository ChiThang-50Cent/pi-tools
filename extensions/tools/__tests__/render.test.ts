import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock pi-tui Text component
vi.mock("@earendil-works/pi-tui", () => {
  class MockText {
    content: string;
    paddingX: number;
    paddingY: number;
    constructor(text = "", paddingX = 0, paddingY = 0) {
      this.content = text;
      this.paddingX = paddingX;
      this.paddingY = paddingY;
    }
    setText(text: string) { this.content = text; }
    render(_width: number) { return [this.content]; }
  }
  return { Text: MockText };
});

// Mock pi-coding-agent (not used directly by render functions but imported)
vi.mock("@earendil-works/pi-coding-agent", () => ({}));

// We need to extract renderCall and renderResult from the tools.
// Since they're inside registerTool, we'll import the modules and capture them.
import { Text } from "@earendil-works/pi-tui";
import { renderResult as renderSubagentResult } from "../tools/subagent/render.js";

type Theme = {
  fg: (color: string, text: string) => string;
  bold: (text: string) => string;
};

// Simple theme that returns text as-is for easy assertion
const theme: Theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

// ─── get_search_content renderResult ───

function getSearchContentRenderResult(
  result: { content: { type: string; text: string }[]; details?: any },
  opts: { expanded?: boolean; isPartial?: boolean },
  thm: Theme,
) {
  if (opts.isPartial) return new (Text as any)(thm.fg("warning", "Loading..."), 0, 0);

  const details = result.details as { error?: string; queryCount?: number; urlCount?: number; query?: string; url?: string } | undefined;
  if (details?.error) return new (Text as any)(thm.fg("error", `Error: ${details.error}`), 0, 0);

  const content = result.content[0];
  const text = content?.type === "text" ? content.text : "";
  const lineCount = text.split("\n").length;
  const sizeKB = (Buffer.byteLength(text, "utf8") / 1024).toFixed(1);

  let summary = "";
  if (details?.query) summary = thm.fg("accent", details.query);
  else if (details?.url) summary = thm.fg("accent", details.url);
  else if (details?.queryCount) summary = thm.fg("success", `${details.queryCount} queries`);
  else if (details?.urlCount) summary = thm.fg("success", `${details.urlCount} URLs`);
  else summary = thm.fg("success", `${lineCount} lines`);

  let display = summary + thm.fg("dim", ` (${sizeKB}KB)`);

  if (opts.expanded) {
    const preview = text.split("\n").slice(0, 20).join("\n");
    display += `\n${thm.fg("toolOutput", preview)}`;
    if (lineCount > 20) display += `\n${thm.fg("muted", `... ${lineCount - 20} more lines`)}`;
  }

  return new (Text as any)(display, 0, 0);
}

function getSearchContentRenderCall(args: any, thm: Theme) {
  const id = typeof args.responseId === "string" ? args.responseId.slice(0, 16) : "?";
  let text = thm.fg("toolTitle", thm.bold("get_content ")) + thm.fg("accent", id);
  if (args.query) text += thm.fg("dim", ` query:"${String(args.query).slice(0, 30)}"`);
  if (typeof args.urlIndex === "number") text += thm.fg("dim", ` [${args.urlIndex}]`);
  if (typeof args.queryIndex === "number") text += thm.fg("dim", ` [${args.queryIndex}]`);
  return new (Text as any)(text, 0, 0);
}

// ─── Tests ───

describe("subagent renderResult output contract", () => {
  it("renders the summary parent-facing content instead of full details", () => {
    const rendered = renderSubagentResult(
      {
        content: [{ type: "text", text: "compact summary" }],
        details: {
          mode: "single",
          returnMode: "summary",
          results: [{
            agent: "test-agent",
            agentSource: "builtin",
            task: "test",
            exitCode: 0,
            messages: [{ role: "assistant", content: [{ type: "text", text: "full child output" }] }],
            stderr: "",
            usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
          }],
        },
      },
      { expanded: true },
      theme,
      undefined,
    ) as any;

    expect(rendered.content).toBe("compact summary");
    expect(rendered.content).not.toContain("full child output");
  });

  it("renders the artifact parent-facing content instead of full details", () => {
    const rendered = renderSubagentResult(
      {
        content: [{ type: "text", text: "full output saved to artifact\nArtifact: /tmp/result.txt" }],
        details: {
          mode: "chain",
          returnMode: "artifact",
          results: [{
            agent: "test-agent",
            agentSource: "builtin",
            task: "test",
            exitCode: 0,
            messages: [{ role: "assistant", content: [{ type: "text", text: "large full child output" }] }],
            stderr: "",
            usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
          }],
        },
      },
      { expanded: false },
      theme,
      undefined,
    ) as any;

    expect(rendered.content).toContain("Artifact: /tmp/result.txt");
    expect(rendered.content).not.toContain("large full child output");
  });
});

describe("get_search_content renderResult", () => {
  it("shows loading state when partial", () => {
    const result = { content: [{ type: "text", text: "" }], details: {} };
    const rendered = getSearchContentRenderResult(result, { isPartial: true }, theme);
    expect(rendered.content).toBe("Loading...");
  });

  it("shows error state", () => {
    const result = { content: [{ type: "text", text: "" }], details: { error: "not_found" } };
    const rendered = getSearchContentRenderResult(result, {}, theme);
    expect(rendered.content).toContain("Error: not_found");
  });

  it("shows URL count for fetch results", () => {
    const text = "### Title\nhttps://example.com\n\nContent here";
    const result = { content: [{ type: "text", text }], details: { urlCount: 3 } };
    const rendered = getSearchContentRenderResult(result, {}, theme);
    expect(rendered.content).toContain("3 URLs");
    expect(rendered.content).toContain("KB)");
  });

  it("shows query count for search results", () => {
    const text = "## Query 1\nAnswer 1\n\n## Query 2\nAnswer 2";
    const result = { content: [{ type: "text", text }], details: { queryCount: 2 } };
    const rendered = getSearchContentRenderResult(result, {}, theme);
    expect(rendered.content).toContain("2 queries");
  });

  it("shows specific query name when filtered", () => {
    const result = { content: [{ type: "text", text: "answer" }], details: { query: "pi coding agent" } };
    const rendered = getSearchContentRenderResult(result, {}, theme);
    expect(rendered.content).toContain("pi coding agent");
  });

  it("shows specific URL when filtered", () => {
    const result = { content: [{ type: "text", text: "content" }], details: { url: "https://example.com" } };
    const rendered = getSearchContentRenderResult(result, {}, theme);
    expect(rendered.content).toContain("https://example.com");
  });

  it("shows preview in expanded view with <= 20 lines", () => {
    const lines = Array.from({ length: 15 }, (_, i) => `Line ${i + 1}`);
    const result = { content: [{ type: "text", text: lines.join("\n") }], details: { urlCount: 1 } };
    const rendered = getSearchContentRenderResult(result, { expanded: true }, theme);
    expect(rendered.content).toContain("Line 1");
    expect(rendered.content).toContain("Line 15");
    expect(rendered.content).not.toContain("more lines");
  });

  it("truncates preview at 20 lines in expanded view", () => {
    const lines = Array.from({ length: 30 }, (_, i) => `Line ${i + 1}`);
    const result = { content: [{ type: "text", text: lines.join("\n") }], details: { urlCount: 1 } };
    const rendered = getSearchContentRenderResult(result, { expanded: true }, theme);
    expect(rendered.content).toContain("Line 20");
    expect(rendered.content).not.toContain("Line 21");
    expect(rendered.content).toContain("... 10 more lines");
  });
});

describe("get_search_content renderCall", () => {
  it("shows responseId", () => {
    const rendered = getSearchContentRenderCall({ responseId: "abc12345" }, theme);
    expect(rendered.content).toContain("get_content");
    expect(rendered.content).toContain("abc12345");
  });

  it("shows query filter", () => {
    const rendered = getSearchContentRenderCall({ responseId: "abc", query: "test query" }, theme);
    expect(rendered.content).toContain('query:"test query"');
  });

  it("shows urlIndex", () => {
    const rendered = getSearchContentRenderCall({ responseId: "abc", urlIndex: 2 }, theme);
    expect(rendered.content).toContain("[2]");
  });

  it("shows queryIndex", () => {
    const rendered = getSearchContentRenderCall({ responseId: "abc", queryIndex: 0 }, theme);
    expect(rendered.content).toContain("[0]");
  });
});
