import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Group } from "@/state/store";
import { t } from "@/lib/i18n";
import { DEFAULT_SIDEBAR_HIDDEN, hiddenKey, readSidebarHidden, writeSidebarHidden } from "@/lib/sidebar-hidden";

// A person row (people-DM) gets the actions a member already has elsewhere:
// the profile, the conversation id, hide, unpin while pinned, the section
// submenu and mark unread. Not rename, delete or force-stop.
const fixture = vi.hoisted(() => ({
  portal: null as ReactElement | null,
  dispatch: vi.fn(),
  groups: [] as Group[],
  bots: [] as Bot[],
  config: { viewer: { principalId: "pr_me" } } as { viewer: { principalId: string } },
}));
vi.mock("react", async (importOriginal) => {
  const original = await importOriginal<typeof import("react")>();
  return { ...original, useLayoutEffect: () => {} };
});
vi.mock("react-dom", async (importOriginal) => {
  const original = await importOriginal<typeof import("react-dom")>();
  return {
    ...original,
    createPortal: (node: ReactNode) => {
      fixture.portal = node as ReactElement;
      return node;
    },
  };
});
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    useStore: () => ({
      state: { ...original.initialState, bots: fixture.bots, groups: fixture.groups, config: fixture.config },
      dispatch: fixture.dispatch,
    }),
  };
});

const { BotContextMenu, RoomContextMenu, memberMenuItems } = await import("./Sidebar");

const baseGroup = {
  memberIds: [] as string[],
  defaultResponder: { kind: "mentions" as const },
  bulletin: "",
  unread: false,
  createdAt: 1,
  messages: [] as Group["messages"],
};

function personRow(pinned = false): Group {
  return {
    ...baseGroup,
    id: "dm-zach",
    threadId: "thread-zach",
    name: "Zachary Sellam",
    humanIds: ["pr_me", "pr_zach"],
    peopleDm: true,
    ...(pinned ? { pinned: true } : {}),
  };
}

function room(): Group {
  return {
    ...baseGroup,
    id: "ops",
    threadId: "thread-ops",
    name: "Ops",
    humanIds: ["pr_me"],
    memberIds: ["bot-1"],
  };
}

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

const textOf = (element: ReactElement<Record<string, unknown>>): string =>
  Children.toArray(element.props.children as ReactNode).map((child) => (
    typeof child === "string" ? child : isValidElement<Record<string, unknown>>(child) ? textOf(child) : ""
  )).join("");

function labelsOf(node: ReactNode): string[] {
  return elements(node).filter((element) => element.type === "button").map((element) => textOf(element).trim()).filter(Boolean);
}

function openRoom(group: Group) {
  fixture.groups = [group];
  fixture.portal = null;
  const onClose = vi.fn();
  const onMoveToSection = vi.fn();
  const onDelete = vi.fn();
  const html = renderToStaticMarkup(createElement(RoomContextMenu, {
    menu: { groupId: group.id, x: 20, y: 30 },
    onClose,
    onMoveToSection,
    onDelete,
  }));
  const buttons = elements(fixture.portal).filter((element) => element.type === "button");
  return { html, labels: labelsOf(fixture.portal), buttons, onClose, onMoveToSection, onDelete };
}

const click = (buttons: ReactElement<Record<string, unknown>>[], label: string) => {
  const button = buttons.find((element) => textOf(element).includes(label));
  if (!button) throw new Error(`no button ${label}`);
  (button.props.onClick as (event?: { preventDefault: () => void; stopPropagation: () => void }) => void)({
    preventDefault: () => {},
    stopPropagation: () => {},
  });
};

beforeEach(() => {
  fixture.portal = null;
  fixture.dispatch = vi.fn();
  fixture.groups = [];
  fixture.bots = [];
  fixture.config = { viewer: { principalId: "pr_me" } };
  const map = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  });
  writeSidebarHidden(DEFAULT_SIDEBAR_HIDDEN);
  vi.stubGlobal("document", { body: {}, documentElement: {} });
  vi.stubGlobal("window", {
    innerWidth: 1000,
    innerHeight: 800,
    addEventListener: () => {},
    removeEventListener: () => {},
    matchMedia: () => ({ matches: true }),
  });
  vi.stubGlobal("navigator", { language: "en", clipboard: { writeText: vi.fn() } });
});
afterEach(() => vi.unstubAllGlobals());

describe("memberMenuItems", () => {
  it("lists the person actions and adds Unpin only while the row is pinned", () => {
    expect(memberMenuItems({ peer: true, pinned: false })).toEqual([
      "viewProfile",
      "copyConversationId",
      "hide",
      "moveTo",
      "markUnread",
    ]);
    expect(memberMenuItems({ peer: true, pinned: true })).toEqual([
      "viewProfile",
      "copyConversationId",
      "hide",
      "unpin",
      "moveTo",
      "markUnread",
    ]);
    expect(memberMenuItems({ peer: false, pinned: true })).not.toContain("viewProfile");
  });
});

/** "Move to" lives inside MoveToSectionItem, so the static button walk
 * never sees it. The rendered markup does, in this order. */
function expectMenuOrder(html: string, labels: string[]) {
  let at = -1;
  for (const label of labels) {
    const next = html.indexOf(label, at + 1);
    expect(next, label).toBeGreaterThan(at);
    at = next;
  }
}

