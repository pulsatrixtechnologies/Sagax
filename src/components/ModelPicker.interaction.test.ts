import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Bot, InstanceInfo } from "@/state/store";

// Opens the real picker and clicks through it without a DOM: useState is
// held here by call order (the picker's own hooks run first, children after),
// effects never run, and handlers are read off the returned element tree.
// The headless renderer check in docs/verification/bot-continuity.md covers
// the same flows in a browser.
const fixture = vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  return {
    values: [] as unknown[],
    index: 0,
    own: 0,
    instances: [] as InstanceInfo[],
    dispatch: (() => {}) as (...args: unknown[]) => void,
    refreshInstances: (() => Promise.resolve()) as () => Promise<void>,
    refreshModels: ((_id: string) => Promise.resolve()) as (instanceId: string) => Promise<void>,
    // An organization server (Perspicax): null on a solo server.
    org: null as unknown,
    myEngines: null as unknown,
    bots: [] as unknown[],
    // state.config: an organization server's allowed model providers ride on it
    config: null as unknown,
  };
});
vi.mock("@/lib/perspicax-org", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/perspicax-org")>()),
  usePerspicaxOrg: () => fixture.org,
  useMyEngines: () => fixture.myEngines,
  reloadMyEngines: () => Promise.resolve(fixture.myEngines),
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = fixture.index++;
    if (!(index in fixture.values)) fixture.values[index] = typeof initial === "function" ? initial() : initial;
    return [fixture.values[index], (next: unknown) => {
      fixture.values[index] = typeof next === "function" ? next(fixture.values[index]) : next;
    }];
  },
  useEffect: () => {},
}));
// Menu animation has its own lifecycle checks; this hook fixture does not
// emulate React's render-time state retries.
vi.mock("./MenuMotion", () => ({ useMenuMotion: (open: boolean) => ({ shown: open, closing: false, className: "" }) }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/state/store")>()),
  useStore: () => ({
    state: { instances: fixture.instances, bots: fixture.bots, modelVariantSessions: {}, config: fixture.config },
    dispatch: fixture.dispatch,
    refreshInstances: fixture.refreshInstances,
    refreshModels: fixture.refreshModels,
  }),
}));

// These cases cover the full picker; Simple mode has its own file.
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: () => {} }));

const { FollowBotModelRow, ModelEngineRail, ModelPicker } = await import("./ModelPicker");
const { ModelDropdown } = await import("./ModelDropdown");

afterAll(() => vi.unstubAllGlobals());

type Node = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
function nodes(value: ReactNode): Node[] {
  return Children.toArray(value).flatMap((child) => {
    if (!isValidElement(child)) return [];
    const node = child as Node;
    return [node, ...nodes(node.props.children)];
  });
}

const official = [{ id: "claude-opus-5-5", label: "Opus 5.5" }, { id: "claude-sonnet-5", label: "Sonnet 5" }];
const qwen = { id: "ollama::qwen3", label: "qwen3 (Ollama)", custom: true };
const claudeInstall = {
  command: { darwin: "npm install -g @anthropic-ai/claude-code", linux: "npm install -g @anthropic-ai/claude-code", win32: "npm install -g @anthropic-ai/claude-code" },
  signInCommand: "claude",
};
const claude = (snapshot: InstanceInfo["snapshot"], options: InstanceInfo["models"]["options"] = official): InstanceInfo => ({
  instanceId: "claude", driverKind: "claudeAgent", displayName: "Claude", access: "subscription", snapshot,
  models: { default: "claude-opus-5-5", options }, install: claudeInstall,
  authentication: { method: "paste-code", signOut: true },
  capabilities: { withholdsHostTools: true },
});
const signedOut = () => claude({ state: "available", version: "2.1.300", authenticated: false });
const signedIn = () => claude({ state: "available", version: "2.1.300", authenticated: true });
const notFound = () => claude({ state: "unavailable", reason: "`claude` CLI not found" });
const codex: InstanceInfo = {
  instanceId: "codex", driverKind: "codex", displayName: "Codex", access: "subscription",
  snapshot: { state: "available", version: "1.0.0", authenticated: true },
  models: { default: "gpt-5.6", options: [{ id: "gpt-5.6", label: "GPT-5.6" }] },
  capabilities: { withholdsHostTools: true },
};

function bot(instanceId: string, model: string): Bot {
  return {
    id: "atlas", threadId: "thread-atlas", name: "Atlas", title: "", description: "", notifications: true,
    color: "green", unread: false, modelSelection: { instanceId, model }, messages: [],
  };
}

/** Render the picker once; the picker's own state survives, children start fresh. */
function render(forBot: Bot, options?: { contained?: boolean; threadId?: string; label?: string }) {
  fixture.values.length = Math.min(fixture.values.length, fixture.own);
  let tree: ReactNode = null;
  function Capture() {
    fixture.index = 0;
    tree = ModelPicker({
      bot: forBot,
      threadId: options && "threadId" in options ? options.threadId : forBot.threadId,
      contained: options?.contained,
      label: options?.label,
    });
    fixture.own = fixture.index;
    return tree;
  }
  const html = renderToStaticMarkup(createElement(Capture));
  return { html, nodes: nodes(tree) };
}

