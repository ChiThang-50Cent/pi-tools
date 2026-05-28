import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock AbortSignal.timeout (not available in all test environments)
vi.stubGlobal("AbortSignal", {
  ...AbortSignal,
  timeout: (_ms: number) => {
    const controller = new AbortController();
    // Don't actually timeout in tests
    return controller.signal;
  },
  any: (signals: AbortSignal[]) => {
    const controller = new AbortController();
    for (const signal of signals) {
      if (signal.aborted) controller.abort();
      signal.addEventListener("abort", () => controller.abort());
    }
    return controller.signal;
  },
});

// Mock pi-coding-agent and pi-tui
vi.mock("@earendil-works/pi-coding-agent", () => ({}));
vi.mock("@earendil-works/pi-tui", () => ({
  Text: class MockText {
    content: string;
    constructor(text = "", _px = 0, _py = 0) { this.content = text; }
    setText(t: string) { this.content = t; }
  },
}));

import { contentStore } from "../lib/store.js";
import { searchSearXNG, type SearXNGResult, _resetSearchState } from "../lib/search.js";
import { fetchPageContent, fetchGitHub, stripHtml, MAX_INLINE_CONTENT } from "../lib/fetch.js";

// ─── Helper: mock SearXNG response ───

function mockSearXNGResponse(results: SearXNGResult[]) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      query: "test",
      number_of_results: results.length,
      results,
    }),
  });
}

function mockFetchPageResponse(html: string, contentType = "text/html") {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    headers: { get: (key: string) => key === "content-type" ? contentType : null },
    text: async () => html,
  });
}

function mockGitHubApiResponse(data: any) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => data,
  });
}

// ─── search.ts tests ───

describe("searchSearXNG", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    _resetSearchState();
  });

  it("returns results from SearXNG", async () => {
    mockSearXNGResponse([
      { title: "Result 1", url: "https://a.com", content: "Snippet 1", engine: "google" },
      { title: "Result 2", url: "https://b.com", content: "Snippet 2" },
    ]);

    const result = await searchSearXNG("http://localhost:8080", "test query");

    expect(result.results).toHaveLength(2);
    expect(result.results[0].title).toBe("Result 1");
    expect(result.results[0].url).toBe("https://a.com");
    expect(result.results[0].content).toBe("Snippet 1");
    expect(result.results[0].engine).toBe("google");
    expect(result.results[1].engine).toBeUndefined();
  });

  it("respects limit parameter", async () => {
    const manyResults = Array.from({ length: 50 }, (_, i) => ({
      title: `Result ${i}`,
      url: `https://${i}.com`,
    }));
    mockSearXNGResponse(manyResults);

    const result = await searchSearXNG("http://localhost:8080", "test", { limit: 5 });

    expect(result.results).toHaveLength(5);
  });

  it("caps limit at 50", async () => {
    const manyResults = Array.from({ length: 100 }, (_, i) => ({
      title: `Result ${i}`,
      url: `https://${i}.com`,
    }));
    mockSearXNGResponse(manyResults);

    const result = await searchSearXNG("http://localhost:8080", "test", { limit: 999 });

    expect(result.results.length).toBeLessThanOrEqual(50);
  });

  it("throws on non-OK response", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });

    await expect(searchSearXNG("http://localhost:8080", "test")).rejects.toThrow("SearXNG returned 503");
  });

  it("constructs correct URL with query params", async () => {
    mockSearXNGResponse([]);

    await searchSearXNG("http://localhost:8080/", "hello world", { categories: "news", limit: 3 });

    const calledUrl = new URL(mockFetch.mock.calls[0][0]);
    expect(calledUrl.origin).toBe("http://localhost:8080");
    expect(calledUrl.pathname).toBe("/search");
    expect(calledUrl.searchParams.get("q")).toBe("hello world");
    expect(calledUrl.searchParams.get("format")).toBe("json");
    expect(calledUrl.searchParams.get("categories")).toBe("news");
  });

  it("handles empty results", async () => {
    mockSearXNGResponse([]);

    const result = await searchSearXNG("http://localhost:8080", "nonexistent");

    expect(result.results).toHaveLength(0);
  });
});

// ─── fetch.ts tests ───

describe("stripHtml", () => {
  it("removes HTML tags", () => {
    expect(stripHtml("<p>Hello <b>world</b></p>")).toBe("Hello world");
  });

  it("removes script and style tags", () => {
    const html = '<html><head><style>.x{color:red}</style></head><body><script>alert("x")</script>Content</body></html>';
    expect(stripHtml(html)).toBe("Content");
  });

  it("decodes HTML entities", () => {
    // .trim() removes trailing space from &nbsp;
    expect(stripHtml("&amp;&lt;&gt;&quot;&#39;&nbsp;")).toBe("&<>\"'");
  });

  it("collapses whitespace", () => {
    expect(stripHtml("<p>  Hello   world  </p>")).toBe("Hello world");
  });
});

