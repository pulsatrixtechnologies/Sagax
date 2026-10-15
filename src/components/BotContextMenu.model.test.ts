// The sidebar's bot menu follows Grok Bot's (JC, 2026-10-15): New thread |
// Pin, Move to ›,
// Mark as Unread | Rename, Edit bot | Copy conversation ID | Hide from
// sidebar, Archive, Delete | More › with the rare ones one step down.
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState, Bot } from "@/state/store";
import { setLocale } from "@/lib/i18n";
import { setAdvancedMode } from "@/lib/interface-mode";

const fixture = vi.hoisted(() => ({
  portal: null as ReactNode,
  state: {} as Partial<AppState>,
  toggled: [] as string[],
  models: [] as string[],
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
vi.mock("@/lib/model-window", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/model-window")>()),
  openModelWindow: (id: string) => { fixture.models.push(id); },
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
  onArchive: vi.fn(),
  onDelete: vi.fn(),
});

function render(page: "main" | "more" = "main", target: Bot = bot, props = handlers()) {
  fixture.state = { bots: [target, { ...bot, id: "other", name: "Other" } as Bot], ...fixture.state };
  const html = renderToStaticMarkup(createElement(BotContextMenu, { variant: "sidebar", initialPage: page, menu: { botId: target.id, x: 10, y: 10 }, ...props }));
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


beforeEach(() => {
  setLocale("en");
  fixture.state = {};
  fixture.toggled = [];
  fixture.models = [];
  fixture.portal = null;
  vi.stubGlobal("document", { body: {}, activeElement: null });
  vi.stubGlobal("window", { innerWidth: 1000, innerHeight: 800, addEventListener() {}, removeEventListener() {} });
});
afterEach(() => vi.unstubAllGlobals());

describe("the sidebar's bot menu", () => {
  it("lists the everyday items at the first level in Grok Bot's order", () => {
    const { html } = render();
    expect(items(html)).toEqual(["new-thread", "pin", "move", "mark-unread", "rename", "edit", "copy-id", "hide", "archive", "delete", "more"]);
    for (const label of [">New thread<", ">Pin<", ">Move to<", ">Mark as Unread<", ">Rename the bot<", ">Edit bot<", ">Copy conversation ID<", ">Hide from sidebar<", ">More<", ">Archive<"]) expect(html).toContain(label);
    expect(html).not.toContain("Rename Bot");
    expect(html).not.toContain("Model…");
  });

  it("offers Move to in Simple and Advanced mode alike", () => {
    expect(items(render().html)).toContain("move");
    setAdvancedMode(true);
    try {
      expect(items(render().html)).toContain("move");
    } finally {
      setAdvancedMode(false);
    }
  });

  it("keeps Delete in red, after Hide and Archive, and asks before deleting", () => {
    const { html, props } = render();
    expect(html).toMatch(/data-menu-item="delete"[^>]*class="[^"]*text-danger/);
    // Delete is its own component (BotDeleteMenuItem), keyed "delete".
    const nodes = fixture.portal as ReactElement<{ children: ReactNode[] }>;
    const flat = (nodes.props.children as ReactNode[]).flat() as ReactElement<{ onClick: () => void }>[];
    flat.find((node) => isValidElement(node) && node.key === "delete")!.props.onClick();
    expect(props.onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: bot.id }));
  });

  it("opens More without closing, and Edit bot opens the bot editor", () => {
    const { props } = render();
    const found = buttons();
    found.get("more")!.props.onClick();
    expect(props.onClose).not.toHaveBeenCalled();
    found.get("edit")!.props.onClick();
    expect(props.onEditPersona).toHaveBeenCalledWith(expect.objectContaining({ id: bot.id }));
    found.get("rename")!.props.onClick();
    expect(props.onRename).toHaveBeenCalledWith(bot.id);
  });

  it("puts the rare actions under More", () => {
    const { html } = render("more");
    expect(items(html)).toEqual(["back", "put-on-desktop", "model", "mark-all-read"]);
    // No second Move to, Mark as Unread or Hide under More.
    expect(html).not.toContain('data-menu-item="move"');
    expect(html).toContain('data-bot-menu-page="more"');
    expect(html).toContain(">Mark all conversations as read<");
  });

  it("offers Model… under More and opens the model window on that bot", () => {
    const { html, props } = render("more");
    expect(items(html)).toContain("model");
    expect(html).toContain(">Model…<");
    buttons().get("model")!.props.onClick();
    expect(fixture.models).toEqual([bot.id]);
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("says it in French, bot and not robot", () => {
    setLocale("fr");
    const main = render().html;
    expect(main).toContain(">Modifier le bot<");
    expect(main).toContain(">Épingler<");
    expect(main).toContain(">Plus<");
    expect(main).toContain(">Déplacer vers<");
    expect(main).toContain(">Marquer comme non lu<");
    const more = render("more").html;
    expect(more).toContain(">Modèle…<");
    expect(more).toContain(">Tout marquer comme lu<");
    expect(more).not.toContain("robot");
  });
});
