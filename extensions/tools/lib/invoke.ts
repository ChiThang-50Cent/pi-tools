// ─── invoke.ts ────── Pi binary invocation detection ─────────────────────
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Determine the correct command + args to invoke a pi process.
 * Handles direct script paths, bun virtual scripts, and generic runtimes (node/bun).
 */
export function getPiInvocation(args: string[]): { command: string; args: string[] } {
  const currentScript = process.argv[1];
  const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
  if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }

  const execName = path.basename(process.execPath).toLowerCase();
  const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
  if (!isGenericRuntime) {
    return { command: process.execPath, args };
  }

  return { command: "pi", args };
}
