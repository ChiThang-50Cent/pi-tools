// ─── handoff.ts ────── Deterministic parent→child handoff context ───────
/**
 * Handoff context helpers.
 *
 * These functions are deterministic — they never call an LLM or access
 * runtime state.  Their job is to normalize, compact, and inject a
 * structured handoff block into the child task text.
 */

// ─── Defaults ───

export const DEFAULT_CONTEXT_MAX_CHARS = 2000;

// ─── Normalisation & compaction ───

/**
 * Normalise a handoff context string for deterministic injection.
 *
 * - trims leading / trailing whitespace
 * - collapses runs of 3+ blank lines down to 2
 */
export function normalizeHandoffContext(text: string): string {
  return text.replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
}

/**
 * Deterministically compact handoff context to stay within a character budget.
 *
 * Returns the compacted text + a boolean indicating whether truncation occurred.
 */
export function compactHandoffContext(
  text: string,
  maxChars: number,
): { text: string; truncated: boolean } {
  const normalized = normalizeHandoffContext(text);
  if (normalized.length <= maxChars) return { text: normalized, truncated: false };

  const truncated = normalized.slice(0, maxChars);
  return {
    text: `${truncated}...[context truncated]`,
    truncated: true,
  };
}

// ─── Task builder ───

/**
 * Build the final delegated task string for a child subagent.
 *
 * When `context` is provided it is normalised, compacted to `maxChars`,
 * and prepended as a clearly-marked handoff block.  The original `task`
 * follows underneath.
 *
 * When `context` is falsy the original `task` is returned unchanged.
 *
 * Returns the built task string together with lightweight metadata used
 * for debugging / benchmarking.
 */
export function buildDelegatedTask(
  task: string,
  context: string | undefined,
  maxChars: number,
): { task: string; contextChars: number; truncated: boolean } {
  if (!context) {
    return { task, contextChars: 0, truncated: false };
  }

  const { text: compacted, truncated } = compactHandoffContext(context, maxChars);
  if (!compacted) {
    return { task, contextChars: 0, truncated: false };
  }

  const built = `Parent handoff context:\n${compacted}\n\nDelegated task:\n${task}`;

  return {
    task: built,
    contextChars: compacted.length,
    truncated,
  };
}
