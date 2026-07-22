import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock fs before importing config
vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  statSync: vi.fn(),
}));

import { existsSync, readFileSync, statSync } from "node:fs";
import * as configModule from "../lib/config.js";
import {
  loadConfig,
  getSearXNGUrl,
  isToolAllowed,
  type ToolsConfig,
} from "../lib/config.js";

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockStatSync = vi.mocked(statSync);

let mtimeCounter = 1000;
function setupConfig(config: ToolsConfig | null) {
  mtimeCounter++;
  if (config === null) {
    mockExistsSync.mockReturnValue(false);
    mockStatSync.mockImplementation(() => { throw new Error("ENOENT"); });
  } else {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(config));
    mockStatSync.mockReturnValue({ mtimeMs: mtimeCounter } as any);
  }
  // Force cache refresh by calling loadConfig which reads fs directly
  loadConfig();
}

describe("config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no config file
    setupConfig(null);
  });

  describe("loadConfig", () => {
    it("returns empty object when config file missing", () => {
      setupConfig(null);
      expect(loadConfig()).toEqual({});
    });

    it("parses valid JSON config", () => {
      const config: ToolsConfig = { searxng: "http://custom:9090" };
      setupConfig(config);
      expect(loadConfig()).toEqual(config);
    });

    it("returns empty object on invalid JSON", () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue("not json{{{");
      expect(loadConfig()).toEqual({});
    });

    it("reads all config fields", () => {
      const config: ToolsConfig = {
        searxng: "http://search:8080",
        search: { brokerUrl: "http://127.0.0.1:8787", minIntervalMs: 25, queueSize: 3, timeoutMs: 15000, brokerWaitTimeoutMs: 120000 },
        allow: ["web_search", "fetch_content"],
        deny: [],
        maxSubagentDepth: 3,
      };
      setupConfig(config);
      const result = loadConfig();
      expect(result.searxng).toBe("http://search:8080");
      expect(result.search?.brokerUrl).toBe("http://127.0.0.1:8787");
      expect(result.search?.queueSize).toBe(3);
      expect(result.search?.timeoutMs).toBe(15000);
      expect(result.search?.brokerWaitTimeoutMs).toBe(120000);
      expect(result.allow).toEqual(["web_search", "fetch_content"]);
      expect(result.maxSubagentDepth).toBe(3);
    });
  });

  describe("getSearXNGUrl", () => {
    it("returns default URL when not configured", () => {
      setupConfig({});
      expect(getSearXNGUrl()).toBe("http://127.0.0.1:8080");
    });

    it("returns configured URL", () => {
      setupConfig({ searxng: "http://custom:9090" });
      expect(getSearXNGUrl()).toBe("http://custom:9090");
    });

    it("strips trailing slashes", () => {
      setupConfig({ searxng: "http://custom:9090///" });
      expect(getSearXNGUrl()).toBe("http://custom:9090");
    });
  });

  it("does not expose the removed per-agent model configuration API", () => {
    expect("getAgentModelConfig" in configModule).toBe(false);
  });

  describe("isToolAllowed", () => {
    it("allows all tools when neither allow nor deny set", () => {
      setupConfig({});
      expect(isToolAllowed("web_search")).toBe(true);
      expect(isToolAllowed("any_tool")).toBe(true);
    });

    it("only allows tools in allow list", () => {
      setupConfig({ allow: ["web_search", "fetch_content"] });
      expect(isToolAllowed("web_search")).toBe(true);
      expect(isToolAllowed("fetch_content")).toBe(true);
      expect(isToolAllowed("code_search")).toBe(false);
    });

    it("deny is ignored when allow is set", () => {
      setupConfig({ allow: ["web_search"], deny: ["web_search"] });
      expect(isToolAllowed("web_search")).toBe(true);
    });

    it("denies tools in deny list when allow is empty", () => {
      setupConfig({ deny: ["subagent"] });
      expect(isToolAllowed("web_search")).toBe(true);
      expect(isToolAllowed("subagent")).toBe(false);
    });

    it("empty allow and deny lists allows all", () => {
      setupConfig({ allow: [], deny: [] });
      expect(isToolAllowed("any_tool")).toBe(true);
    });
  });
});
