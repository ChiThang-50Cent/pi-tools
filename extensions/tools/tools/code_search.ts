// ─── code_search ───── Search code examples via SearXNG ──────────────────
import { Type } from "typebox";
import { Text } from "@earendil-works/pi-tui";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { searchSearXNG } from "../lib/search.js";
import { getSearXNGUrl } from "../lib/config.js";

export function registerCodeSearch(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "code_search",
    label: "Code Search",
    description:
      "Search for code examples, API usage, and programming solutions.\n\n" +
      "Use this when you need real code examples, library documentation, " +
      "error message explanations, or implementation references. " +
      "Focused on GitHub, StackOverflow, PyPI, and docs.rs.",
    promptSnippet: "Search for code examples (GitHub, StackOverflow, etc.)",
    promptGuidelines: [
      "Use code_search for programming questions, API references, and error lookups.",
      "Use web_search for general/non-code topics.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Programming question, error message, or API to search for" }),
    }),

    renderCall(args, theme) {
      const input = args as { query?: unknown };
      const query = typeof input.query === "string" ? input.query.trim() : "";
      if (!query) return new Text(theme.fg("toolTitle", theme.bold("code ")) + theme.fg("error", "(no query)"), 0, 0);
      return new Text(theme.fg("toolTitle", theme.bold("code ")) + theme.fg("accent", query.slice(0, 60)), 0, 0);
    },

    renderResult(result, _opts, theme) {
      const d = result.details as { count?: number; error?: string };
      if (d?.error) return new Text(theme.fg("error", `Error: ${d.error}`), 0, 0);
      return new Text(theme.fg("success", `${d?.count ?? 0} results`), 0, 0);
    },

    async execute(_id, params, signal) {
      const baseUrl = getSearXNGUrl();
      const codeQuery = `(${params.query}) (site:github.com OR site:stackoverflow.com OR site:docs.rs OR site:pypi.org)`;

      try {
        const data = await searchSearXNG(baseUrl, codeQuery, { limit: 10, signal });
        const results = data.results;

        if (!results.length) return { content: [{ type: "text", text: `No code results for: ${params.query}` }], details: { count: 0 } };

        const lines = [`Code search results for: ${params.query}\n`];
        results.forEach((r) => {
          lines.push(`### [${r.title || "Untitled"}](${r.url})`);
          lines.push("```");
          lines.push((r.content || "").slice(0, 400));
          lines.push("```\n");
        });

        return {
          content: [{ type: "text", text: lines.join("\n").trim() }],
          details: { count: results.length, query: params.query },
        };
      } catch (e) {
        return { content: [{ type: "text", text: `Code search failed: ${e}` }], details: { error: String(e) } };
      }
    },
  });
}