function open(forBot: Bot, options?: { contained?: boolean; threadId?: string; label?: string }) {
  const trigger = render(forBot, options).nodes.find((node) => node.props["data-tour"] === "model")!;
  (trigger.props.onClick as () => void)();
  return render(forBot, options);
}

/** Open the picker, then its model dropdown. */
function openMenu(forBot: Bot, options?: { contained?: boolean; threadId?: string; label?: string }) {
  const dropdown = open(forBot, options).nodes.find((node) => node.type === ModelDropdown);
  expect(dropdown, "the model dropdown").toBeTruthy();
  (dropdown!.props.onOpenChange as (open: boolean) => void)(true);
  return render(forBot, options);
}

/** A model row of the dropdown, by model id. */
const row = (rendered: ReturnType<typeof render>, id: string) => rendered.nodes.find((node) => node.props["id"] === id && typeof node.props.onPick === "function")!;

function rail(rendered: ReturnType<typeof render>) {
  return rendered.nodes.find((node) => node.type === ModelEngineRail) as ReactElement<{ instances: InstanceInfo[]; onSelect: (instance: InstanceInfo) => void }> | undefined;
}

/** The open menu only; the trigger always names the saved model. */
const menu = (html: string) => html.slice(html.indexOf("data-model-picker-content"));

beforeEach(() => {
  fixture.values = [];
  fixture.index = 0;
  fixture.own = 0;
  fixture.dispatch = vi.fn();
  fixture.refreshInstances = vi.fn(() => Promise.resolve());
  fixture.refreshModels = vi.fn(() => Promise.resolve());
  fixture.org = null;
  fixture.myEngines = null;
  fixture.bots = [];
  fixture.config = null;
});
afterEach(() => vi.useRealTimers());

describe("ModelPicker with a signed-out or missing Claude", () => {
  it("keeps an empty ChatGPT plan catalog on the cloud rail so sign-in is reachable", () => {
    const plan: InstanceInfo = { ...codex, instanceId: "chatgpt", displayName: "ChatGPT plan", snapshot: { state: "available", authenticated: false, chatgptPlan: true }, models: { default: "", options: [] }, authentication: { method: "browser-pkce" }, install: { signInCommand: "codex login" } };
    fixture.instances = [codex, plan];
    const forBot = bot("codex", "gpt-5.6");
    const opened = open(forBot);
    expect(rail(opened)!.props.instances.map((instance) => instance.instanceId)).toContain("chatgpt");
    rail(opened)!.props.onSelect(plan);
    const html = menu(render(forBot).html);
    expect(html).toContain("Continue with ChatGPT");
    expect(html).toContain("Available models appear after");
    expect(html).not.toContain("codex login");
    expect(html).not.toContain("Local models will appear");
  });

  it("keeps a signed-out Claude on the rail and shows its sign-in card instead of pickable cloud models", () => {
    fixture.instances = [codex, signedOut()];
    const onCodex = bot("codex", "gpt-5.6");
    const opened = open(onCodex);
    expect(rail(opened)!.props.instances.map((instance) => instance.instanceId)).toEqual(["codex", "claude"]);
    expect(opened.html).toContain('aria-label="Claude"');

    (rail(opened)!.props.onSelect as (instance: InstanceInfo) => void)(fixture.instances[1]);
    const browsing = menu(render(onCodex).html);
    expect(browsing).toContain("Sign in to Claude");
    expect(browsing).toContain("data-claude-sign-in");
    expect(browsing).toContain("2 models will appear after setup.");
    // No official model is offered as a row, so nothing can start a turn on
    // the signed-out account from here.
    expect(browsing).not.toContain(">Opus 5.5<");
    expect(browsing).not.toContain(">Sonnet 5<");
    expect(browsing).not.toContain("No model providers are available.");
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it("opens on the sign-in card when the bot's own Claude is signed out", () => {
    fixture.instances = [signedOut()];
    const html = menu(open(bot("claude", "claude-opus-5-5")).html);
    expect(html).toContain("Sign in to Claude");
    expect(html).not.toContain(">Opus 5.5<");
    expect(html).not.toContain("No model providers are available.");
  });

  it("keeps the bot's own Claude with its install card when the CLI is not found", () => {
    fixture.instances = [codex, notFound()];
    const html = open(bot("claude", "claude-opus-5-5")).html;
    expect(html).toContain('aria-label="Claude"');
    expect(html).toContain("Install Claude");
    expect(html).toContain("`claude` CLI not found");
    expect(html).toContain("npm install -g @anthropic-ai/claude-code");
    // Local models need the CLI too, so there is no way in to them yet.
    expect(html).not.toContain("data-model-local-entry");
  });

  it("leaves a Claude that is not found and not in use in Settings", () => {
    fixture.instances = [codex, notFound()];
    const opened = open(bot("codex", "gpt-5.6"));
    expect(rail(opened)!.props.instances.map((instance) => instance.instanceId)).toEqual(["codex"]);
    expect(opened.html).not.toContain('aria-label="Claude"');
    expect(opened.html).toContain("Model providers and accounts");
  });
});

describe("the way into API keys", () => {
  it("opens Settings on the API keys section from the picker footer", () => {
    fixture.instances = [codex];
    const opened = open(bot("codex", "gpt-5.6"));
    const entry = opened.nodes.find((node) => node.props["data-model-add-api-keys"]);
    expect(opened.html).toContain("Add API keys");
    (entry!.props.onClick as () => void)();
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "toggleAppSettings", open: true, section: "connections" });
  });

  // MOCA-292: once a key is saved, this shortcut is also how a mistyped key gets fixed.
  it("says the shortcut changes keys too once a key is saved", () => {
    const openai: InstanceInfo = {
      instanceId: "openai", driverKind: "openai-compat", displayName: "OpenAI", access: "api",
      snapshot: { state: "available", authenticated: true, version: null },
      models: { default: "gpt-5", options: [{ id: "gpt-5", label: "GPT-5" }] },
    };
    fixture.instances = [codex, openai];
    const opened = open(bot("codex", "gpt-5.6"));
    expect(opened.html).toContain("Add or change API keys");
    expect(opened.html).not.toContain(">Add API keys<");
  });

  it("ends the rail's API keys group with a way to add one", () => {
    fixture.instances = [codex];
    const opened = open(bot("codex", "gpt-5.6"));
    expect(opened.html).toContain(">API keys<");
    const add = rail(opened)!.props as { onAddApiKeys?: () => void };
    add.onAddApiKeys!();
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "toggleAppSettings", open: true, section: "connections" });
  });
});

