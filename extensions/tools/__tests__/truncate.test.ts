import { describe, it, expect } from "vitest";
import { truncateOutput } from "../lib/truncate.js";

describe("truncateOutput", () => {
  it("returns unchanged text when within limit", () => {
    const result = truncateOutput("hello", 100);
    expect(result.text).toBe("hello");
    expect(result.truncated).toBe(false);
  });

  it("returns unchanged text when exactly at limit", () => {
    const text = "a".repeat(50);
    const result = truncateOutput(text, 50);
    expect(result.text).toBe(text);
    expect(result.truncated).toBe(false);
  });

  it("truncates text exceeding byte limit", () => {
    const text = "a".repeat(100);
    const result = truncateOutput(text, 50);
    expect(result.truncated).toBe(true);
    expect(result.text).toContain("[Output truncated:");
    expect(result.text).toContain("bytes omitted");
  });

  it("truncated text is shorter than original", () => {
    const text = "a".repeat(100);
    const result = truncateOutput(text, 50);
    const truncatedPart = result.text.split("\n\n[Output truncated")[0];
    expect(Buffer.byteLength(truncatedPart, "utf8")).toBeLessThanOrEqual(50);
  });

  it("handles empty string", () => {
    const result = truncateOutput("", 100);
    expect(result.text).toBe("");
    expect(result.truncated).toBe(false);
  });

  it("preserves valid UTF-8 when truncating multi-byte characters", () => {
    // Vietnamese characters are 2-3 bytes each
    const text = "Xin chào thế giới! ".repeat(20);
    const result = truncateOutput(text, 50);
    expect(result.truncated).toBe(true);
    // Should not throw when re-measuring byte length
    expect(Buffer.byteLength(result.text.split("\n\n[Output")[0], "utf8")).toBeLessThanOrEqual(50);
  });

  it("handles emoji (4-byte UTF-8)", () => {
    const text = "🎉🎊🎈".repeat(50);
    const result = truncateOutput(text, 30);
    expect(result.truncated).toBe(true);
    // Truncated part should be valid UTF-8
    const truncatedPart = result.text.split("\n\n[Output")[0];
    expect(() => Buffer.from(truncatedPart, "utf8").toString("utf8")).not.toThrow();
  });

  it("includes omitted byte count in suffix", () => {
    const text = "x".repeat(200);
    const result = truncateOutput(text, 50);
    const match = result.text.match(/\[Output truncated: (\d+) bytes omitted/);
    expect(match).not.toBeNull();
    const omitted = parseInt(match![1], 10);
    expect(omitted).toBeGreaterThan(0);
  });
});
