// The one thread menu (JC, 2026-10-14): the sidebar's thread rows and the
// header's All threads picker share it. Five items at the first level
// (Rename, Pin, Archive, Snooze ›, More ›); the rare actions under More.
import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { ThreadMenuItems, type ThreadMenuActions, type ThreadMenuPage } from "./ThreadMenu";
import { pickerRowActions } from "./TaskPicker";

afterEach(() => setLocale("en"));

const task = { threadId: "t1", title: "Weekly report" };
const folders = [{ id: "work", name: "Research" }, { id: "home", name: "Home", emoji: "🏠" }];

const allActions = (): ThreadMenuActions & Record<string, ReturnType<typeof vi.fn>> => ({
  onRename: vi.fn(), onDelete: vi.fn(), onPin: vi.fn(), onArchive: vi.fn(), onSnooze: vi.fn(), onMove: vi.fn(),
  onCopyLink: vi.fn(), onRegenerateTitle: vi.fn(), onRemoveLink: vi.fn(), onRefreshPermissions: vi.fn(),
});

type Props = Parameters<typeof ThreadMenuItems>[0];
const props = (over: Partial<Props> = {}): Props => ({
  task, actions: allActions(), folders, page: "main", onPage: vi.fn(), onClose: vi.fn(),
  regenerating: false, onRegenerate: vi.fn(), advanced: true, ...over,
});
const markup = (over: Partial<Props> = {}) => renderToStaticMarkup(createElement(ThreadMenuItems, props(over)));
const ids = (html: string) => [...html.matchAll(/data-thread-menu-item="([\w-]+)"/g)].map((match) => match[1]);

/** The page's items as React elements, by their id (the Item component's
 * props, or a plain button's data attribute). */
function items(given: Props): Map<string, { onClick: () => void; disabled?: boolean }> {
  const found = new Map<string, { onClick: () => void; disabled?: boolean }>();
  const walk = (node: ReactNode) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!isValidElement(node)) return;
    const element = node.props as { id?: string; "data-thread-menu-item"?: string; onClick?: () => void; disabled?: boolean; children?: ReactNode };
    const id = element["data-thread-menu-item"] ?? (typeof node.type === "function" ? element.id : undefined);
    if (id && element.onClick) found.set(id, { onClick: element.onClick, disabled: element.disabled });
    walk(element.children);
  };
  walk(ThreadMenuItems(given));
  return found;
}