describe("local models in the one dropdown", () => {
  it("lets a signed-out Claude run a local model it already found, below its sign-in card", () => {
    fixture.instances = [claude({ state: "available", authenticated: false }, [...official, qwen])];
    const onClaude = bot("claude", "claude-opus-5-5");
    const local = openMenu(onClaude);
    const html = menu(local.html);
    expect(html).toContain("Sign in to Claude");
    expect(html).toContain("data-model-local-group");
    expect(html).not.toContain("data-model-cloud-group");
    expect(html).not.toContain("data-model-local-entry");
    (row(local, qwen.id).props.onPick as () => void)();
    expect(fixture.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "setModel", botId: "atlas", threadId: "thread-atlas", updateBotDefault: true, selection: { instanceId: "claude", model: qwen.id },
    }));
  });

  it("has no separate local entry, search, suggested list or show-all control", () => {
    fixture.instances = [claude({ state: "available", version: "2.1.300", authenticated: true }, [...official, qwen])];
    const html = menu(openMenu(bot("claude", "claude-opus-5-5")).html);
    for (const gone of ["data-model-local-entry", "Search models", ">Suggested<", "Show all", "Looking for local models", "Use a local model"]) {
      expect(html).not.toContain(gone);
    }
    expect(html).toContain("data-model-cloud-group");
    expect(html).toContain("data-model-local-group");
  });
});

describe("the picker opens as a modal like Settings", () => {
  it("draws a modal dialog with the providers on the left, the choice on the right and a way to close", () => {
    fixture.instances = [codex, signedIn()];
    const onClaude = bot("claude", "claude-opus-5-5");
    const closed = render(onClaude).html;
    expect(closed).not.toContain("data-model-picker-content");
    const opened = open(onClaude);
    const html = menu(opened.html);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="model-picker-title"');
    expect(opened.html).toContain("data-model-picker-backdrop");
    expect(html).toContain("data-model-provider-column");
    expect(html).toContain('aria-label="Close"');
    // One mode: no scope chooser. The model is one dropdown, then Settings.
    expect(html).not.toContain("Apply model changes to");
    expect(html).not.toContain("Only this thread");
    expect(html).not.toContain("Thread + bot default");
    expect(html).not.toContain("Other threads and groups keep their model.");
    expect(html).toContain("data-model-dropdown");
    expect(html).toContain(">Opus 5.5<");
    expect(html).toContain("Model providers and accounts");
    // Each provider names its status in the column.
    expect(html).toContain("data-rail-status");

    const close = opened.nodes.find((node) => node.props["aria-label"] === "Close")!;
    (close.props.onClick as () => void)();
    expect(render(onClaude).html).not.toContain("data-model-picker-content");
  });

  it("opens that same modal from the profile row", () => {
    fixture.instances = [codex, signedIn()];
    const onClaude = bot("claude", "claude-opus-5-5");
    const profile = { contained: true, threadId: undefined, label: "Default model" };
    const closed = render(onClaude, profile).html;
    expect(closed).toContain("Default model");
    expect(closed).toContain("flex w-full flex-col gap-3");
    expect(closed).not.toContain("justify-between gap-4");
    expect(closed).not.toContain("data-model-picker-backdrop");
    const opened = open(onClaude, profile);
    const html = menu(opened.html);
    expect(opened.html).toContain("data-model-picker-backdrop");
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("data-model-provider-column");
    expect(html).toContain('aria-label="Close"');
    expect(html).toContain(">Opus 5.5<");
    // The profile card sets the bot default; no scope chooser anywhere.
    expect(html).not.toContain("Only this thread");
    // Effort already has its own card under the pill.
    expect(html).not.toContain(">Effort<");
  });

  it("closes from its backdrop, not from a click inside", () => {
    fixture.instances = [signedIn()];
    const onClaude = bot("claude", "claude-opus-5-5");
    const opened = open(onClaude);
    const backdrop = opened.nodes.find((node) => node.props["data-model-picker-backdrop"])!;
    const inside = {};
    (backdrop.props.onMouseDown as (event: unknown) => void)({ target: inside, currentTarget: backdrop });
    expect(render(onClaude).html).toContain("data-model-picker-content");
    (backdrop.props.onMouseDown as (event: unknown) => void)({ target: backdrop, currentTarget: backdrop });
    expect(render(onClaude).html).not.toContain("data-model-picker-content");
  });
});

