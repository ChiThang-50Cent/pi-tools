// ─── index.ts ────── pi-tools: unified search + vision + fetch + subagent ─
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isToolAllowed } from "./lib/config.js";
import { registerWebSearch } from "./tools/web_search.js";
import { registerCodeSearch } from "./tools/code_search.js";
import { registerAnalyzeImage } from "./tools/analyze_image.js";
import { registerFetchContent } from "./tools/fetch_content.js";
import { registerGetSearchContent } from "./tools/get_search_content.js";
import subagent from "./tools/subagent/index.js";
import { renderToolsSettings } from "./ui/tools_settings.js";

interface ToolsState {
  enabledTools: string[];
}

const ALL_TOOLS = [
  { name: "web_search", register: registerWebSearch, desc: "Search the web via SearXNG" },
  { name: "code_search", register: registerCodeSearch, desc: "Search code on GitHub, StackOverflow, PyPI, docs.rs" },
  { name: "analyze_image", register: registerAnalyzeImage, desc: "Vision analysis via Ollama (Vietnamese & English)" },
  { name: "fetch_content", register: registerFetchContent, desc: "Fetch URLs & extract readable markdown" },
  { name: "get_search_content", register: registerGetSearchContent, desc: "Retrieve cached search/fetch results" },
  { name: "subagent", register: subagent, desc: "Delegate tasks to isolated subagents (single/parallel/chain)" },
] as const;

const TOOL_NAMES = ALL_TOOLS.map((t) => t.name);

export default function (pi: ExtensionAPI) {
  const registeredTools: string[] = [];

  // Runtime toggle state (synced with pi.setActiveTools)
  let enabledTools: Set<string> = new Set();

  function persistState() {
    pi.appendEntry<ToolsState>("pi-tools-config", {
      enabledTools: Array.from(enabledTools),
    });
  }

  function applyTools() {
    const active = pi.getActiveTools();
    const nonPiTools = active.filter((t: string) => !TOOL_NAMES.includes(t));
    pi.setActiveTools([...nonPiTools, ...Array.from(enabledTools)]);
  }

  function restoreFromBranch(ctx: ExtensionContext) {
    const branchEntries = ctx.sessionManager.getBranch();
    let savedTools: string[] | undefined;

    for (const entry of branchEntries) {
      if (entry.type === "custom" && entry.customType === "pi-tools-config") {
        const data = entry.data as ToolsState | undefined;
        if (data?.enabledTools) savedTools = data.enabledTools;
      }
    }

    if (savedTools) {
      enabledTools = new Set(savedTools.filter((t) => TOOL_NAMES.includes(t)));
      applyTools();
    } else {
      enabledTools = new Set(pi.getActiveTools().filter((t: string) => TOOL_NAMES.includes(t)));
    }
  }

  // Register tools based on allow/deny config
  for (const tool of ALL_TOOLS) {
    if (isToolAllowed(tool.name)) {
      tool.register(pi);
      registeredTools.push(tool.name);
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    restoreFromBranch(ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    restoreFromBranch(ctx);
  });

  pi.registerCommand("tools", {
    description: "Enable/disable pi-tools",
    handler: async (_args, ctx) => {
      await renderToolsSettings(
        {
          tools: ALL_TOOLS,
          registered: registeredTools,
          enabled: enabledTools,
          onChange: (id, newValue) => {
            if (newValue === "enabled") enabledTools.add(id);
            else enabledTools.delete(id);
            applyTools();
            persistState();
          },
        },
        ctx,
      );
    },
  });
}
