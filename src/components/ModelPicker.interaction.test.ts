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
    state: { instances: fixture.instances, bots: fixture.bots, modelVariantSessions: {} },
    dispatch: fixture.dispatch,
    refreshInstances: fixture.refreshInstances,
    refreshModels: fixture.refreshModels,
  }),
}));

const { LOCAL_PROBE_TIMEOUT_MS, ModelEngineRail, ModelPicker, offersLocalModels, probeLocalModels } = await import("./ModelPicker");

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
});
const signedOut = () => claude({ state: "available", version: "2.1.300", authenticated: false });
const signedIn = () => claude({ state: "available", version: "2.1.300", authenticated: true });
const notFound = () => claude({ state: "unavailable", reason: "`claude` CLI not found" });
const codex: InstanceInfo = {
  instanceId: "codex", driverKind: "codex", displayName: "Codex", access: "subscription",
  snapshot: { state: "available", version: "1.0.0", authenticated: true },
  models: { default: "gpt-5.6", options: [{ id: "gpt-5.6", label: "GPT-5.6" }] },
};

function bot(instanceId: string, model: string): Bot {
  return {
    id: "atlas", threadId: "thread-atlas", name: "Atlas", title: "", description: "", notifications: true,
    color: "green", unread: false, modelSelection: { instanceId, model }, messages: [],
  };
}

/** Render the picker once; the picker's own state survives, children start fresh. */
function render(forBot: Bot) {
  fixture.values.length = Math.min(fixture.values.length, fixture.own);
  let tree: ReactNode = null;
  function Capture() {
    fixture.index = 0;
    tree = ModelPicker({ bot: forBot, threadId: forBot.threadId });
    fixture.own = fixture.index;
    return tree;
  }
  const html = renderToStaticMarkup(createElement(Capture));
  return { html, nodes: nodes(tree) };
}

function open(forBot: Bot) {
  const trigger = render(forBot).nodes.find((node) => node.props["data-tour"] === "model")!;
  (trigger.props.onClick as () => void)();
  return render(forBot);
}

function rail(rendered: ReturnType<typeof render>) {
  return rendered.nodes.find((node) => node.type === ModelEngineRail) as ReactElement<{ instances: InstanceInfo[]; onSelect: (instance: InstanceInfo) => void }> | undefined;
}

/** The open menu only; the trigger always names the saved model. */
const menu = (html: string) => html.slice(html.indexOf("data-model-picker-content"));

const flush = async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); };

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

  it("ends the rail's API keys group with a way to add one", () => {
    fixture.instances = [codex];
    const opened = open(bot("codex", "gpt-5.6"));
    expect(opened.html).toContain(">API keys<");
    const add = rail(opened)!.props as { onAddApiKeys?: () => void };
    add.onAddApiKeys!();
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "toggleAppSettings", open: true, section: "connections" });
  });
});