describe("local models in solo", () => {
  it("lists DwarfStar under Local next to Claude's own models and drops the separate entry", () => {
    const ds4 = [
      { id: "dwarfstar::qwen3.8-flash-next", label: "DwarfStar: Qwen3.8 Flash Next (qwen3.8-flash-next)", custom: true, local: true, contextWindow: 262144 },
      { id: "dwarfstar::qwen3.8-flash-next-chat", label: "DwarfStar: Qwen3.8 Flash Next (qwen3.8-flash-next-chat)", custom: true, local: true, contextWindow: 262144 },
    ];
    fixture.instances = [claude({ state: "available", version: "2.1.300", authenticated: true }, [...official, ...ds4])];
    const onClaude = bot("claude", "claude-opus-5-5");
    const opened = openMenu(onClaude);
    const html = menu(opened.html);
    expect(html).toContain(">Opus 5.5<");
    expect(html).toContain("data-model-local-group");
    expect(html).toContain("DwarfStar: Qwen3.8 Flash Next (qwen3.8-flash-next-chat)");
    // Claude Code talks to a loopback server that answers /v1/messages.
    expect(html).not.toContain("data-model-unavailable");
    expect(html).not.toContain("data-model-local-entry");
    (row(opened, ds4[1]!.id).props.onPick as () => void)();
    expect(fixture.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "setModel", selection: expect.objectContaining({ model: ds4[1]!.id }) }));
  });

  it("greys a local row on an engine that keeps its own endpoint", () => {
    const gemini: InstanceInfo = {
      instanceId: "gemini", driverKind: "geminiAgent", displayName: "Gemini", access: "subscription",
      snapshot: { state: "available", authenticated: true },
      models: { default: "gemini-pro", options: [{ id: "gemini-pro", label: "Gemini Pro" }, { id: "dwarfstar::qwen3.8-flash-next", label: "DwarfStar: Qwen3.8 Flash Next", custom: true, local: true }] },
    };
    fixture.instances = [gemini];
    const html = menu(openMenu(bot("gemini", "gemini-pro")).html);
    // Disabled, the reason as a short tooltip, no paragraph above the rows.
    expect(html).toContain("data-model-unavailable");
    expect(html).toContain('title="Gemini cannot run a local model."');
    expect(html).not.toContain("data-model-local-unavailable");
  });
});

describe("the Grok list", () => {
  // The server builds it from the engine's own answer (server/drivers/acp/grok.ts
  // probeGrokModels), and opening the picker in solo re-reads it.
  const grok: InstanceInfo = {
    instanceId: "grok", driverKind: "grokAgent", displayName: "Grok", access: "subscription",
    snapshot: { state: "available", version: "1.0.50", authenticated: true },
    models: { default: "grok-4.7", options: [
      { id: "grok-4.7", label: "Grok 4.7" }, { id: "grok-4.7-build-fast", label: "Grok 4.7 Fast" },
      { id: "dwarfstar::qwen3.8-flash-next", label: "DwarfStar: Qwen3.8 Flash Next", custom: true, local: true },
    ] },
    capabilities: { withholdsHostTools: true },
  };

  it("shows what the engine offers, nothing it does not, and a local row Grok can run", () => {
    fixture.instances = [grok];
    const html = menu(openMenu(bot("grok", "grok-4.7")).html);
    expect(html).toContain(">Grok 4.7 Fast<");
    expect(html).not.toContain("Grok 4.5");
    expect(html).not.toContain("Grok 4.6");
    expect(html).toContain("DwarfStar: Qwen3.8 Flash Next");
    expect(html).not.toContain("data-model-unavailable");
  });
});