describe("person row menu", () => {
  const personLabels = (pinned: boolean) => [
    t("personPanel.view"),
    t("sidebar.copyConversationId"),
    t("sidebar.hidden.hide"),
    ...(pinned ? [t("sidebar.bot.unpin")] : []),
    "Move to",
    t("sidebar.bot.markUnread"),
  ];

  it("shows the member actions and not rename, delete or force-stop", () => {
    const open = openRoom(personRow(false));
    expect(open.html).toContain("data-member-menu");
    expectMenuOrder(open.html, personLabels(false));
    expect(open.html).toContain('aria-haspopup="menu"');
    expect(open.html).not.toContain(t("sidebar.room.renameChannel"));
    expect(open.html).not.toContain(t("sidebar.room.deleteChannel"));
    expect(open.html).not.toContain(t("sidebar.section.moveToContext"));
    expect(open.html).not.toContain("Force stop");

    const pinned = openRoom(personRow(true));
    expectMenuOrder(pinned.html, personLabels(true));
    expect(pinned.html).toContain('aria-haspopup="menu"');
  });

  it("opens the profile, copies the people-DM thread, hides the person, unpins and marks unread", () => {
    const open = openRoom(personRow(true));
    click(open.buttons, t("personPanel.view"));
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "openPersonPanel", personId: "pr_zach" });

    click(open.buttons, t("sidebar.copyConversationId"));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("thread-zach");

    click(open.buttons, t("sidebar.hidden.hide"));
    expect(readSidebarHidden().items).toEqual([expect.objectContaining({ kind: "person", id: "pr_zach" })]);
    expect(hiddenKey("person", "pr_zach")).toBe("person:pr_zach");

    click(open.buttons, t("sidebar.bot.unpin"));
    expect(fixture.dispatch).toHaveBeenCalledWith({
      type: "patchGroup",
      groupId: "dm-zach",
      patch: { pinned: false },
    });

    click(open.buttons, t("sidebar.bot.markUnread"));
    expect(fixture.dispatch).toHaveBeenCalledWith({
      type: "patchGroup",
      groupId: "dm-zach",
      patch: { unread: true },
    });
    expect(open.onDelete).not.toHaveBeenCalled();
    expect(open.onMoveToSection).not.toHaveBeenCalled();
    expect(open.onClose).toHaveBeenCalled();
  });

  it("leaves a room menu and a bot menu as they were", () => {
    const open = openRoom(room());
    expect(open.html).not.toContain("data-member-menu");
    expect(open.labels).not.toContain(t("personPanel.view"));
    expect(open.labels).not.toContain(t("sidebar.bot.markUnread"));
    expect(open.labels).not.toContain(t("sidebar.bot.unpin"));
    expect(open.labels).toContain(t("sidebar.section.moveToContext"));
    expect(open.labels).toContain(t("sidebar.room.renameChannel"));

    fixture.bots = [{
      id: "ara",
      threadId: "thread-ara",
      name: "Ara",
      title: "",
      description: "",
      notifications: true,
      color: "green",
      unread: false,
      pinned: true,
      messages: [],
      modelSelection: { instanceId: "test", model: "test" },
    }];
    fixture.portal = null;
    const html = renderToStaticMarkup(createElement(BotContextMenu, {
      menu: { botId: "ara", x: 10, y: 10 },
      onClose: vi.fn(),
      onArchive: vi.fn(),
      onDelete: vi.fn(),
      onMoveToSection: vi.fn(),
      onRename: vi.fn(),
    }));
    const labels = labelsOf(fixture.portal);
    expect(html).not.toContain("data-member-menu");
    expect(labels).toContain(t("sidebar.bot.unpin"));
    expect(html).toContain(">Move to<");
    expect(html).toContain('aria-haspopup="menu"');
    expect(labels).toContain(t("sidebar.bot.markUnread"));
    expect(labels).toContain("Rename Bot");
    expect(labels).not.toContain(t("personPanel.view"));
  });

  it("hides rename, archive, delete and a server section move from a member who does not own the bot", () => {
    fixture.config = { viewer: { principalId: "pr_me", role: "member", operator: false } } as typeof fixture.config;
    fixture.bots = [{
      id: "ara",
      threadId: "thread-ara",
      name: "Ara",
      title: "",
      description: "",
      notifications: true,
      color: "green",
      unread: false,
      pinned: true,
      ownerUserId: "pr_owner",
      messages: [],
      modelSelection: { instanceId: "test", model: "test" },
    }];
    fixture.portal = null;
    const html = renderToStaticMarkup(createElement(BotContextMenu, {
      menu: { botId: "ara", x: 10, y: 10 },
      onClose: vi.fn(),
      onArchive: vi.fn(),
      onDelete: vi.fn(),
      onMoveToSection: vi.fn(),
      onRename: vi.fn(),
    }));
    const labels = labelsOf(fixture.portal);
    expect(labels).not.toContain("Rename Bot");
    expect(html).not.toContain(t("sidebar.bot.archive"));
    expect(html).not.toContain(t("common.delete"));
    expect(html).not.toContain(">Move to<");
    expect(labels).toContain(t("sidebar.hidden.hide"));
    expect(labels).toContain(t("sidebar.bot.unpin"));
  });
});
