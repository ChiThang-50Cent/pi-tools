import { describe, it, expect, beforeEach } from "vitest";
import { contentStore, generateId, type StoredContent } from "../lib/store.js";

describe("store", () => {
  beforeEach(() => {
    contentStore.clear();
  });

  describe("generateId", () => {
    it("returns 8-character string", () => {
      const id = generateId();
      expect(id).toHaveLength(8);
    });

    it("returns hex characters only", () => {
      const id = generateId();
      expect(id).toMatch(/^[0-9a-f]{8}$/);
    });

    it("returns unique IDs", () => {
      const ids = new Set(Array.from({ length: 100 }, () => generateId()));
      expect(ids.size).toBe(100);
    });
  });

  describe("contentStore", () => {
    it("stores and retrieves fetch content", () => {
      const id = generateId();
      const entry: StoredContent = {
        responseId: id,
        type: "fetch",
        timestamp: Date.now(),
        urls: [
          { url: "https://example.com", title: "Example", content: "Hello world" },
        ],
      };

      contentStore.set(id, entry);
      const retrieved = contentStore.get(id);

      expect(retrieved).toBeDefined();
      expect(retrieved!.responseId).toBe(id);
      expect(retrieved!.type).toBe("fetch");
      expect(retrieved!.urls).toHaveLength(1);
      expect(retrieved!.urls![0].url).toBe("https://example.com");
      expect(retrieved!.urls![0].content).toBe("Hello world");
    });

    it("stores and retrieves search content", () => {
      const id = generateId();
      const entry: StoredContent = {
        responseId: id,
        type: "search",
        timestamp: Date.now(),
        queries: [
          {
            query: "test query",
            answer: "test answer",
            results: [{ title: "Result", url: "https://test.com" }],
          },
        ],
      };

      contentStore.set(id, entry);
      const retrieved = contentStore.get(id);

      expect(retrieved).toBeDefined();
      expect(retrieved!.type).toBe("search");
      expect(retrieved!.queries).toHaveLength(1);
      expect(retrieved!.queries![0].query).toBe("test query");
    });

    it("returns undefined for nonexistent ID", () => {
      expect(contentStore.get("nonexist")).toBeUndefined();
    });

    it("stores fetch content with error field", () => {
      const id = generateId();
      const entry: StoredContent = {
        responseId: id,
        type: "fetch",
        timestamp: Date.now(),
        urls: [
          { url: "https://fail.com", title: "Fail", content: "", error: "HTTP 500" },
          { url: "https://ok.com", title: "OK", content: "content" },
        ],
      };

      contentStore.set(id, entry);
      const urls = contentStore.get(id)!.urls!;

      expect(urls[0].error).toBe("HTTP 500");
      expect(urls[1].error).toBeUndefined();
    });

    it("overwrites existing entry with same ID", () => {
      const id = generateId();
      contentStore.set(id, { responseId: id, type: "fetch", timestamp: 1, urls: [] });
      contentStore.set(id, { responseId: id, type: "fetch", timestamp: 2, urls: [{ url: "x", title: "x", content: "x" }] });

      expect(contentStore.get(id)!.timestamp).toBe(2);
      expect(contentStore.get(id)!.urls).toHaveLength(1);
    });
  });
});
