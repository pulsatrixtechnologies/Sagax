import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Bot, Group } from "@/state/store";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn(), api: vi.fn() }));
vi.mock("react-dom", () => ({ createPortal: (node: ReactNode) => node }));
vi.mock("./DesktopCapabilities", () => ({
  useDesktopCapabilities: () => ({ capabilities: { host: {} } }),
  useCaptionChrome: () => ({ padClass: "", dragStyle: {}, noDragStyle: {}, controlsShiftStyle: {} }),
  useMacInsetChrome: () => ({ macInset: false, browser: false }),
}));
vi.mock("@/state/store", async (importOriginal) => {
  const store = await importOriginal<typeof import("@/state/store")>();
  return { ...store, api: fixture.api, useStore: () => ({ state: store.initialState, dispatch: fixture.dispatch }) };
});

import { RoomSetupDialog, roomNeedsSetup } from "./GroupView";
import { GroupPanel } from "./GroupPanel";

const pepper = { id: "pepper", name: "Pepper", title: "", color: "blue", messages: [] } as unknown as Bot;
const indigo = { id: "indigo", name: "Indigo", title: "", color: "red", messages: [] } as unknown as Bot;
const pending = {
  id: "room", name: "Dumpling & co.", threadId: "room-thread", memberIds: ["pepper", "indigo"],
  defaultResponder: { kind: "member", botId: "pepper" }, bulletin: "", unread: false, createdAt: 0, messages: [],
  setupCompletedAt: null, setupSkippedAt: null,
} as unknown as Group;

type Props = { children?: ReactNode; onClick?: () => void; onSubmit?: (event: { preventDefault: () => void }) => void; type?: string; [key: string]: unknown };
function nodes(value: ReactNode): ReactElement<Props>[] {
  return Children.toArray(value).flatMap((child) => {
    if (!isValidElement<Props>(child)) return [];
    return [child, ...nodes(child.props.children)];
  });
}
const text = (node: ReactElement<Props>): string =>
  Children.toArray(node.props.children).map((child) => (typeof child === "string" ? child : isValidElement<Props>(child) ? text(child) : "")).join("");

function render(mode: "first" | "edit", group: Group = pending, onClose = vi.fn()) {
  let tree: ReactNode = null;
  function Capture() {
    tree = RoomSetupDialog({ group, members: [pepper, indigo], mode, onClose });
    return tree as ReactElement;
  }
  const html = renderToStaticMarkup(createElement(Capture));
  return { html, all: nodes(tree), onClose };
}
const button = (all: ReactElement<Props>[], label: string) => {
  const found = all.find((node) => node.type === "button" && text(node).trim() === label);
  if (!found) throw new Error(`no button ${label}`);
  return found;
};

beforeEach(() => {
  fixture.dispatch.mockClear();
  fixture.api.mockReset();
  vi.stubGlobal("window", { ogb: undefined });
  vi.stubGlobal("document", { body: {} });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("group setup modal", () => {
  it("is a labelled modal dialog with the setup fields, not a card in the chat", () => {
    const { html } = render("first");
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="room-setup-title"');
    expect(html).toContain('id="room-setup-title"');
    expect(html).toContain("Set up Dumpling &amp; co.");
    expect(html).toContain("Working folder");
    expect(html).toContain("Group instructions");
    expect(html).toContain("Skip for now");
    expect(html).toContain("Save &amp; continue");
    // a bottom sheet on narrow widths, centered from sm up
    expect(html).toMatch(/items-end[^"]*sm:items-center/);
  });

  it("Skip records the skip and closes, leaving the group usable", async () => {
    fixture.api.mockResolvedValue({ group: { ...pending, setupSkippedAt: 5 } });
    const { all, onClose } = render("first");
    button(all, "Skip for now").props.onClick!();
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(fixture.api).toHaveBeenCalledWith("/api/groups/room/setup", { method: "PATCH", body: JSON.stringify({ action: "skip" }) });
    const patched = fixture.dispatch.mock.calls[0]![0].group as Group;
    expect(roomNeedsSetup(patched)).toBe(false);
  });

  it("Save & continue completes the setup with the chosen fields and closes", async () => {
    fixture.api.mockResolvedValue({ group: { ...pending, setupCompletedAt: 5 } });
    const { all, onClose } = render("first");
    const form = all.find((node) => node.type === "form")!;
    form.props.onSubmit!({ preventDefault: () => {} });
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    const [url, init] = fixture.api.mock.calls[0]!;
    expect(url).toBe("/api/groups/room/setup");
    expect(JSON.parse(init.body)).toEqual({ action: "complete", cwd: null, defaultResponder: { kind: "member", botId: "pepper" }, bulletin: "" });
  });

  it("keeps the modal open with the error when saving fails", async () => {
    fixture.api.mockRejectedValue(new Error("room setup must be finished before the first message"));
    const { all, onClose } = render("first");
    button(all, "Skip for now").props.onClick!();
    await vi.waitFor(() => expect(fixture.api).toHaveBeenCalled());
    await Promise.resolve();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("reopened after setup, Cancel only closes and Save patches what changed", async () => {
    const done = { ...pending, setupCompletedAt: 1, bulletin: "Old" } as unknown as Group;
    const cancel = render("edit", done);
    expect(cancel.html).toContain(">Cancel<");
    expect(cancel.html).not.toContain("Skip for now");
    button(cancel.all, "Cancel").props.onClick!();
    expect(cancel.onClose).toHaveBeenCalled();
    expect(fixture.api).not.toHaveBeenCalled();

    // nothing changed: Save closes without a request
    const same = render("edit", done);
    same.all.find((node) => node.type === "form")!.props.onSubmit!({ preventDefault: () => {} });
    await vi.waitFor(() => expect(same.onClose).toHaveBeenCalled());
    expect(fixture.api).not.toHaveBeenCalled();
  });
});

describe("roomNeedsSetup", () => {
  it("is pending only for a new group without a completed or skipped marker", () => {
    expect(roomNeedsSetup(pending)).toBe(true);
    expect(roomNeedsSetup({ ...pending, setupSkippedAt: 1 } as Group)).toBe(false);
    expect(roomNeedsSetup({ ...pending, setupCompletedAt: 1 } as Group)).toBe(false);
    const legacy = { ...pending } as Record<string, unknown>;
    delete legacy.setupCompletedAt;
    delete legacy.setupSkippedAt;
    expect(roomNeedsSetup(legacy as unknown as Group)).toBe(false);
  });
});

describe("group panel", () => {
  it("uses the bot panel shell: docked dialog, avatar, name, tab strip", () => {
    const html = renderToStaticMarkup(createElement(GroupPanel, {
      group: { ...pending, setupCompletedAt: 1 } as unknown as Group,
      members: [pepper, indigo],
      canEdit: true,
      onOpenSetup: vi.fn(),
      details: createElement("p", null, "members here"),
    }));
    expect(html).toContain("app-docked-panel");
    expect(html).toContain('aria-labelledby="group-panel-title"');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Group panel"');
    for (const tab of ["Details", "Instructions", "Advanced"]) expect(html).toContain(`>${tab}</button>`);
    expect(html).toContain("2 bots");
    expect(html).toContain('value="Dumpling &amp; co."');
    expect(html).toContain("members here");
  });
});
