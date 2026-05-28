// ─── get_search_content ───── Retrieve stored content by responseId ─────
import { Type } from "typebox";
import { Text } from "@earendil-works/pi-tui";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { contentStore } from "../lib/store.js";

export function registerGetSearchContent(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "get_search_content",
    label: "Get Search Content",
    description: "Retrieve full content from a previous web_search or fetch_content call by responseId.",
    parameters: Type.Object({
      responseId: Type.String({ description: "The responseId from web_search or fetch_content" }),
      query: Type.Optional(Type.String({ description: "Get content for this query (web_search)" })),
      queryIndex: Type.Optional(Type.Number({ description: "Get content for query at index" })),
      url: Type.Optional(Type.String({ description: "Get content for this URL" })),
      urlIndex: Type.Optional(Type.Number({ description: "Get content for URL at index" })),
    }),

    async execute(_id, params) {
      const stored = contentStore.get(params.responseId);
      if (!stored) {
        return { content: [{ type: "text", text: `No stored content for responseId "${params.responseId}".` }], details: { error: "not_found" } };
      }

      if (stored.type === "search") {
        const queries = stored.queries || [];

        if (params.query) {
          const m = queries.find((q) => q.query === params.query);
          if (!m) return { content: [{ type: "text", text: `Query "${params.query}" not found.` }], details: { error: "query_not_found" } };
          return { content: [{ type: "text", text: `**${m.query}**\n\n${m.answer}\n\n${m.results.map((r) => `- [${r.title}](${r.url})`).join("\n")}` }], details: { query: m.query } };
        }
        if (typeof params.queryIndex === "number") {
          const q = queries[params.queryIndex];
          if (!q) return { content: [{ type: "text", text: `Index ${params.queryIndex} out of range (${queries.length} queries).` }], details: { error: "index_out_of_range" } };
          return { content: [{ type: "text", text: `**${q.query}**\n\n${q.answer}\n\n${q.results.map((r) => `- [${r.title}](${r.url})`).join("\n")}` }], details: { query: q.query } };
        }
        return { content: [{ type: "text", text: queries.map((q) => `## ${q.query}\n${q.answer}\n\n${q.results.map((r) => `- [${r.title}](${r.url})`).join("\n")}`).join("\n\n") }], details: { queryCount: queries.length } };
      }

      const urls = stored.urls || [];
      if (params.url) {
        const m = urls.find((u) => u.url === params.url);
        if (!m) return { content: [{ type: "text", text: `URL "${params.url}" not found.` }], details: { error: "url_not_found" } };
        return { content: [{ type: "text", text: `### ${m.title}\n${m.url}\n\n${m.content}` }], details: { url: m.url } };
      }
      if (typeof params.urlIndex === "number") {
        const u = urls[params.urlIndex];
        if (!u) return { content: [{ type: "text", text: `Index ${params.urlIndex} out of range (${urls.length} URLs).` }], details: { error: "index_out_of_range" } };
        return { content: [{ type: "text", text: `### ${u.title}\n${u.url}\n\n${u.content}` }], details: { url: u.url } };
      }
      return { content: [{ type: "text", text: urls.map((u) => `### ${u.title}\n${u.url}\n\n${u.content}`).join("\n\n---\n\n") }], details: { urlCount: urls.length } };
    },

    renderCall(args, theme) {
      const id = typeof args.responseId === "string" ? args.responseId.slice(0, 16) : "?";
      let text = theme.fg("toolTitle", theme.bold("get_content ")) + theme.fg("accent", id);
      if (args.query) text += theme.fg("dim", ` query:"${String(args.query).slice(0, 30)}"`);
      if (typeof args.urlIndex === "number") text += theme.fg("dim", ` [${args.urlIndex}]`);
      if (typeof args.queryIndex === "number") text += theme.fg("dim", ` [${args.queryIndex}]`);
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded, isPartial }, theme) {
      if (isPartial) return new Text(theme.fg("warning", "Loading..."), 0, 0);

      const details = result.details as { error?: string; queryCount?: number; urlCount?: number; query?: string; url?: string } | undefined;
      if (details?.error) return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);

      const content = result.content[0];
      const text = content?.type === "text" ? content.text : "";
      const lineCount = text.split("\n").length;
      const sizeKB = (Buffer.byteLength(text, "utf8") / 1024).toFixed(1);

      let summary = "";
      if (details?.query) summary = theme.fg("accent", details.query);
      else if (details?.url) summary = theme.fg("accent", details.url);
      else if (details?.queryCount) summary = theme.fg("success", `${details.queryCount} queries`);
      else if (details?.urlCount) summary = theme.fg("success", `${details.urlCount} URLs`);
      else summary = theme.fg("success", `${lineCount} lines`);

      let display = summary + theme.fg("dim", ` (${sizeKB}KB)`);

      if (expanded) {
        const preview = text.split("\n").slice(0, 20).join("\n");
        display += `\n${theme.fg("toolOutput", preview)}`;
        if (lineCount > 20) display += `\n${theme.fg("muted", `... ${lineCount - 20} more lines`)}`;
      }

      return new Text(display, 0, 0);
    },
  });
}
