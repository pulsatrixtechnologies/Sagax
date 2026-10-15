// The mascot's menu in the bot panel (BotContextMenu variant "mascot"):
// Edit bot and Put on the desktop (JC, 2026-10-14). Rename is the name in
// the panel, and Make primary bot is in the sidebar menu's More. No Browse
// Bots row (it lives in the sidebar).
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState, Bot } from "@/state/store";
import { setLocale } from "@/lib/i18n";

const fixture = vi.hoisted(() => ({
  portal: null as ReactNode,
  state: {} as Partial<AppState>,
  toggled: [] as string[],
}));
vi.mock("react-dom", async (importOriginal) => {
  const original = await importOriginal<typeof import("react-dom")>();
  return { ...original, createPortal: (node: ReactNode) => { fixture.portal = node; return node; } };
});
vi.mock("./DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({}) }));
vi.mock("@/lib/thread-preferences", () => ({ useShowThreads: () => true }));
vi.mock("@/lib/floating-bots", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/floating-bots")>()),
  toggleFloatingBot: (id: string) => { fixture.toggled.push(id); return true; },
}));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: { ...original.initialState, ...fixture.state }, dispatch: vi.fn() }) };
});

const { BotContextMenu } = await import("./Sidebar");

const bot = {
  id: "dumpling", threadId: "thread", name: "Dumpling", title: "", description: "", notifications: true,
  color: "green", unread: false, messages: [], modelSelection: { instanceId: "test", model: "test" },
} as unknown as Bot;

const handlers = () => ({
  onClose: vi.fn(),
  onRename: vi.fn(),
  onMakePrimary: vi.fn(),
  onEditPersona: vi.fn(),
});

function render(target: Bot = bot, props = handlers()) {
  fixture.state = { bots: [target, { ...bot, id: "other", name: "Other" } as Bot], ...fixture.state };
  const html = renderToStaticMarkup(createElement(BotContextMenu, { variant: "mascot", menu: { botId: target.id, x: 10, y: 10 }, ...props }));
  return { html, props };
}

function items(html: string): string[] {
  return [...html.matchAll(/data-menu-item="([\w-]+)"/g)].map((match) => match[1]!);
}

/** The menu's buttons as React elements, by their data-menu-item. */
function buttons(): Map<string, ReactElement<{ onClick: () => void; disabled?: boolean }>> {
  const found = new Map<string, ReactElement<{ onClick: () => void; disabled?: boolean }>>();
  const walk = (node: ReactNode) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!isValidElement(node)) return;
    const props = node.props as { "data-menu-item"?: string; children?: ReactNode };
    if (props["data-menu-item"]) found.set(props["data-menu-item"], node as ReactElement<{ onClick: () => void; disabled?: boolean }>);
    walk(props.children);
  };
  walk(fixture.portal);
  return found;
}

const member = { viewer: { role: "member", principalId: "pr_me", operator: false } } as unknown as AppState["config"];

beforeEach(() => {
  setLocale("en");
  fixture.state = {};
  fixture.toggled = [];
  fixture.portal = null;
  vi.stubGlobal("document", { body: {}, activeElement: null });
  vi.stubGlobal("window", { innerWidth: 1000, innerHeight: 800, addEventListener() {}, removeEventListener() {} });
});
afterEach(() => vi.unstubAllGlobals());

describe("mascot menu", () => {
  it("lists its two items in order, with no separator and no Browse Bots", () => {
    const { html } = render();
    expect(items(html)).toEqual(["edit-persona", "put-on-desktop"]);
    expect(html).toContain('data-bot-menu-variant="mascot"');
    expect(html).toContain(">Edit bot<");
    expect(html).toContain(">Put on the desktop<");
    expect(html).not.toContain("Rename");
    expect(html).not.toContain("primary");
    expect(html).not.toContain("Browse Bots");
    expect(html).not.toContain("h-[0.5px] bg-border");
    // none of the sidebar row's own actions
    expect(html).not.toContain("Hide from sidebar");
    expect(html).not.toContain(">Archive<");
    expect(html).not.toContain("disabled");
  });

  it("each item runs its action and closes the menu", () => {
    const { props } = render();
    const found = buttons();
    found.get("edit-persona")!.props.onClick();
    expect(props.onEditPersona).toHaveBeenCalledWith(expect.objectContaining({ id: bot.id }));
    found.get("put-on-desktop")!.props.onClick();
    expect(fixture.toggled).toEqual([bot.id]);
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });

  it("keeps both items usable for a member on a bot they do not own", () => {
    fixture.state = { config: member };
    const { html } = render({ ...bot, ownerUserId: "pr_someone" } as Bot);
    expect(items(html)).toEqual(["edit-persona", "put-on-desktop"]);
    expect(html).not.toContain("disabled");
  });

  it("says it in French with the one editor label", () => {
    setLocale("fr");
    const { html } = render();
    expect(html).toContain(">Modifier le bot<");
    expect(html).not.toContain("Modifier le persona");
  });
});
