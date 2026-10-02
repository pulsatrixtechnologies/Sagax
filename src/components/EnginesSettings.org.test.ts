// Settings > Model providers on an organization server: the person's own
// access on each engine card (who pays for their turns, their own
// subscription sign-in, one link to their keys; the separate "My
// subscriptions and keys" card is gone since 2026-10-02), and,
// while Connected apps is switched off, the read-only status of their Claude
// account's connectors.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import type { MyEngine } from "@/lib/perspicax-org";

const fixture = vi.hoisted(() => ({
  org: null as null | { org: { name: string; identity: { kind: "perspicax"; issuer: string } } },
  features: {} as Record<string, boolean>,
  instances: [] as unknown[],
  mine: null as null | MyEngine[],
}));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: vi.fn(() => new Promise(() => {})),
  useStore: () => ({ state: { instances: fixture.instances, bots: [], config: { features: fixture.features } }, refreshInstances: async () => {}, refreshModels: async () => {} }),
}));
vi.mock("@/lib/perspicax-org", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/perspicax-org")>(),
  usePerspicaxOrg: () => fixture.org,
  useMyEngines: () => fixture.mine,
}));

beforeEach(() => {
  fixture.org = null;
  fixture.features = {};
  fixture.instances = [];
  fixture.mine = null;
  setLocale("en");
  vi.stubGlobal("window", {});
  vi.stubGlobal("navigator", { userAgent: "Linux" });
});
afterEach(() => vi.unstubAllGlobals());

const render = async () => {
  const { EnginesSettings } = await import("./EnginesSettings");
  return renderToStaticMarkup(createElement(EnginesSettings));
};

describe("Model providers on an organization server", () => {
  const instance = (instanceId: string, driverKind: string, displayName: string, snapshot: Record<string, unknown> = {}) => ({
    instanceId, driverKind, displayName, access: "cloud", cliDefault: instanceId,
    snapshot: { state: "available", authenticated: true, account: { email: "server-login@example.test" }, ...snapshot },
  });
  const ORG = { org: { name: "GOX", identity: { kind: "perspicax" as const, issuer: "https://px.example.test" } } };
  const mine = (instanceId: string, driver: string, displayName: string, over: Partial<MyEngine> = {}): MyEngine => ({
    instanceId, driver, displayName, installed: true, subscription: { supported: true, signedIn: false }, myKey: false, orgKey: false, myTurns: "none", ...over,
  });
  const orgFixture = () => {
    fixture.org = ORG;
    fixture.instances = [
      instance("claude", "claudeAgent", "Claude"),
      instance("codex", "codex", "Codex"),
      instance("grok", "grokAgent", "Grok", { state: "unavailable", authenticated: false }),
    ];
    fixture.mine = [
      mine("claude", "claudeAgent", "Claude", { subscription: { supported: true, signedIn: true }, myTurns: "subscription" }),
      mine("codex", "codex", "Codex"),
      mine("grok", "grokAgent", "Grok", { installed: false, subscription: { supported: false, signedIn: false } }),
    ];
  };

  it("drops the separate My subscriptions and keys card and keeps one link to my keys", async () => {
    expect(await render()).not.toContain("data-my-keys-link");
    orgFixture();
    const html = await render();
    expect(html).not.toContain("My subscriptions and keys");
    expect(html).not.toContain("data-my-engines");
    expect(html.match(/data-my-keys-link/g)).toHaveLength(1);
    expect(html).toContain('href="https://px.example.test/console/pulsabot/keys"');
    expect(html).toContain("Manage my keys in Perspicax");
    setLocale("fr");
    expect(await render()).toContain("Gérer mes clés dans Perspicax");
  });

  it("puts who pays and my own sign-in on each engine card, lists no engine missing from the server", async () => {
    orgFixture();
    const html = await render();
    expect(html).toContain('data-engine-card="claude"');
    expect(html).toContain('data-engine-card="codex"');
    expect(html).not.toContain('data-engine-card="grok"');
    expect(html).not.toContain("Not installed on this server");
    expect(html).toContain('data-my-turns="subscription"');
    expect(html).toContain("Your turns use your subscription");
    expect(html).toContain('data-my-turns="none"');
    expect(html).toContain("Signed in with your own subscription.");
    expect(html).toContain("Sign out");
    expect(html).toContain("Sign in with my subscription");
    // the server's own account serves no one's turns here and is not shown
    expect(html).not.toContain("server-login@example.test");
  });

  it("keeps the server's own account and every engine on a solo server", async () => {
    fixture.instances = [instance("claude", "claudeAgent", "Claude"), instance("grok", "grokAgent", "Grok", { state: "unavailable", authenticated: false })];
    const html = await render();
    expect(html).toContain("server-login@example.test");
    expect(html).toContain('data-engine-card="grok"');
    expect(html).not.toContain("data-my-turns");
    expect(html).not.toContain("Sign in with my subscription");
  });

  it("offers no sign-in for an engine without a personal subscription", async () => {
    const { MyEngineAccess } = await import("./settings/MyEngines");
    expect(renderToStaticMarkup(createElement(MyEngineAccess, { engine: mine("claude", "claudeAgent", "Claude") }))).toContain("Sign in with my subscription");
    expect(renderToStaticMarkup(createElement(MyEngineAccess, { engine: mine("kimi", "kimiAgent", "Kimi", { subscription: { supported: false, signedIn: false } }) }))).toBe("");
    expect(renderToStaticMarkup(createElement(MyEngineAccess, { engine: mine("codex", "codex", "Codex", { installed: false }) }))).toBe("");
  });

  it("shows the Claude connectors status here while Connected apps is off, and not once it is on", async () => {
    expect(await render()).toContain('data-harness-connectors="settings"');
    fixture.features = { connectedApps: true };
    expect(await render()).not.toContain("data-harness-connectors");
  });
});
