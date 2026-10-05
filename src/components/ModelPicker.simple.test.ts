import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { Bot, InstanceInfo } from "@/state/store";

const fixture = vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  return { instances: [] as InstanceInfo[] };
});
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => false, setAdvancedMode: () => {} }));
vi.mock("./MenuMotion", () => ({ useMenuMotion: () => ({ shown: true, closing: false, className: "", exitProps: {} }) }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/state/store")>()),
  useStore: () => ({
    state: { instances: fixture.instances, modelVariantSessions: {}, bots: [] },
    dispatch: vi.fn(),
    refreshInstances: vi.fn(),
    refreshModels: vi.fn(),
  }),
}));

const { ModelPicker } = await import("./ModelPicker");
afterAll(() => vi.unstubAllGlobals());

const claude = (authenticated: boolean): InstanceInfo => ({
  instanceId: "claude",
  driverKind: "claudeAgent",
  displayName: "Claude",
  access: "subscription",
  snapshot: { state: "available", version: "2.1.300", authenticated },
  models: {
    default: "claude-opus",
    options: [
      { id: "claude-opus", label: "Opus" },
      { id: "claude-sonnet", label: "Sonnet" },
      { id: "claude-haiku", label: "Haiku" },
      { id: "claude-extra-1", label: "Extra one" },
      { id: "claude-extra-2", label: "Extra two" },
      { id: "claude-extra-3", label: "Extra three" },
      { id: "ollama::qwen", label: "qwen", custom: true },
    ],
  },
  install: {
    command: { darwin: "npm i", linux: "npm i", win32: "npm i" },
    signInCommand: "claude",
  },
  authentication: { method: "paste-code", signOut: true },
  capabilities: { effortLevels: ["low", "high"], withholdsHostTools: true },
});

function bot(): Bot {
  return {
    id: "atlas", threadId: "thread-atlas", name: "Atlas", title: "", description: "",
    notifications: true, color: "green", unread: false,
    modelSelection: { instanceId: "claude", model: "claude-opus", effort: "high" },
    messages: [],
  };
}

const html = () => renderToStaticMarkup(createElement(ModelPicker, { bot: bot() }));

describe("model picker in Simple mode", () => {
  it("keeps suggested models and hides effort, catalog chrome and settings links", () => {
    fixture.instances = [claude(true)];
    const markup = html();
    expect(markup).toContain("Suggested");
    expect(markup).toContain("Opus");
    expect(markup).not.toContain("data-model-effort");
    expect(markup).not.toContain("data-model-add-api-keys");
    expect(markup).not.toContain("data-model-engines-link");
    expect(markup).not.toContain("data-model-local-entry");
    expect(markup).not.toContain("Show all");
  });

  it("keeps engine sign-in", () => {
    fixture.instances = [claude(false)];
    const markup = html();
    expect(markup).toContain("Sign in to Claude");
    expect(markup).not.toContain("data-model-add-api-keys");
    expect(markup).not.toContain("data-model-engines-link");
  });
});
