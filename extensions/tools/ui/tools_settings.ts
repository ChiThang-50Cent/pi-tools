// ─── tools_settings.ts ────── TUI component for the /tools command ───────
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DynamicBorder, getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { Container, type SettingItem, SettingsList, Spacer, TruncatedText } from "@earendil-works/pi-tui";

export interface ToolDef {
  name: string;
  desc: string;
}

/**
 * Render the pi-tools settings TUI.
 *
 * @param tools       All tool definitions (name + description)
 * @param registered  Which tools passed allow/deny registration
 * @param enabled     Current enabled set (runtime toggle)
 * @param onChange    Called when a tool is toggled
 * @param done        Called when user exits (Esc)
 */
export function renderToolsSettings(
  { tools, registered, enabled }: {
    tools: readonly ToolDef[];
    registered: string[];
    enabled: Set<string>;
    onChange: (id: string, value: string) => void;
  },
  ctx: ExtensionContext,
): Promise<void> {
  return ctx.ui.custom<void>((_tui, theme, _kb, done) => {
    const items: SettingItem[] = tools.map((tool) => {
      const isRegistered = registered.includes(tool.name);
      const isEnabled = isRegistered && enabled.has(tool.name);
      return {
        id: tool.name,
        label: tool.name,
        description: isRegistered ? tool.desc : `${tool.desc} (blocked by allow/deny config)`,
        currentValue: !isRegistered ? "blocked" : isEnabled ? "enabled" : "disabled",
        values: isRegistered ? ["enabled", "disabled"] : ["blocked"],
      };
    });

    const settingsList = new SettingsList(
      items,
      Math.min(items.length + 2, 10),
      getSettingsListTheme(),
      (id, newValue) => onChange(id, newValue),
      () => done(undefined),
    );

    const container = new Container();
    container.addChild(new Spacer(1));
    container.addChild(new DynamicBorder());
    container.addChild(new TruncatedText(
      theme.fg("accent", theme.bold("  pi-tools")) +
        theme.fg("dim", "    ↑↓ navigate  Enter toggle  Esc back"),
    ));
    container.addChild(new DynamicBorder());
    container.addChild(settingsList);
    container.addChild(new DynamicBorder());

    return {
      render: (w: number) => container.render(w),
      invalidate: () => container.invalidate(),
      handleInput: (data: string) => settingsList.handleInput?.(data),
    };
  });
}
