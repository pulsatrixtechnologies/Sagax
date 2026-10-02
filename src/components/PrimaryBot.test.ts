import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";

// The Primary Bot (formerly Chief of Staff) in the app: the orange star on
// its avatar, the sidebar menu actions and the "Choose a primary Bot" modal.
const fixture = vi.hoisted(() => ({
  portal: null as ReactElement | null,
  bots: [] as unknown[],
}));
vi.mock("react", async (importOriginal) => {
  const original = await importOriginal<typeof import("react")>();
  return { ...original, useLayoutEffect: () => {} };
});
vi.mock("react-dom", async (importOriginal) => {
  const original = await importOriginal<typeof import("react-dom")>();
  return { ...original, createPortal: (node: ReactNode) => {
    fixture.portal = node as ReactElement;
    return node;
  } };
});
vi.mock("./DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({}) }));
vi.mock("@/lib/thread-preferences", () => ({ useShowThreads: () => false }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: { ...original.initialState, bots: fixture.bots }, dispatch: vi.fn() }) };
});

const { BotAvatar } = await import("./Avatar");
const { BotContextMenu } = await import("./Sidebar");
const { PrimaryBotPickerCard } = await import("./PrimaryBotPicker");

const base = { threadId: "thread", title: "", description: "", notifications: true, unread: false, messages: [], modelSelection: { instanceId: "test", model: "test" } };
const cryptic: Bot = { ...base, id: "cryptic", name: "Cryptic", color: "green", chiefOfStaff: true };
const atlas: Bot = { ...base, id: "atlas", name: "Atlas", color: "blue" };
const zed: Bot = { ...base, id: "zed", name: "Zed", color: "pink" };
const shared: Bot = { ...base, id: "shared", name: "Shared", color: "blue", ownerUserId: "someone-else" };

beforeEach(() => {
  fixture.portal = null;
  fixture.bots = [cryptic, atlas, zed, shared];
  vi.stubGlobal("document", { body: {} });
  vi.stubGlobal("window", { innerWidth: 1_000, innerHeight: 800, addEventListener: () => {}, removeEventListener: () => {} });
});
afterEach(() => vi.unstubAllGlobals());

/** Every element in a rendered tree, components left unexpanded. */
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  const out: ReactElement<Record<string, unknown>>[] = [];
  const walk = (value: ReactNode) => Children.forEach(value, (child) => {
    if (Array.isArray(child)) return walk(child);
    if (!isValidElement<Record<string, unknown>>(child)) return;
    out.push(child);
    walk(child.props.children as ReactNode);
  });
  walk(node);
  return out;
}
const text = (element: ReactElement<Record<string, unknown>>): string =>
  Children.toArray(element.props.children as ReactNode).map((child) => (typeof child === "string" ? child : isValidElement<Record<string, unknown>>(child) ? text(child) : "")).join("");

function menuFor(bot: Bot, handlers = { onMakePrimary: vi.fn(), onReplacePrimary: vi.fn() }) {
  const html = renderToStaticMarkup(createElement(BotContextMenu, {
    menu: { botId: bot.id, x: 10, y: 10 }, onClose: vi.fn(), onArchive: vi.fn(), onDelete: vi.fn(),
    onMoveToSection: vi.fn(), onNewFolder: vi.fn(), onRename: vi.fn(), ...handlers,
  }));
  return { html, handlers, buttons: elements(fixture.portal).filter((element) => element.type === "button") };
}

describe("Primary Bot badge", () => {
  it("draws the orange star at the avatar's corner only when asked", () => {
    const marked = renderToStaticMarkup(createElement(BotAvatar, { bot: cryptic, size: 32, animated: false, primary: true }));
    expect(marked).toContain('data-testid="primary-bot-badge"');
    expect(marked).toContain("bg-orange-500");
    expect(marked).toContain("text-white");
    expect(marked).toContain('aria-label="Primary Bot"');
    expect(renderToStaticMarkup(createElement(BotAvatar, { bot: cryptic, size: 32, animated: false }))).not.toContain("primary-bot-badge");
  });
});

describe("sidebar menu of a bot", () => {
  it("offers Replace with different Bot on the viewer's Primary Bot", () => {
    const { html, handlers, buttons } = menuFor(cryptic);
    expect(html).toContain("Replace with different Bot");
    expect(html).not.toContain("Make primary bot");
    (buttons.find((button) => text(button).includes("Replace with different Bot"))!.props.onClick as () => void)();
    expect(handlers.onReplacePrimary).toHaveBeenCalledWith(cryptic);
  });

  it("offers Make primary bot on the viewer's other bots", () => {
    const { html, handlers, buttons } = menuFor(atlas);
    expect(html).toContain("Make primary bot");
    expect(html).not.toContain("Replace with different Bot");
    (buttons.find((button) => text(button).includes("Make primary bot"))!.props.onClick as () => void)();
    expect(handlers.onMakePrimary).toHaveBeenCalledWith(atlas);
  });

  it("offers neither on someone else's bot shared with the viewer", () => {
    const { html } = menuFor(shared);
    expect(html).not.toContain("Make primary bot");
    expect(html).not.toContain("Replace with different Bot");
  });
});

describe("Choose a primary Bot", () => {
  const card = (selected: string | null, query = "", onConfirm = vi.fn(), onSelect = vi.fn()) => {
    const element = PrimaryBotPickerCard({ bots: fixture.bots as Bot[], viewerId: "pr_me", currentId: cryptic.id, query, onQuery: vi.fn(), selected, onSelect, onCancel: vi.fn(), onConfirm });
    return { html: renderToStaticMarkup(element), all: elements(element), onConfirm, onSelect };
  };

  it("lists the person's own bots without the current one, with search, Cancel and Confirm", () => {
    const { html, all } = card(null);
    expect(html).toContain("Choose a primary Bot");
    expect(html).toContain('placeholder="Search"');
    const options = all.filter((element) => element.props.role === "option").map((element) => element.props["data-bot-id"]);
    expect(options).toEqual(["atlas", "zed"]);
    expect(html).toContain(">Cancel</button>");
    const confirm = all.find((element) => element.type === "button" && text(element) === "Confirm")!;
    expect(confirm.props.disabled).toBe(true);
  });

  it("filters by the search and says when nothing matches", () => {
    expect(card(null, "ze").all.filter((element) => element.props.role === "option").map((element) => element.props["data-bot-id"])).toEqual(["zed"]);
    expect(card(null, "nobody").html).toContain("No bot matches this search.");
  });

  it("enables Confirm once a different bot is chosen and confirms that bot", () => {
    const picked = card(null);
    (picked.all.find((element) => element.props["data-bot-id"] === "zed")!.props.onClick as () => void)();
    expect(picked.onSelect).toHaveBeenCalledWith("zed");
    const chosen = card("zed");
    const confirm = chosen.all.find((element) => element.type === "button" && text(element) === "Confirm")!;
    expect(confirm.props.disabled).toBe(false);
    (confirm.props.onClick as () => void)();
    expect(chosen.onConfirm).toHaveBeenCalledWith("zed");
    // The current Primary Bot can never be confirmed again.
    expect(card("cryptic").all.find((element) => element.type === "button" && text(element) === "Confirm")!.props.disabled).toBe(true);
  });
});
