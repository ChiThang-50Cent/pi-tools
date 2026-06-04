// ─── render.ts ────── TUI rendering for subagent tool calls & results ───
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { formatToolCall, formatUsageStats } from "../../lib/format.js";
import { getDisplayItems, getFinalOutput, isFailedResult } from "./types.js";
import type { DisplayItem, SubagentDetails, SingleResult } from "./types.js";

const COLLAPSED_ITEM_COUNT = 10;

function renderDisplayItems(
  items: DisplayItem[],
  theme: { fg: (c: string, t: string) => string },
  limit?: number,
): string {
  const toShow = limit ? items.slice(-limit) : items;
  const skipped = limit && items.length > limit ? items.length - limit : 0;
  let text = "";
  if (skipped > 0) text += theme.fg("muted", `... ${skipped} earlier items\n`);
  for (const item of toShow) {
    if (item.type === "text") {
      const preview = limit ? item.text.split("\n").slice(0, 3).join("\n") : item.text;
      text += `${theme.fg("toolOutput", preview)}\n`;
    } else {
      text += `${theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme))}\n`;
    }
  }
  return text.trimEnd();
}

function aggregateUsage(results: SingleResult[]) {
  const total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 };
  for (const r of results) {
    total.input += r.usage.input;
    total.output += r.usage.output;
    total.cacheRead += r.usage.cacheRead;
    total.cacheWrite += r.usage.cacheWrite;
    total.cost += r.usage.cost;
    total.turns += r.usage.turns;
  }
  return total;
}

export function renderCall(
  args: Record<string, unknown>,
  theme: { fg: (c: string, t: string) => string; bold: (t: string) => string },
  _context: unknown,
): Text {
  const scope = (args.agentScope as string) ?? "user";
  if (args.chain && Array.isArray(args.chain) && args.chain.length > 0) {
    let text =
      theme.fg("toolTitle", theme.bold("subagent ")) +
      theme.fg("accent", `chain (${args.chain.length} steps)`) +
      theme.fg("muted", ` [${scope}]`);
    for (let i = 0; i < Math.min(args.chain.length, 3); i++) {
      const step = args.chain[i] as { agent: string; task: string };
      const cleanTask = step.task.replace(/\{previous\}/g, "").trim();
      const preview = cleanTask.length > 40 ? `${cleanTask.slice(0, 40)}...` : cleanTask;
      text +=
        "\n  " +
        theme.fg("muted", `${i + 1}.`) +
        " " +
        theme.fg("accent", step.agent) +
        theme.fg("dim", ` ${preview}`);
    }
    if (args.chain.length > 3) text += `\n  ${theme.fg("muted", `... +${args.chain.length - 3} more`)}`;
    return new Text(text, 0, 0);
  }
  if (args.tasks && Array.isArray(args.tasks) && args.tasks.length > 0) {
    let text =
      theme.fg("toolTitle", theme.bold("subagent ")) +
      theme.fg("accent", `parallel (${args.tasks.length} tasks)`) +
      theme.fg("muted", ` [${scope}]`);
    for (const t of args.tasks.slice(0, 3) as { agent: string; task: string }[]) {
      const preview = t.task.length > 40 ? `${t.task.slice(0, 40)}...` : t.task;
      text += `\n  ${theme.fg("accent", t.agent)}${theme.fg("dim", ` ${preview}`)}`;
    }
    if (args.tasks.length > 3) text += `\n  ${theme.fg("muted", `... +${args.tasks.length - 3} more`)}`;
    return new Text(text, 0, 0);
  }
  const agentName = (args.agent as string) || "...";
  const preview = typeof args.task === "string" ? (args.task.length > 60 ? `${args.task.slice(0, 60)}...` : args.task) : "...";
  let text =
    theme.fg("toolTitle", theme.bold("subagent ")) +
    theme.fg("accent", agentName) +
    theme.fg("muted", ` [${scope}]`);
  text += `\n  ${theme.fg("dim", preview)}`;
  return new Text(text, 0, 0);
}