describe("on an organization server", () => {
  const issuer = "https://px.example.test";
  const orgOf = (viewerRole: "admin" | "member") => ({
    org: { name: "GOX", identity: { kind: "perspicax", issuer } }, link: { state: "ok" }, viewerRole,
    settings: { memberBotsUseOrgKey: true },
  });
  const engine = (patch: Record<string, unknown> = {}) => ({
    instanceId: "claude", driver: "claudeAgent", displayName: "Claude", installed: true,
    subscription: { supported: true, signedIn: false }, myKey: false, orgKey: true, myTurns: "org-key", ...patch,
  });
  const ollama: InstanceInfo = {
    instanceId: "ollama", driverKind: "openaiCompatible", displayName: "Ollama", access: "custom",
    snapshot: { state: "available", authenticated: true }, models: { default: "", options: [qwen] },
  };
  it("opens on a minimal engine card: what pays today, Connect, and the server's models stay pickable without the server's own sign-in", () => {
    fixture.org = orgOf("member");
    fixture.myEngines = [engine()];
    fixture.instances = [signedOut(), ollama];
    const onClaude = bot("claude", "claude-opus-5-5");
    const opened = open(onClaude);
    const html = menu(opened.html);
    expect(html).toContain('aria-modal="true"');
    // One status line and one button, no payer chain.
    expect(html).toContain('data-pays-with="org-key"');
    expect(html).toContain("Pays with: the organization key");
    expect(html).toContain("Connect Claude");
    expect(html).not.toContain("Who pays for your turns");
    expect(html).not.toContain("Checked in this order");
    expect(html).not.toContain("data-payer=");
    expect(html).not.toContain("Sign in with your Claude account");
    expect(html).not.toContain("kept on the organization server for you only");
    // The small link to their keys, while no subscription is signed in.
    expect(html).toContain("data-engine-keys-link");
    expect(html).toContain(`${issuer}/console/pulsabot/keys`);
    // The server's sign-in card is not the person's: models stay listed.
    expect(html).toContain(">Opus 5.5<");
    expect(html).not.toContain("2 models will appear after setup.");
    // No local model from the server's machine.
    expect(rail(opened)!.props.instances.map((instance) => instance.instanceId)).toEqual(["claude"]);
    expect(html).not.toContain("data-model-local-entry");
    expect(html).not.toContain("data-model-host-tools");
  });

  it("offers engines that withhold host tools, keeps the current one, and says why it cannot run", () => {
    fixture.org = orgOf("member");
    fixture.myEngines = [engine()];
    const grok: InstanceInfo = {
      instanceId: "grok", driverKind: "grokAgent", displayName: "Grok", access: "subscription",
      snapshot: { state: "available", authenticated: true },
      models: { default: "grok-4.7", options: [{ id: "grok-4.7", label: "Grok 4.7" }] },
      capabilities: { withholdsHostTools: true },
    };
    const pi: InstanceInfo = {
      instanceId: "pi", driverKind: "piAgent", displayName: "pi", access: "custom",
      snapshot: { state: "available", authenticated: true },
      models: { default: "openai/gpt-4o", options: [{ id: "openai/gpt-4o", label: "gpt-4o", custom: true }] },
      capabilities: { withholdsHostTools: true },
    };
    const droid: InstanceInfo = {
      instanceId: "droid", driverKind: "droidAgent", displayName: "Droid", access: "subscription",
      snapshot: { state: "available", authenticated: true },
      models: { default: "droid-pro", options: [{ id: "droid-pro", label: "Droid Pro" }] },
    };
    const cursor: InstanceInfo = { ...droid, instanceId: "cursor", driverKind: "cursorAgent", displayName: "Cursor Agent" };
    fixture.instances = [signedOut(), grok, pi, droid, cursor, ollama];
    const opened = open(bot("droid", "droid-pro"));
    // a refused engine other than the bot's own is not offered
    expect(rail(opened)!.props.instances.map((instance) => instance.instanceId)).toEqual(["claude", "grok", "pi", "droid"]);
    const html = menu(opened.html);
    expect(html).toContain('data-model-host-tools="droid"');
    expect(html).toContain("Droid cannot hold back its own tools on this server. Its ACP mode ignores the tool selection, so its shell and file tools would run there.");
    rail(opened)!.props.onSelect(grok);
    expect(menu(render(bot("droid", "droid-pro")).html)).not.toContain("data-model-host-tools");
  });

  it("lists the person's own computer under Local, pickable on Codex and greyed on Claude Code when the server does not speak the Anthropic protocol", () => {
    fixture.org = orgOf("member");
    fixture.myEngines = [engine()];
    const desk = [
      { id: "deskab12cd8002::qwen3.8-flash-next-chat", label: "DwarfStar: Qwen3.8 Flash Next (qwen3.8-flash-next-chat)", custom: true, local: true },
    ];
    // The server's own loopback model never shows on an organization server.
    const serverLoopback = { id: "ollama::qwen3", label: "Ollama: qwen3", custom: true, local: true };
    const codexDesk: InstanceInfo = { ...codex, models: { ...codex.models, options: [...codex.models.options, ...desk, serverLoopback] } };
    fixture.instances = [claude({ state: "available", version: "2.1.300", authenticated: true }, [...official, ...desk, serverLoopback]), codexDesk];
    const onCodex = bot("codex", "gpt-5.6");
    const opened = openMenu(onCodex);
    let html = menu(opened.html);
    expect(html).toContain("data-model-local-group");
    expect(html).toContain(">Local<");
    expect(html).toContain("DwarfStar: Qwen3.8 Flash Next (qwen3.8-flash-next-chat)");
    expect(html).not.toContain("Ollama: qwen3");
    expect(html).not.toContain("data-model-unavailable");
    expect(html).not.toContain("data-model-local-entry");
    (row(opened, desk[0]!.id).props.onPick as () => void)();
    expect(fixture.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "setModel", selection: expect.objectContaining({ instanceId: "codex", model: desk[0]!.id }) }));

    fixture.dispatch = vi.fn();
    const onClaude = bot("claude", "claude-opus-5-5");
    const claudeOpen = openMenu(onClaude);
    html = menu(claudeOpen.html);
    expect(html).toContain("data-model-local-group");
    expect(html).toContain("data-model-unavailable");
    expect(html).toContain('title="This local server does not speak the Anthropic protocol."');
    const greyed = row(claudeOpen, desk[0]!.id);
    expect(greyed.props.unavailable).toBeTruthy();
    (greyed.props.onPick as () => void)();
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it("lets Claude Code pick the person's own computer's model once the desktop probe saw the Anthropic protocol", () => {
    fixture.org = orgOf("member");
    fixture.myEngines = [engine()];
    const desk = [
      { id: "deskab12cd8002::qwen3.8-flash-next-chat", label: "DwarfStar: Qwen3.8 Flash Next (qwen3.8-flash-next-chat)", custom: true, local: true, anthropic: true },
      { id: "deskab12cd9337::gguf", label: "llama-server: gguf", custom: true, local: true },
    ];
    fixture.instances = [claude({ state: "available", version: "2.1.300", authenticated: true }, [...official, ...desk])];
    const claudeOpen = openMenu(bot("claude", "claude-opus-5-5"));
    const html = menu(claudeOpen.html);
    expect(html).toContain("data-model-local-group");
    const node = (id: string) => row(claudeOpen, id);
    expect(node(desk[0]!.id).props.unavailable).toBeFalsy();
    expect(node(desk[1]!.id).props.unavailable).toBe("This local server does not speak the Anthropic protocol.");
    (node(desk[0]!.id).props.onPick as () => void)();
    expect(fixture.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "setModel", selection: expect.objectContaining({ instanceId: "claude", model: desk[0]!.id }) }));
  });

  it("shows Connected and Disconnect once the person's subscription is signed in, for an admin too", () => {
    fixture.org = orgOf("admin");
    fixture.myEngines = [engine({ subscription: { supported: true, signedIn: true }, myKey: true, myTurns: "subscription" })];
    fixture.instances = [signedIn()];
    const html = menu(open(bot("claude", "claude-opus-5-5")).html);
    expect(html).toContain("Pays with: your subscription");
    expect(html).toContain("data-engine-connected");
    expect(html).toContain(">Disconnect<");
    expect(html).not.toContain("Connect Claude");
    expect(html).not.toContain("data-engine-keys-link");
    expect(html).not.toContain("data-payer=");
  });

  it("says Not connected when nothing pays yet, without the old warnings", () => {
    fixture.org = orgOf("member");
    fixture.myEngines = [engine({ orgKey: false, myTurns: "none" })];
    fixture.instances = [signedOut()];
    const html = menu(open(bot("claude", "claude-opus-5-5")).html);
    expect(html).toContain('data-pays-with="none"');
    expect(html).toContain("Not connected");
    expect(html).toContain("Connect Claude");
    expect(html).not.toContain("Nothing pays for this provider yet");
    expect(html).not.toContain("Can&#x27;t answer you yet");
  });

  it("says a routine's thread pays with the bot owner's credentials", () => {
    fixture.org = orgOf("member");
    fixture.myEngines = [engine({ orgKey: false, myTurns: "none" })];
    fixture.instances = [signedIn()];
    const onClaude = bot("claude", "claude-opus-5-5");
    fixture.bots = [{ ...onClaude, tasks: [{ threadId: onClaude.threadId, title: "Daily digest", createdAt: 1, routineRunId: "run-1" }] }];
    const html = menu(open(onClaude).html);
    expect(html).toContain("data-model-payers-routine");
    expect(html).toContain("Owner&#x27;s credentials");
    expect(html).not.toContain("data-engine-connect=");
    expect(html).not.toContain("Connect Claude");
  });
});

