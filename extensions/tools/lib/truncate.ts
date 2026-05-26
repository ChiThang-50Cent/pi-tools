// ─── truncate.ts ────── Output truncation utility ────────────────────────

/**
 * Truncate text to fit within maxBytes while preserving valid UTF-8.
 * When truncated, appends a note about omitted bytes.
 */
export function truncateOutput(output: string, maxBytes: number): { text: string; truncated: boolean } {
  const byteLength = Buffer.byteLength(output, "utf8");
  if (byteLength <= maxBytes) return { text: output, truncated: false };

  let truncated = output.slice(0, maxBytes);
  while (Buffer.byteLength(truncated, "utf8") > maxBytes) {
    truncated = truncated.slice(0, -1);
  }
  const omitted = byteLength - Buffer.byteLength(truncated, "utf8");
  return {
    text: `${truncated}\n\n[Output truncated: ${omitted} bytes omitted. Full output preserved in tool details.]`,
    truncated: true,
  };
}
