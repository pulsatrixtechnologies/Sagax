// Settings > Model providers on an organization server: the person's own
// subscription sign-in (it was Settings > Organization > My engines), and,
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
}));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: vi.fn(() => new Promise(() => {})),
  useStore: () => ({ state: { instances: [], bots: [], config: { features: fixture.features } }, refreshInstances: async () => {}, refreshModels: async () => {} }),
}));
vi.mock("@/lib/perspicax-org", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/perspicax-org")>(),
  usePerspicaxOrg: () => fixture.org,
}));

const engines: MyEngine[] = [{
  instanceId: "claude", driver: "claudeAgent", displayName: "Claude", installed: true,
  subscription: { supported: true, signedIn: false }, myKey: false, orgKey: false, myTurns: "none",
}];

beforeEach(() => {
  fixture.org = null;
  fixture.features = {};
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
  it("holds the person's own subscription sign-in on an organization server only", async () => {
    expect(await render()).not.toContain("data-my-engines");
    fixture.org = { org: { name: "GOX", identity: { kind: "perspicax", issuer: "https://px.example.test" } } };
    const html = await render();
    expect(html).toContain("data-my-engines");
    expect(html).toContain("My subscriptions and keys");
    expect(html).toContain('href="https://px.example.test/console/pulsabot/keys"');
  });

  it("offers the sign-in button for each engine that supports a subscription", async () => {
    const { MyEngines } = await import("./settings/MyEngines");
    const html = renderToStaticMarkup(createElement(MyEngines, { issuer: "https://px.example.test", initial: engines }));
    expect(html).toContain("Sign in with my subscription");
  });

  it("shows the Claude connectors status here while Connected apps is off, and not once it is on", async () => {
    expect(await render()).toContain('data-harness-connectors="settings"');
    fixture.features = { connectedApps: true };
    expect(await render()).not.toContain("data-harness-connectors");
  });
});
