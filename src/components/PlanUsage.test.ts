// Settings > Usage > Plan usage: every row state, the row de-duplication,
// and the refresh spinner (src/lib/plan-usage.ts, PlanUsageView).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { planRows, type PlanProvider, type PlanUsageReport } from "@/lib/plan-usage";
import type { MyEngine } from "@/lib/perspicax-org";

vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: vi.fn(() => new Promise(() => {})),
  useStore: () => ({ state: { instances: [], bots: [], config: {} }, dispatch: () => {}, refreshInstances: async () => {}, refreshModels: async () => {} }),
}));

import { PlanUsageView, type PlanUsageViewProps } from "./PlanUsage";

const CLOSED = { available: false, remainingPercent: null, usedPercent: null, resetsAt: null };

function row(patch: Partial<PlanProvider>): PlanProvider {
  return {
    id: "claude", name: "Claude", driver: "claude", plan: null, ok: false, error: null,
    access: "subscription", instanceId: "claude", failure: null,
    fiveHour: CLOSED, weekly: CLOSED, extra: [], models: [], ...patch,
  };
}

function render(report: PlanUsageReport | null, patch: Partial<PlanUsageViewProps> = {}): string {
  return renderToStaticMarkup(createElement(PlanUsageView, {
    report, loading: false, error: "", now: Date.parse("2026-10-02T09:00:00Z"),
    onRefresh: () => {}, myEngines: null, issuer: "", onOpenEngines: () => {}, ...patch,
  }));
}

const engine = (patch: Partial<MyEngine> = {}): MyEngine => ({
  instanceId: "claude", driver: "claudeAgent", displayName: "Claude", installed: true,
  subscription: { supported: true, signedIn: false }, myKey: false, orgKey: false, myTurns: "none", ...patch,
});

beforeEach(() => {
  setLocale("en");
  vi.stubGlobal("window", {});
});

describe("Plan usage rows", () => {
  it("windows: remaining allowance, per-model usage and unavailable windows, plan name as subtitle", () => {
    const html = render({
      providers: [row({
        state: "windows", ok: true, plan: "Pro",
        fiveHour: { available: true, remainingPercent: 68, usedPercent: 32, resetsAt: null },
        models: [{ name: "Sonnet", windows: [{ label: "Weekly", remainingPercent: 30, usedPercent: 70, resetsAt: null }] }],
      })],
    });
    expect(html).toContain("68% left");
    expect(html).toContain("70% used");
    expect(html).toContain("Not reported by this plan");
    expect(html).toContain(">Pro<");
    expect(html).toContain('aria-valuenow="32"');
    expect(html).not.toContain("Sign in again");
  });

  it("no windows: the plan reports none, and an API key has none", () => {
    const html = render({
      providers: [
        row({ id: "grok", name: "Grok", driver: "grok", instanceId: "grok", state: "no-windows", ok: true }),
        row({ id: "claudeApi", name: "Claude (API key)", access: "api-key", instanceId: "claudeApi", state: "no-windows", error: "API key: no plan windows" }),
      ],
    });
    expect(html).toContain("No plan windows for this provider");
    expect(html).toContain("Claude (API key)");
    expect(html).toContain("API key: no plan windows");
    expect(html).not.toContain('role="meter"');
    expect(html).not.toContain("Connect");
  });

  it("not signed in, solo: Not signed in and a Connect button to Model providers", () => {
    const html = render({ providers: [row({ state: "signed-out", error: "Not signed in" })] });
    expect(html).toContain("Not signed in");
    expect(html).toContain('data-plan-connect="claude"');
    expect(html).toContain("Connect Claude");
    expect(html).not.toContain("Sign in again");
  });

  it("not signed in, organization: the person's own engine card with its Connect button", () => {
    const html = render(
      { providers: [row({ state: "signed-out", error: "Not signed in" })] },
      { myEngines: [engine()], issuer: "https://px.example.test" },
    );
    expect(html).toContain("Not signed in");
    expect(html).toContain('data-engine-connect="claude"');
    expect(html).toContain("Connect Claude");
    expect(html).not.toContain("data-plan-connect");
  });

  it("error: the real reason in the person's language, with Try again", () => {
    const html = render({
      providers: [
        row({ state: "error", error: "Could not reach Claude: rate limited (429), try again in a minute", failure: { kind: "http", status: 429 } }),
        row({ id: "codex", name: "Codex", driver: "codex", instanceId: "codex", state: "error", failure: { kind: "network", code: "ENOTFOUND" } }),
      ],
    });
    expect(html).toContain("Could not reach Claude: rate limited (429), try again in a minute");
    expect(html).toContain("Could not reach Codex: network error (ENOTFOUND)");
    expect(html.match(/Try again/g)).toHaveLength(2);
    setLocale("fr");
    const fr = render({ providers: [row({ state: "error", failure: { kind: "timeout", seconds: 8 } })] });
    expect(fr).toContain("Impossible de joindre Claude : aucune réponse en 8 s");
    expect(fr).toContain("Réessayer");
  });

  it("refresh: a spinner while it fetches, the rows stay", () => {
    const report = { providers: [row({ state: "windows", ok: true, fiveHour: { available: true, remainingPercent: 50, usedPercent: 50, resetsAt: null } })] };
    const busy = render(report, { loading: true });
    expect(busy).toContain("data-plan-spinner");
    expect(busy).toContain('aria-busy="true"');
    expect(busy).toContain("50% left");
    expect(render(report)).not.toContain("data-plan-spinner");
  });
});

describe("planRows", () => {
  it("one row per provider: an older server's duplicates with the same outcome fold", () => {
    const legacy = (id: string, name: string, driver: string, error: string) => ({ id, name, driver, plan: null, ok: false, error, fiveHour: CLOSED, weekly: CLOSED, extra: [] });
    const rows = planRows({
      providers: [
        legacy("grok", "Grok", "grok", "Sign in again in Grok"),
        legacy("claude", "Claude", "claude", "Sign in again in Claude"),
        legacy("codex", "Codex", "codex", "Sign in again in Codex"),
        legacy("chatgpt", "ChatGPT plan", "codex", "Sign in again in Codex"),
        legacy("claudeApi", "Claude (API key)", "claude", "Sign in again in Claude"),
      ],
    });
    expect(rows.map((entry) => [entry.id, entry.name, entry.state])).toEqual([
      ["grok", "Grok", "signed-out"],
      ["claude", "Claude", "signed-out"],
      ["codex", "Codex", "signed-out"],
    ]);
  });

  it("keeps rows that differ, and lists API-key rows after the subscriptions", () => {
    const rows = planRows({
      providers: [
        row({ id: "claudeApi", name: "Claude (API key)", access: "api-key", state: "no-windows" }),
        row({ id: "claude", state: "windows", ok: true, plan: "Max" }),
        row({ id: "work", name: "Work Claude", state: "signed-out" }),
      ],
    });
    expect(rows.map((entry) => [entry.id, entry.name, entry.state])).toEqual([
      ["claude", "Claude", "windows"],
      ["work", "Work Claude", "signed-out"],
      ["claudeApi", "Claude (API key)", "no-windows"],
    ]);
  });

  it("an older server's real error stays an error, not a sign-in", () => {
    const [entry] = planRows({ providers: [{ id: "claude", name: "Claude", driver: "claude", ok: false, error: "Could not reach Claude" }] });
    expect(entry).toMatchObject({ state: "error", message: "Could not reach Claude" });
  });
});
