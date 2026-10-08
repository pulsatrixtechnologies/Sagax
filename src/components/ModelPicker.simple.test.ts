import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { Bot, InstanceInfo } from "@/state/store";

const fixture = vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  return { instances: [] as InstanceInfo[], bots: [] as Bot[], dispatch: vi.fn() as (...args: unknown[]) => void };
});
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => false, setAdvancedMode: () => {} }));
vi.mock("./MenuMotion", () => ({ useMenuMotion: () => ({ shown: true, closing: false, className: "", exitProps: {} }) }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/state/store")>()),
  useStore: () => ({
    state: { instances: fixture.instances, modelVariantSessions: {}, bots: fixture.bots },
    dispatch: fixture.dispatch,
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

  it("labels the composer chip with the effort, as in Advanced", () => {
    fixture.instances = [claude(true)];
    const markup = renderToStaticMarkup(createElement(ModelPicker, { bot: bot(), inComposer: true }));
    expect(markup).toMatch(/<span class="truncate">Opus High<\/span>/);
  });

  it("keeps engine sign-in", () => {
    fixture.instances = [claude(false)];
    const markup = html();
    expect(markup).toContain("Sign in to Claude");
    expect(markup).not.toContain("data-model-add-api-keys");
    expect(markup).not.toContain("data-model-engines-link");
  });
});

describe("a thread's picker and its bot's model", () => {
  const opus = { instanceId: "claude", model: "claude-opus" };
  const haiku = { instanceId: "claude", model: "claude-haiku" };
  /** The bot as the store holds it (its model is Opus), and the thread's view of it. */
  function scout(threadModel: typeof opus | null): Bot {
    const profile: Bot = { ...bot(), modelSelection: opus, tasks: [
      { threadId: "thread-atlas", title: "This one", createdAt: 1, modelSelection: threadModel ?? opus, followsBotModel: threadModel === null },
    ] };
    fixture.bots = [profile];
    return { ...profile, modelSelection: threadModel ?? opus };
  }
  const threadPicker = (forBot: Bot) => renderToStaticMarkup(createElement(ModelPicker, { bot: forBot, threadId: "thread-atlas" }));

  it("offers the bot's model to a thread on its own", () => {
    fixture.instances = [claude(true)];
    const markup = threadPicker(scout(haiku));
    expect(markup).toContain("Use Atlas&#x27;s model");
    expect(markup).toContain("Claude · Opus");
    expect(markup).toContain('data-follow-bot-model="true" aria-pressed="false"');
  });

  it("shows a thread that follows its bot as following, and says so in the chip's tooltip", () => {
    fixture.instances = [claude(true)];
    const markup = threadPicker(scout(null));
    expect(markup).toContain('data-follow-bot-model="true" aria-pressed="true"');
    expect(markup).toContain("Uses Atlas&#x27;s model");
  });

  it("offers nothing a server too old to say whether a thread follows its bot could not do", () => {
    fixture.instances = [claude(true)];
    fixture.bots = [];
    expect(threadPicker(bot())).not.toContain("data-follow-bot-model");
  });
});
