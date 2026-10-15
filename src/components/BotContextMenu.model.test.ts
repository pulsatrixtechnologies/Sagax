// The sidebar's bot menu (JC, 2026-10-14): five everyday items at the first
// level (Pin, Rename, Edit bot, More ›, Archive); the rare ones one step
// down under More.
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
  it("keeps five items at the first level", () => {
    const { html } = render();
    expect(items(html)).toEqual(["pin", "rename", "edit", "more", "archive"]);
    for (const label of [">Pin<", ">Rename the bot<", ">Edit bot<", ">More<", ">Archive<"]) expect(html).toContain(label);
    expect(html).not.toContain("Rename Bot");
    expect(html).not.toContain("Model…");
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
    expect(items(html)).toEqual(["back", "put-on-desktop", "model", "mark-unread", "mark-all-read", "hide"]);
    expect(html).toContain('data-bot-menu-page="more"');
    expect(html).toContain(">Mark all conversations as read<");
  });

  it("offers Copy conversation ID in Advanced mode only", () => {
    expect(items(render("more").html)).not.toContain("copy-id");
    setAdvancedMode(true);
    try {
      expect(items(render("more").html)).toContain("copy-id");
    } finally {
      setAdvancedMode(false);
    }
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
    const more = render("more").html;
    expect(more).toContain(">Modèle…<");
    expect(more).toContain(">Tout marquer comme lu<");
    expect(more).not.toContain("robot");
  });
});
