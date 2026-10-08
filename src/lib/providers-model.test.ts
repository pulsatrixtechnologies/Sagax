import { describe, expect, it } from "vitest";

import { accountDetail, providerGroups } from "./providers-model";

const instance = (instanceId: string, driverKind: string, displayName: string, snapshot: Record<string, unknown> = {}, access?: "subscription" | "api") => ({
  instanceId, driverKind, displayName, ...(access ? { access } : {}),
  snapshot: { state: "available" as const, ...snapshot },
});

describe("providers on this installation", () => {
  it("groups every engine account by provider, Claude first, never Claude alone", () => {
    const groups = providerGroups([
      instance("hermes", "hermesAgent", "Hermes Agent"),
      instance("codex", "codex", "Codex"),
      instance("claude-work", "claudeAgent", "Claude (work)"),
      instance("claude", "claudeAgent", "Claude"),
      instance("gemini", "geminiAgent", "Gemini CLI"),
      instance("grok", "grokAgent", "Grok"),
      { ...instance("cerebras", "cerebras", "Cerebras (API)"), snapshot: { state: "unavailable" as const } },
    ]);
    expect(groups.map((group) => [group.id, group.name, group.accounts.length])).toEqual([
      ["claude", "Claude", 2], ["openai", "ChatGPT / Codex", 1], ["xai", "Grok", 1], ["google", "Gemini", 1], ["hermesAgent", "Hermes Agent", 1],
    ]);
    expect(groups.filter((group) => group.bringsConnectors).map((group) => group.id)).toEqual(["claude"]);
    expect(groups.find((group) => group.id === "openai")!.manageUrl).toBe("https://chatgpt.com/#settings/Connectors");
    expect(groups.find((group) => group.id === "xai")!.manageUrl).toBeUndefined();
  });

  it("says how each account is reached", () => {
    expect(accountDetail(instance("a", "claudeAgent", "Claude", { account: { email: "jc@example.com" } }))).toBe("email");
    expect(accountDetail(instance("b", "codex", "Codex", {}, "api"))).toBe("apiKey");
    expect(accountDetail(instance("c", "grokAgent", "Grok", { authenticated: false }))).toBe("notSignedIn");
    expect(accountDetail({ ...instance("d", "geminiAgent", "Gemini"), snapshot: { state: "unavailable" } })).toBe("unavailable");
  });
});