describe("ModelPicker Auto (docs/plans/2026-10-08-auto-model.md)", () => {
  const record = {
    instanceId: "claude", model: "claude-fable-5-1", engineLabel: "Claude", modelLabel: "Fable 5.1",
    role: "orchestration" as const, tier: "top" as const, reason: "strongest-own" as const, via: "subscription" as const, at: 1,
  };

  it("offers Auto above the models and turns it on for the thread, keeping the engine and base model", () => {
    fixture.instances = [signedIn()];
    const forBot = bot("claude", "claude-sonnet-5");
    const opened = open(forBot);
    const toggle = opened.nodes.find((node) => node.props["data-model-auto-toggle"] !== undefined)!;
    expect(toggle.props["aria-pressed"]).toBe(false);
    expect(menu(opened.html)).toContain("Auto: the best model per task");
    (toggle.props.onClick as () => void)();
    // One mode: Auto runs this thread and becomes the bot's model.
    expect(fixture.dispatch).toHaveBeenCalledWith({
      type: "setModel", botId: "atlas", threadId: "thread-atlas", updateBotDefault: true,
      selection: { instanceId: "claude", model: "claude-sonnet-5", auto: true },
    });
  });

  it("names the thread's last pick on the chip and explains it in the picker", () => {
    fixture.instances = [signedIn()];
    const forBot = { ...bot("claude", "claude-sonnet-5"), modelSelection: { instanceId: "claude", model: "claude-sonnet-5", auto: true as const } };
    fixture.bots = [{ ...forBot, tasks: [{ threadId: "thread-atlas", title: "t", createdAt: 1, autoModel: record }] }];
    const closed = render(forBot).html;
    expect(closed).toContain("data-model-auto-chip");
    expect(closed).toContain("Auto · Fable 5.1");
    const opened = open(forBot);
    const toggle = opened.nodes.find((node) => node.props["data-model-auto-toggle"] !== undefined)!;
    expect(toggle.props["aria-pressed"]).toBe(true);
    expect(menu(opened.html)).toContain("Auto: Fable 5.1 for this bot, because it is the strongest general model your subscription can run on Claude, the engine this bot runs on.");
    // Under Auto no model row reads as the pinned choice.
    expect(opened.nodes.filter((node) => node.props.current === true)).toHaveLength(0);
  });

  it("pins a model again when one is chosen", () => {
    fixture.instances = [signedIn()];
    const forBot = { ...bot("claude", "claude-sonnet-5"), modelSelection: { instanceId: "claude", model: "claude-sonnet-5", auto: true as const } };
    const opened = openMenu(forBot);
    (row(opened, "claude-opus-5-5").props.onPick as () => void)();
    const call = (fixture.dispatch as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0] as { selection: Record<string, unknown> };
    expect(call.selection).toEqual({ instanceId: "claude", model: "claude-opus-5-5" });
  });

  it("shows plain Auto before any pick is known", () => {
    fixture.instances = [signedIn()];
    const forBot = { ...bot("claude", "claude-sonnet-5"), modelSelection: { instanceId: "claude", model: "claude-sonnet-5", auto: true as const } };
    const html = render(forBot).html;
    expect(html).toContain(">Auto<");
    expect(html).not.toContain(">Sonnet 5<");
  });
});