describe("the thread menu", () => {
  it("keeps five items at the first level: Rename, Pin, Archive, Snooze and More", () => {
    expect(ids(markup())).toEqual(["rename", "pin", "archive", "snooze", "more"]);
    const html = markup();
    for (const label of ["Rename thread", "Pin", "Archive", "Snooze", "More"]) expect(html).toContain(label);
    // nothing about another thread or a new one
    expect(html).not.toContain("New thread");
    expect(html).not.toContain("New folder");
  });

  it("drops what the owner does not offer", () => {
    const given = props({ actions: { onRename: vi.fn(), onDelete: vi.fn() } });
    expect(ids(renderToStaticMarkup(createElement(ThreadMenuItems, given)))).toEqual(["rename", "more"]);
  });

  it("puts the rare actions under More, Delete last", () => {
    const html = markup({ page: "more", task: { ...task, link: "https://example.com/pr/1" } });
    expect(ids(html)).toEqual(["back", "move", "copy-link", "regenerate", "remove-link", "refresh-permissions", "delete"]);
  });

  it("keeps Refresh permissions for Advanced mode", () => {
    expect(ids(markup({ page: "more", advanced: false }))).not.toContain("refresh-permissions");
  });

  it("offers Remove link only on a linked thread", () => {
    expect(ids(markup({ page: "more" }))).not.toContain("remove-link");
  });

  it("snoozes in one step down, and offers the way back for a snoozed thread", () => {
    expect(ids(markup({ page: "snooze" }))).toEqual(["back", "snooze-activity", "snooze-tonight", "snooze-tomorrow"]);
    expect(ids(markup({ page: "snooze", task: { ...task, snoozedUntil: 0 } }))).toEqual(["back", "stop-snooze", "snooze-activity", "snooze-tonight", "snooze-tomorrow"]);
    const given = props({ page: "snooze" });
    items(given).get("snooze-activity")!.onClick();
    expect(given.actions.onSnooze).toHaveBeenCalledWith(0);
    expect(given.onClose).toHaveBeenCalledOnce();
  });

  it("moves into a folder from a real list, with the current one checked", () => {
    const html = markup({ page: "move", task: { ...task, projectId: "work" } });
    expect(ids(html)).toEqual(["back", "folder-work", "folder-home", "folder-none"]);
    expect(html).not.toContain("<select");
    const given = props({ page: "move", task: { ...task, projectId: "work" } });
    items(given).get("folder-home")!.onClick();
    expect(given.actions.onMove).toHaveBeenCalledWith("home");
    items(given).get("folder-none")!.onClick();
    expect(given.actions.onMove).toHaveBeenLastCalledWith(null);
  });

  it("opens a page without closing, and runs an action then closes", () => {
    const given = props();
    const found = items(given);
    found.get("more")!.onClick();
    expect(given.onPage).toHaveBeenCalledWith("more" satisfies ThreadMenuPage);
    expect(given.onClose).not.toHaveBeenCalled();
    found.get("archive")!.onClick();
    expect(given.actions.onArchive).toHaveBeenCalledWith(expect.any(Number));
    expect(given.onClose).toHaveBeenCalledOnce();
  });

  it("offers Unarchive for an archived thread and greys the busy actions while it works", () => {
    expect(markup({ task: { ...task, archivedAt: 0 } })).toContain("Unarchive");
    const busy = props({ page: "more", task: { ...task, activity: "working" } });
    expect(items(busy).get("delete")!.disabled).toBe(true);
    expect(items(busy).get("refresh-permissions")!.disabled).toBe(true);
  });

  it("shows Regenerating… while the title request runs", () => {
    const html = markup({ page: "more", regenerating: true });
    expect(html).toContain("Regenerating…");
    expect(html).toContain('aria-busy="true"');
  });

  it("says it in French", () => {
    setLocale("fr");
    const html = markup();
    expect(html).toContain("Renommer le fil");
    expect(html).toContain("Plus");
    expect(markup({ page: "more", task: { ...task, link: "https://example.com" } })).toContain("Retirer le lien");
  });
});

describe("the All threads picker's row menu", () => {
  it("is the same menu: the picker's callbacks become the thread's actions", () => {
    const onDelete = vi.fn();
    const onPin = vi.fn();
    const onMove = vi.fn();
    const threadActions = { onCopyLink: vi.fn(), onArchive: vi.fn(), onSnooze: vi.fn(), onRefreshPermissions: vi.fn() };
    const actions = pickerRowActions(task, { onRename: vi.fn(), onDelete, onPin, onMove, threadActions });
    actions.onDelete();
    actions.onPin!(true);
    actions.onMove!("work");
    actions.onArchive!(5);
    actions.onSnooze!(0);
    actions.onCopyLink!();
    expect(onDelete).toHaveBeenCalledWith("t1");
    expect(onPin).toHaveBeenCalledWith("t1", true);
    expect(onMove).toHaveBeenCalledWith("t1", "work");
    expect(threadActions.onArchive).toHaveBeenCalledWith("t1", 5);
    expect(threadActions.onSnooze).toHaveBeenCalledWith("t1", 0);
    expect(threadActions.onCopyLink).toHaveBeenCalledWith("t1");
    expect(actions.onRegenerateTitle).toBeUndefined();
    expect(ids(renderToStaticMarkup(createElement(ThreadMenuItems, props({ actions }))))).toEqual(["rename", "pin", "archive", "snooze", "more"]);
  });
});
