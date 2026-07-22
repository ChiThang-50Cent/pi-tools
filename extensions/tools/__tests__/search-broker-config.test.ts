import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  engines?: { node?: string };
  scripts?: { [name: string]: string };
};
const searchDocs = readFileSync("docs/searxng.md", "utf8");
const unit = readFileSync("systemd/pi-tools-search-broker.service", "utf8");

describe("search broker deployment configuration", () => {
  it("declares a runtime with native TypeScript stripping and needs no loader flag", () => {
    expect(packageJson.engines?.node).toBe(">=22.18.0");
    expect(packageJson.scripts?.["search:broker"]).toBe("node extensions/tools/lib/search_broker.ts");
    expect(packageJson.scripts?.["search:broker"]).not.toContain("experimental-strip-types");
  });

  it("documents separate upstream and broker wait deadlines", () => {
    expect(searchDocs).toContain("brokerWaitTimeoutMs");
    expect(searchDocs).toContain("search.timeoutMs");
    expect(searchDocs).toContain("systemctl --user enable --now pi-tools-search-broker.service");
  });

  it("uses a direct Node systemd process with graceful restart behavior", () => {
    expect(unit).toContain("Type=exec");
    expect(unit).toContain("WorkingDirectory=%h/code/pi-tools");
    expect(unit).toContain("ExecStart=/usr/bin/node extensions/tools/lib/search_broker.ts");
    expect(unit).toContain("Restart=on-failure");
    expect(unit).toContain("KillSignal=SIGTERM");
    expect(unit).not.toMatch(/(?:sh|bash)\s+-c|[&;]/);
    expect(unit).not.toContain("sudo");
  });
});