export function renderResult(
  result: { content: { type: string; text: string }[]; details?: unknown },
  { expanded }: { expanded?: boolean },
  theme: { fg: (c: string, t: string) => string; bold: (t: string) => string },
  _context: unknown,
): Text | Container {
  const details = result.details as SubagentDetails | undefined;
  if (!details || details.results.length === 0) {
    const text = result.content[0];
    return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
  }

  const mdTheme = getMarkdownTheme();

  // ── SINGLE ──
  if (details.mode === "single" && details.results.length === 1) {
    const r = details.results[0];
    const isRunning = r.exitCode === -1;
    const isError = isFailedResult(r);
    const icon = isRunning ? theme.fg("warning", "⏳") : isError ? theme.fg("error", "✗") : theme.fg("success", "✓");
    const displayItems = getDisplayItems(r.messages);
    const finalOutput = getFinalOutput(r.messages);

    if (expanded) {
      const container = new Container();
      let header = `${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}${theme.fg("muted", ` (${r.agentSource})`)}`;
      if (!isRunning && isError && r.stopReason) header += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
      container.addChild(new Text(header, 0, 0));
      if (!isRunning && isError && r.errorMessage)
        container.addChild(new Text(theme.fg("error", `Error: ${r.errorMessage}`), 0, 0));
      container.addChild(new Spacer(1));
      container.addChild(new Text(theme.fg("muted", "─── Task ───"), 0, 0));
      container.addChild(new Text(theme.fg("dim", r.task), 0, 0));
      container.addChild(new Spacer(1));
      container.addChild(new Text(theme.fg("muted", "─── Output ───"), 0, 0));
      if (displayItems.length === 0 && !finalOutput) {
        container.addChild(new Text(theme.fg("muted", "(no output)"), 0, 0));
      } else {
        for (const item of displayItems) {
          if (item.type === "toolCall")
            container.addChild(
              new Text(
                theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)),
                0,
                0,
              ),
            );
        }
        if (finalOutput) {
          container.addChild(new Spacer(1));
          container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
        }
      }
      const usageStr = formatUsageStats(r.usage, r.model);
      if (usageStr) {
        container.addChild(new Spacer(1));
        container.addChild(new Text(theme.fg("dim", usageStr), 0, 0));
      }
      return container;
    }

    // Collapsed
    let text = `${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}${theme.fg("muted", ` (${r.agentSource})`)}`;
    if (!isRunning && isError && r.stopReason) text += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
    if (!isRunning && isError && r.errorMessage) text += `\n${theme.fg("error", `Error: ${r.errorMessage}`)}`;
    else if (displayItems.length === 0) text += `\n${theme.fg("muted", isRunning ? "(running...)" : "(no output)")}`;
    else {
      text += `\n${renderDisplayItems(displayItems, theme, COLLAPSED_ITEM_COUNT)}`;
      if (displayItems.length > COLLAPSED_ITEM_COUNT) text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
    }
    const usageStr = formatUsageStats(r.usage, r.model);
    if (usageStr) text += `\n${theme.fg("dim", usageStr)}`;
    return new Text(text, 0, 0);
  }

  // ── CHAIN ──
  if (details.mode === "chain") {
    const successCount = details.results.filter((r) => r.exitCode === 0).length;
    const running = details.results.filter((r) => r.exitCode === -1).length;
    const isRunning = running > 0;
    const icon = isRunning
      ? theme.fg("warning", "⏳")
      : successCount === details.results.length
        ? theme.fg("success", "✓")
        : theme.fg("error", "✗");

    if (expanded) {
      const container = new Container();
      container.addChild(
        new Text(
          icon +
            " " +
            theme.fg("toolTitle", theme.bold("chain ")) +
            theme.fg("accent", `${successCount}/${details.results.length} steps`),
          0,
          0,
        ),
      );

      for (const r of details.results) {
        const isStepRunning = r.exitCode === -1;
        const rIcon = isStepRunning ? theme.fg("warning", "⏳") : r.exitCode === 0 ? theme.fg("success", "✓") : theme.fg("error", "✗");
        const displayItems = getDisplayItems(r.messages);
        const finalOutput = getFinalOutput(r.messages);
        const modelShort = r.model?.includes("/") ? r.model.split("/")[1] : r.model;
        const modelStr = modelShort ? theme.fg("muted", ` [${modelShort}]`) : "";

        container.addChild(new Spacer(1));
        container.addChild(
          new Text(
            `${theme.fg("muted", `─── Step ${r.step}: `) + theme.fg("accent", r.agent)}${modelStr} ${rIcon}`,
            0,
            0,
          ),
        );
        container.addChild(new Text(theme.fg("muted", "Task: ") + theme.fg("dim", r.task), 0, 0));

        for (const item of displayItems) {
          if (item.type === "toolCall") {
            container.addChild(
              new Text(
                theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)),
                0,
                0,
              ),
            );
          }
        }

        if (finalOutput) {
          container.addChild(new Spacer(1));
          container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
        }

        const stepUsage = formatUsageStats(r.usage, r.model);
        if (stepUsage) container.addChild(new Text(theme.fg("dim", stepUsage), 0, 0));
      }

      const usageStr = formatUsageStats(aggregateUsage(details.results));
      if (usageStr) {
        container.addChild(new Spacer(1));
        container.addChild(new Text(theme.fg("dim", `Total: ${usageStr}`), 0, 0));
      }
      return container;
    }

    // Collapsed
    let text =
      icon +
      " " +
      theme.fg("toolTitle", theme.bold("chain ")) +
      theme.fg("accent", `${successCount}/${details.results.length} steps`);
    for (const r of details.results) {
      const isStepRunning = r.exitCode === -1;
      const rIcon = isStepRunning ? theme.fg("warning", "⏳") : r.exitCode === 0 ? theme.fg("success", "✓") : theme.fg("error", "✗");
      const displayItems = getDisplayItems(r.messages);
      const modelShort = r.model?.includes("/") ? r.model.split("/")[1] : r.model;
      const modelStr = modelShort ? theme.fg("muted", ` [${modelShort}]`) : "";
      text += `\n\n${theme.fg("muted", `─── Step ${r.step}: `)}${theme.fg("accent", r.agent)}${modelStr} ${rIcon}`;
      if (displayItems.length === 0) text += `\n${theme.fg("muted", "(no output)")}`;
      else text += `\n${renderDisplayItems(displayItems, theme, 5)}`;
    }
    const usageStr = formatUsageStats(aggregateUsage(details.results));
    if (usageStr) text += `\n\n${theme.fg("dim", `Total: ${usageStr}`)}`;
    text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
    return new Text(text, 0, 0);
  }

  // ── PARALLEL ──
  if (details.mode === "parallel") {
    const running = details.results.filter((r) => r.exitCode === -1).length;
    const successCount = details.results.filter((r) => r.exitCode !== -1 && !isFailedResult(r)).length;
    const failCount = details.results.filter((r) => r.exitCode !== -1 && isFailedResult(r)).length;
    const isRunning = running > 0;
    const icon = isRunning
      ? theme.fg("warning", "⏳")
      : failCount > 0
        ? theme.fg("warning", "◐")
        : theme.fg("success", "✓");
    const status = isRunning
      ? `${successCount + failCount}/${details.results.length} done, ${running} running`
      : `${successCount}/${details.results.length} tasks`;

    if (expanded && !isRunning) {
      const container = new Container();
      container.addChild(
        new Text(
          `${icon} ${theme.fg("toolTitle", theme.bold("parallel "))}${theme.fg("accent", status)}`,
          0,
          0,
        ),
      );

      for (const r of details.results) {
        const rIcon = isFailedResult(r) ? theme.fg("error", "✗") : theme.fg("success", "✓");
        const displayItems = getDisplayItems(r.messages);
        const finalOutput = getFinalOutput(r.messages);
        const modelShort = r.model?.includes("/") ? r.model.split("/")[1] : r.model;
        const modelStr = modelShort ? theme.fg("muted", ` [${modelShort}]`) : "";

        container.addChild(new Spacer(1));
        container.addChild(
          new Text(`${theme.fg("muted", "─── ") + theme.fg("accent", r.agent)}${modelStr} ${rIcon}`, 0, 0),
        );
        container.addChild(new Text(theme.fg("muted", "Task: ") + theme.fg("dim", r.task), 0, 0));

        for (const item of displayItems) {
          if (item.type === "toolCall") {
            container.addChild(
              new Text(
                theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)),
                0,
                0,
              ),
            );
          }
        }

        if (finalOutput) {
          container.addChild(new Spacer(1));
          container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
        }

        const taskUsage = formatUsageStats(r.usage, r.model);
        if (taskUsage) container.addChild(new Text(theme.fg("dim", taskUsage), 0, 0));
      }

      const usageStr = formatUsageStats(aggregateUsage(details.results));
      if (usageStr) {
        container.addChild(new Spacer(1));
        container.addChild(new Text(theme.fg("dim", `Total: ${usageStr}`), 0, 0));
      }
      return container;
    }

    // Collapsed (or still running)
    let text = `${icon} ${theme.fg("toolTitle", theme.bold("parallel "))}${theme.fg("accent", status)}`;
    for (const r of details.results) {
      const isRunning = r.exitCode === -1;
      const rIcon =
        isRunning
          ? theme.fg("warning", "⏳")
          : isFailedResult(r)
            ? theme.fg("error", "✗")
            : theme.fg("success", "✓");
      const displayItems = getDisplayItems(r.messages);
      const modelShort = r.model?.includes("/") ? r.model.split("/")[1] : r.model;
      const modelStr = modelShort ? theme.fg("muted", ` [${modelShort}]`) : "";
      text += `\n\n${theme.fg("muted", "─── ")}${theme.fg("accent", r.agent)}${modelStr} ${rIcon}`;
      if (displayItems.length === 0)
        text += `\n${theme.fg("muted", isRunning ? "(running...)" : "(no output)")}`;
      else text += `\n${renderDisplayItems(displayItems, theme, 5)}`;
    }
    if (!isRunning) {
      const usageStr = formatUsageStats(aggregateUsage(details.results));
      if (usageStr) text += `\n\n${theme.fg("dim", `Total: ${usageStr}`)}`;
    }
    if (!expanded) text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
    return new Text(text, 0, 0);
  }

  // Fallback
  const text = result.content[0];
  return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
}