describe("fetchPageContent", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("fetches and strips HTML", async () => {
    mockFetchPageResponse("<html><head><title>My Page</title></head><body><p>Hello world</p></body></html>");

    const result = await fetchPageContent("https://example.com");

    expect(result.url).toBe("https://example.com");
    expect(result.title).toBe("My Page");
    expect(result.content).toContain("Hello world");
    expect(result.content).not.toContain("<p>");
  });

  it("handles JSON response", async () => {
    const jsonData = { key: "value", nested: { a: 1 } };
    mockFetchPageResponse(JSON.stringify(jsonData), "application/json");

    const result = await fetchPageContent("https://api.example.com/data");

    expect(result.title).toBe("https://api.example.com/data");
    expect(result.content).toContain("```json");
    expect(result.content).toContain('"key": "value"');
  });

  it("uses URL as title when no <title> tag", async () => {
    mockFetchPageResponse("<html><body>No title here</body></html>");

    const result = await fetchPageContent("https://notitle.com");

    expect(result.title).toBe("https://notitle.com");
  });

  it("throws on non-OK response", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404, statusText: "Not Found" });

    await expect(fetchPageContent("https://missing.com")).rejects.toThrow("HTTP 404");
  });

  it("truncates very long content", async () => {
    const longContent = "x".repeat(MAX_INLINE_CONTENT * 3);
    mockFetchPageResponse(`<html><body>${longContent}</body></html>`);

    const result = await fetchPageContent("https://long.com");

    // Content should be capped at MAX_INLINE_CONTENT * 2
    expect(result.content.length).toBeLessThanOrEqual(MAX_INLINE_CONTENT * 2 + 100);
  });
});

describe("fetchGitHub", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("fetches repo info from GitHub API", async () => {
    mockGitHubApiResponse({
      full_name: "badlogic/pi-mono",
      description: "Pi coding agent",
      stargazers_count: 1234,
      language: "TypeScript",
      html_url: "https://github.com/badlogic/pi-mono",
      clone_url: "https://github.com/badlogic/pi-mono.git",
      default_branch: "main",
      topics: ["coding", "agent"],
      license: { spdx_id: "MIT" },
    });

    const result = await fetchGitHub("https://github.com/badlogic/pi-mono");

    expect(result.title).toBe("badlogic/pi-mono");
    expect(result.url).toBe("https://github.com/badlogic/pi-mono");
    expect(result.content).toContain("# badlogic/pi-mono");
    expect(result.content).toContain("Pi coding agent");
    expect(result.content).toContain("1,234");
    expect(result.content).toContain("TypeScript");
    expect(result.content).toContain("MIT");
    expect(result.content).toContain("coding, agent");
    expect(result.content).toContain("git clone");
  });

  it("handles repo without license", async () => {
    mockGitHubApiResponse({
      full_name: "test/repo",
      description: null,
      stargazers_count: 0,
      language: null,
      html_url: "https://github.com/test/repo",
      clone_url: "https://github.com/test/repo.git",
      default_branch: "main",
      topics: [],
      license: undefined,
    });

    const result = await fetchGitHub("https://github.com/test/repo");

    expect(result.content).toContain("N/A");
  });

  it("throws on 404", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    await expect(fetchGitHub("https://github.com/no/such/repo")).rejects.toThrow("not found");
  });

  it("throws on invalid URL format", async () => {
    await expect(fetchGitHub("https://github.com/only-owner")).rejects.toThrow("Could not parse");
  });
});

// ─── Integration: store + get_search_content flow ───

describe("contentStore integration", () => {
  beforeEach(() => {
    contentStore.clear();
    mockFetch.mockReset();
  });

  it("fetch_content stores data retrievable by get_search_content", async () => {
    // Simulate what fetch_content does: store results
    const mockResults = [
      { url: "https://a.com", title: "Page A", content: "Content A" },
      { url: "https://b.com", title: "Page B", content: "Content B" },
    ];

    const { generateId } = await import("../lib/store.js");
    const responseId = generateId();

    contentStore.set(responseId, {
      responseId,
      type: "fetch",
      timestamp: Date.now(),
      urls: mockResults,
    });

    // Simulate what get_search_content execute does
    const stored = contentStore.get(responseId);
    expect(stored).toBeDefined();
    expect(stored!.type).toBe("fetch");
    expect(stored!.urls).toHaveLength(2);
    expect(stored!.urls![0].title).toBe("Page A");
    expect(stored!.urls![1].content).toBe("Content B");
  });

  it("get_search_content returns undefined for expired/missing ID", () => {
    expect(contentStore.get("nonexistent")).toBeUndefined();
  });
});
