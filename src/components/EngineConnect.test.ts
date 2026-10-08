// The minimal engine card of a person on an organization server (Settings >
// Model providers and the model picker): one "Pays with" line, one Connect
// button or Connected with Disconnect, a small link to their keys while no
// subscription is signed in; never the payer chain.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import type { MyEngine } from "@/lib/perspicax-org";

const fixture = vi.hoisted(() => ({ api: null as null | ((...args: unknown[]) => Promise<unknown>) }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: (...args: unknown[]) => fixture.api!(...args),
  useStore: () => ({ state: { instances: [], bots: [], config: {} }, refreshInstances: async () => {}, refreshModels: async () => {} }),
}));

import { EngineConnect, connectName, paysWithText } from "./EngineConnect";
import { deviceCodeHintShown } from "./CodexDeviceSignIn";

const issuer = "https://px.example.test";
const engine = (patch: Partial<MyEngine> = {}): MyEngine => ({
  instanceId: "codex", driver: "codex", displayName: "Codex", installed: true,
  subscription: { supported: true, signedIn: false }, myKey: false, orgKey: false, myTurns: "none", ...patch,
});
const render = (value: MyEngine) => renderToStaticMarkup(createElement(EngineConnect, { engine: value, issuer, onChanged: () => {} }));

beforeEach(() => {
  setLocale("en");
  fixture.api = vi.fn(() => new Promise(() => {}));
  vi.stubGlobal("window", {});
});

describe("EngineConnect", () => {
  it("an engine the server image does not carry reads Not available on this server, with the reason as a tooltip", () => {
    const html = render(engine({ installed: false, notAvailable: "Google's runtime is about 2 GB" }));
    expect(html).toContain('data-pays-with="not-available"');
    expect(html).toContain("Not available on this server");
    expect(html).toContain("Google&#x27;s runtime is about 2 GB");
    expect(html).not.toContain("<button");
    expect(render(engine({ installed: false }))).toContain("Not installed on this server");
    expect(paysWithText({ installed: false, myTurns: "none", notAvailable: "x" })).toBe("Not available on this server");
    setLocale("fr");
    expect(paysWithText({ installed: false, myTurns: "none", notAvailable: "x" })).toBe("Non disponible sur ce serveur");
  });

  it("not connected: Not connected and one Connect button, no payer chain or device-code hint", () => {
    const html = render(engine());
    expect(html).toContain('data-pays-with="none"');
    expect(html).toContain("Not connected");
    expect(html).toContain("Connect ChatGPT");
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).not.toContain("Disconnect");
    for (const gone of ["Who pays for your turns", "Checked in this order", "data-payer=", "Nothing pays for this provider yet", "Can&#x27;t answer you yet", "Sign in with your OpenAI account", "kept on the organization server for you only", "Device-code login"]) {
      expect(html).not.toContain(gone);
    }
    expect(render(engine({ instanceId: "claude", driver: "claudeAgent", displayName: "Claude" }))).toContain("Connect Claude");
    expect(render(engine({ instanceId: "grok", driver: "grokAgent", displayName: "Grok" }))).toContain("Connect Grok");
    expect(render(engine({ instanceId: "kimi", driver: "kimiAgent", displayName: "Kimi" }))).toContain("Connect Kimi");
  });

  it("connected: Pays with your subscription, Connected and Disconnect, no Connect button or keys link", () => {
    const signedIn = engine({ subscription: { supported: true, signedIn: true }, myKey: true, orgKey: true, myTurns: "subscription" });
    const html = render(signedIn);
    expect(html).toContain("Pays with: your subscription");
    expect(html).toContain("data-engine-connected");
    expect(html).toContain(">Connected<");
    expect(html).toContain("Disconnect");
    expect(html).not.toContain("Connect ChatGPT");
    expect(html).not.toContain("data-engine-keys-link");
  });

  it("key only: the status line names the key and the Manage link shows, with no button when no subscription exists", () => {
    const keyOnly = engine({ instanceId: "pi", driver: "piAgent", displayName: "pi", subscription: { supported: false, signedIn: false }, myKey: true, myTurns: "key" });
    const html = render(keyOnly);
    expect(html).toContain('data-pays-with="key"');
    expect(html).toContain("Pays with: your key in Perspicax");
    expect(html).toContain("data-engine-keys-link");
    expect(html).toContain(`${issuer}/console/pulsabot/keys`);
    expect(html).toContain("Manage my keys in Perspicax");
    expect(html).not.toContain("<button");
    // A provider with a subscription still offers Connect beside the key.
    const both = render(engine({ myKey: true, myTurns: "key" }));
    expect(both).toContain("Pays with: your key in Perspicax");
    expect(both).toContain("Connect ChatGPT");
    expect(both).toContain("data-engine-keys-link");
  });

  it("organization key and engines a key cannot serve", () => {
    expect(render(engine({ orgKey: true, myTurns: "org-key" }))).toContain("Pays with: the organization key");
    const custom = render(engine({ instanceId: "ollama", driver: "openaiCompatible", displayName: "Ollama", subscription: { supported: false, signedIn: false } }));
    expect(custom).toContain("Not connected");
    expect(custom).not.toContain("data-engine-keys-link");
    expect(custom).not.toContain("<button");
    expect(render(engine({ installed: false }))).toContain("Not installed on this server");
  });

  it("names the account people sign in with and speaks French", () => {
    expect(connectName({ driver: "codex", displayName: "Codex" })).toBe("ChatGPT");
    expect(connectName({ driver: "geminiAgent", displayName: "Gemini CLI" })).toBe("Gemini");
    expect(connectName({ driver: "piAgent", displayName: "pi" })).toBe("pi");
    setLocale("fr");
    expect(paysWithText({ installed: true, myTurns: "subscription" })).toBe("Payé par : votre abonnement");
    expect(render(engine())).toContain("Non connecté");
  });
});

describe("the device-code hint", () => {
  it("shows only once a sign-in failed, and not when the failure already says it", () => {
    expect(deviceCodeHintShown(null, null)).toBe(false);
    expect(deviceCodeHintShown({ phase: "waiting" }, null)).toBe(false);
    expect(deviceCodeHintShown({ phase: "succeeded" }, null)).toBe(false);
    expect(deviceCodeHintShown({ phase: "failed", message: "The server stopped." }, null)).toBe(true);
    expect(deviceCodeHintShown(null, "Network down")).toBe(true);
    expect(deviceCodeHintShown({ phase: "failed", message: "Enable device-code login in your ChatGPT security settings" }, null)).toBe(false);
  });
});