describe("the way into local models", () => {
  it.each([["signed in", signedIn], ["signed out", signedOut]])("shows for a %s Claude with no local models found yet, and re-probes when opened", async (_state, make) => {
    fixture.instances = [make()];
    let answer!: () => void;
    fixture.refreshModels = vi.fn(() => new Promise<void>((resolve) => { answer = resolve; }));
    const onClaude = bot("claude", "claude-opus-5-5");
    const opened = open(onClaude);
    const entry = opened.nodes.find((node) => node.props["data-model-local-entry"]);
    expect(entry?.props["aria-label"]).toBe("Use a local model");
    expect(entry?.props.disabled).toBe(false);

    (entry!.props.onClick as () => void)();
    expect(fixture.refreshModels).toHaveBeenCalledExactlyOnceWith("claude");
    const looking = render(onClaude).html;
    expect(looking).toContain("Looking for local models…");
    expect(looking).toContain('role="status"');
    expect(looking).not.toContain("No local models found");

    // The probe found a model the startup scan missed.
    fixture.instances = [make()];
    fixture.instances[0].models.options = [...official, qwen];
    answer();
    await flush();
    const found = render(onClaude).html;
    expect(found).not.toContain("Looking for local models…");
    expect(found).toContain(">qwen3 (Ollama)<");
  });

  it("says nothing was found once the probe settles empty", async () => {
    fixture.instances = [signedIn()];
    const onClaude = bot("claude", "claude-opus-5-5");
    const entry = open(onClaude).nodes.find((node) => node.props["data-model-local-entry"])!;
    (entry.props.onClick as () => void)();
    await flush();
    const html = render(onClaude).html;
    expect(html).not.toContain("Looking for local models…");
    expect(html).toContain("No local models found");
  });

  it("lets a signed-out Claude run a local model it already found", () => {
    fixture.instances = [claude({ state: "available", authenticated: false }, [...official, qwen])];
    const onClaude = bot("claude", "claude-opus-5-5");
    const entry = open(onClaude).nodes.find((node) => node.props["data-model-local-entry"])!;
    expect(entry.props["aria-label"]).toBe("Use a local model (1 available)");
    (entry.props.onClick as () => void)();
    const local = render(onClaude);
    const row = local.nodes.find((node) => (node.props.option as { id?: string } | undefined)?.id === qwen.id) as ReactElement<{ onPick: () => void }>;
    row.props.onPick();
    expect(fixture.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "setModel", botId: "atlas", threadId: "thread-atlas", selection: { instanceId: "claude", model: qwen.id },
    }));
  });

  it("is offered by Claude whenever its CLI is present, and by other engines once they list a local model", () => {
    expect(offersLocalModels(signedIn(), 0)).toBe(true);
    expect(offersLocalModels(signedOut(), 0)).toBe(true);
    expect(offersLocalModels(notFound(), 0)).toBe(false);
    expect(offersLocalModels({ ...signedIn(), policy: { organizationName: "Fixture", reason: "Not allowed" } }, 0)).toBe(false);
    expect(offersLocalModels(codex, 0)).toBe(false);
    expect(offersLocalModels(codex, 2)).toBe(true);
    expect(offersLocalModels(undefined, 0)).toBe(false);
  });

  it("stops looking after a short timeout and never throws", async () => {
    vi.useFakeTimers();
    let settled = false;
    void probeLocalModels("claude", () => new Promise(() => {})).then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(LOCAL_PROBE_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
    await expect(probeLocalModels("claude", () => Promise.reject(new Error("offline")))).resolves.toBeUndefined();
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
    // Account, scope, models and the way to Settings, each with room.
    expect(html).toContain(">Only this thread<");
    expect(html).toContain(">Thread + bot default<");
    expect(html).toContain(">Opus 5.5<");
    expect(html).toContain("Model providers and accounts");
    expect(html).toContain("data-model-local-entry");
    // Each provider names its status in the column.
    expect(html).toContain("data-rail-status");

    const close = opened.nodes.find((node) => node.props["aria-label"] === "Close")!;
    (close.props.onClick as () => void)();
    expect(render(onClaude).html).not.toContain("data-model-picker-content");
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
  const order = (html: string, ids: string[]) => ids.map((id) => html.indexOf(`data-payer="${id}"`));

  it("opens, shows the speaker's payer order and keeps the server's models pickable without the server's own sign-in", () => {
    fixture.org = orgOf("member");
    fixture.myEngines = [engine()];
    fixture.instances = [signedOut(), ollama];
    const onClaude = bot("claude", "claude-opus-5-5");
    const opened = open(onClaude);
    const html = menu(opened.html);
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("Who pays for your turns");
    const rows = order(html, ["subscription", "key", "org-key"]);
    expect(rows.every((index) => index > 0)).toBe(true);
    expect([...rows].sort((a, b) => a - b)).toEqual(rows);
    // The server's own sign-ins pay for no one, admins included.
    expect(html).not.toContain('data-payer="server"');
    expect(html).toMatch(/data-payer="org-key"[^>]*aria-current="true"/);
    expect(html).toContain("Used now");
    // Their own subscription signs in through the organization server.
    expect(html).toContain("data-model-personal-sign-in");
    expect(html).toContain("Sign in with your Claude account");
    expect(html).toContain(`${issuer}/console/pulsabot/keys`);
    // The server's sign-in card is not the person's: models stay listed.
    expect(html).toContain(">Opus 5.5<");
    expect(html).not.toContain("2 models will appear after setup.");
    // No local model from the server's machine.
    expect(rail(opened)!.props.instances.map((instance) => instance.instanceId)).toEqual(["claude"]);
    expect(html).not.toContain("data-model-local-entry");
    expect(html).toContain("data-model-local-hidden");
  });

  it("follows the server's answer for an admin too: no server row, the subscription first once signed in", () => {
    fixture.org = orgOf("admin");
    fixture.myEngines = [engine({ subscription: { supported: true, signedIn: true }, myKey: true, myTurns: "subscription" })];
    fixture.instances = [signedIn()];
    const html = menu(open(bot("claude", "claude-opus-5-5")).html);
    const rows = order(html, ["subscription", "key", "org-key"]);
    expect([...rows].sort((a, b) => a - b)).toEqual(rows);
    expect(html).not.toContain('data-payer="server"');
    expect(html).toMatch(/data-payer="subscription"[^>]*aria-current="true"/);
    expect(html).not.toContain("data-model-personal-sign-in");
  });

  it("warns when nothing pays yet", () => {
    fixture.org = orgOf("member");
    fixture.myEngines = [engine({ orgKey: false, myTurns: "none" })];
    fixture.instances = [signedOut()];
    const html = menu(open(bot("claude", "claude-opus-5-5")).html);
    expect(html).toContain("Nothing pays for this provider yet");
    expect(html).not.toContain('aria-current="true"');
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
    expect(html).not.toContain("data-model-personal-sign-in");
    expect(html).not.toContain("Nothing pays for this provider yet");
  });
});