describe("one mode (2026-10-09)", () => {
  it("makes a model chosen in a thread the thread's and the bot's in one request", () => {
    fixture.instances = [signedIn()];
    const opened = openMenu(bot("claude", "claude-opus-5-5"));
    (row(opened, "claude-sonnet-5").props.onPick as () => void)();
    expect(fixture.dispatch).toHaveBeenCalledExactlyOnceWith({
      type: "setModel", botId: "atlas", threadId: "thread-atlas", updateBotDefault: true,
      selection: { instanceId: "claude", model: "claude-sonnet-5" },
    });
  });

  it("keeps Use the bot's model as a way back without touching the bot", () => {
    fixture.instances = [signedIn()];
    const profile = { ...bot("claude", "claude-opus-5-5"), tasks: [{ threadId: "thread-atlas", title: "t", createdAt: 1, followsBotModel: false, modelSelection: { instanceId: "claude", model: "claude-sonnet-5" } }] };
    fixture.bots = [profile];
    const opened = open({ ...profile, modelSelection: { instanceId: "claude", model: "claude-sonnet-5" } });
    const follow = opened.nodes.find((node) => node.type === FollowBotModelRow)!;
    (follow.props.onPick as () => void)();
    expect(fixture.dispatch).toHaveBeenCalledExactlyOnceWith({
      type: "setModel", botId: "atlas", threadId: "thread-atlas", updateBotDefault: false,
      selection: { instanceId: "claude", model: "claude-opus-5-5" },
    });
  });
});

describe("the model dropdown", () => {
  it("lists the models under Cloud and Local, checks the current one and marks the provider's default", () => {
    const ds4 = { id: "dwarfstar::qwen3.8-flash-next", label: "DwarfStar: Qwen3.8 Flash Next", custom: true, local: true };
    fixture.instances = [claude({ state: "available", version: "2.1.300", authenticated: true }, [...official, ds4])];
    const forBot = bot("claude", "claude-sonnet-5");
    const closed = menu(open(forBot).html);
    // Closed, it reads the current model and lists nothing.
    expect(closed).toContain('aria-haspopup="listbox"');
    expect(closed).toContain(">Sonnet 5<");
    expect(closed).not.toContain('role="listbox"');
    fixture.values = [];
    const opened = openMenu(forBot);
    const html = menu(opened.html);
    expect(html).toContain('role="listbox"');
    expect(html.indexOf("data-model-cloud-group")).toBeLessThan(html.indexOf("data-model-local-group"));
    expect(html).toContain('aria-label="Cloud"');
    expect(html).toContain('aria-label="Local"');
    expect(row(opened, "claude-sonnet-5").props.current).toBe(true);
    expect(row(opened, "claude-opus-5-5").props.current).toBe(false);
    expect(row(opened, "claude-opus-5-5").props.isDefault).toBe(true);
    expect(html).toMatch(/data-model-option="claude-sonnet-5"[^>]*aria-selected="true"|aria-selected="true"[^>]*data-model-option="claude-sonnet-5"/);
    expect(html).toContain("data-model-default");
  });

  it("closes from its own control and leaves the dialog open", () => {
    fixture.instances = [signedIn()];
    const forBot = bot("claude", "claude-opus-5-5");
    const opened = openMenu(forBot);
    const dropdown = opened.nodes.find((node) => node.type === ModelDropdown)!;
    (dropdown.props.onOpenChange as (open: boolean) => void)(false);
    const html = render(forBot).html;
    expect(html).toContain("data-model-picker-content");
    expect(html).not.toContain('role="listbox"');
  });
});

describe("Connected is said once", () => {
  it("leaves the header with the provider's name and refresh, and the access card says Connected with Disconnect", () => {
    fixture.org = { org: { name: "GOX", identity: { kind: "perspicax", issuer: "https://px.example.test" } }, link: { state: "ok" }, viewerRole: "member", settings: {} };
    fixture.myEngines = [{
      instanceId: "claude", driver: "claudeAgent", displayName: "Claude", installed: true,
      subscription: { supported: true, signedIn: true }, myKey: false, orgKey: false, myTurns: "subscription",
    }];
    fixture.instances = [signedIn()];
    const html = menu(open(bot("claude", "claude-opus-5-5")).html);
    // The right pane starts at its title; the provider column comes before it.
    const pane = html.slice(html.indexOf('id="model-picker-title"'));
    expect(pane).not.toContain("data-model-status");
    expect(pane.match(/Connected/g)).toHaveLength(1);
    expect(pane).toContain("data-engine-connected");
    expect(pane).toContain(">Disconnect<");
    expect(pane).toContain("data-model-refresh");
  });

  it("has no status badge in the header on a solo server either", () => {
    fixture.instances = [signedIn()];
    expect(menu(open(bot("claude", "claude-opus-5-5")).html)).not.toContain("data-model-status");
  });
});

describe("the organization's allowed model providers", () => {
  const orgFixture = { org: { name: "GOX", identity: { kind: "perspicax", issuer: "https://px.example.test" } }, link: { state: "ok" }, viewerRole: "member", settings: {} };
  const mine = (instanceId: string, driver: string, signedIn: boolean) => ({
    instanceId, driver, displayName: instanceId, installed: true,
    subscription: { supported: true, signedIn }, myKey: false, orgKey: true, myTurns: signedIn ? "subscription" : "org-key",
  });
  const grok: InstanceInfo = {
    instanceId: "grok", driverKind: "grokAgent", displayName: "Grok", access: "subscription",
    snapshot: { state: "available", authenticated: true },
    models: { default: "grok-4.7", options: [{ id: "grok-4.7", label: "Grok 4.7" }] },
    capabilities: { withholdsHostTools: true },
  };

  it("lists only the allowed providers on the rail", () => {
    fixture.org = orgFixture;
    fixture.myEngines = [mine("claude", "claudeAgent", false), mine("codex", "codex", false), mine("grok", "grokAgent", false)];
    fixture.config = { allowedEngines: ["claude", "grok"] };
    fixture.instances = [signedIn(), codex, grok];
    const opened = open(bot("claude", "claude-opus-5-5"));
    expect(rail(opened)!.props.instances.map((instance) => instance.instanceId)).toEqual(["claude", "grok"]);
  });

  it("lists everything when the list is empty or missing, and on a solo server", () => {
    fixture.instances = [signedIn(), codex];
    fixture.config = { allowedEngines: ["claude"] };
    // Solo: the setting is an organization's; nothing is filtered.
    expect(rail(open(bot("claude", "claude-opus-5-5")))!.props.instances.map((instance) => instance.instanceId)).toEqual(["claude", "codex"]);
    fixture.org = orgFixture;
    fixture.myEngines = [mine("claude", "claudeAgent", false), mine("codex", "codex", false)];
    for (const config of [{ allowedEngines: [] }, { allowedEngines: null }, null]) {
      fixture.values = [];
      fixture.config = config;
      expect(rail(open(bot("claude", "claude-opus-5-5")))!.props.instances.map((instance) => instance.instanceId)).toEqual(["claude", "codex"]);
    }
  });

  it("shows a provider the person connected but no longer allowed once, disabled, and nothing from it can be picked", () => {
    fixture.org = orgFixture;
    fixture.myEngines = [mine("claude", "claudeAgent", false), mine("codex", "codex", true)];
    fixture.config = { allowedEngines: ["claude"] };
    fixture.instances = [signedIn(), codex];
    const forBot = bot("claude", "claude-opus-5-5");
    const opened = open(forBot);
    const column = rail(opened)!.props as { instances: InstanceInfo[]; notAllowed?: (instance: InstanceInfo) => boolean; onSelect: (instance: InstanceInfo) => void };
    expect(column.instances.map((instance) => instance.instanceId)).toEqual(["claude", "codex"]);
    expect(column.notAllowed!(codex)).toBe(true);
    expect(column.notAllowed!(fixture.instances[0]!)).toBe(false);
    const html = renderToStaticMarkup(createElement(ModelEngineRail, { ...column, wide: true } as Parameters<typeof ModelEngineRail>[0]));
    expect(html.match(/data-rail-not-allowed/g)).toHaveLength(1);
    expect(html).toContain("Not allowed by your organization");
    // Choosing it does nothing: the pane stays on Claude, no model from Codex.
    column.onSelect(codex);
    const after = render(forBot);
    expect(menu(after.html)).not.toContain("GPT-5.6");
    expect(row(after, "gpt-5.6")).toBeUndefined();
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it("drops a provider that is not allowed and not connected, even the bot's current one", () => {
    fixture.org = orgFixture;
    fixture.myEngines = [mine("claude", "claudeAgent", false), mine("codex", "codex", false)];
    fixture.config = { allowedEngines: ["claude"] };
    fixture.instances = [signedIn(), codex];
    const opened = open(bot("codex", "gpt-5.6"));
    expect(rail(opened)!.props.instances.map((instance) => instance.instanceId)).toEqual(["claude"]);
    expect(menu(opened.html)).toContain("model-picker-title");
    expect(row(opened, "gpt-5.6")).toBeUndefined();
  });
});
