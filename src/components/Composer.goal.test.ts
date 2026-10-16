// @vitest-environment happy-dom
// JC, 2026-10-14: one entry for a room's goal mode. /goal starts it; the
// chip shows only while it is on, says so, and turns it off.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Group } from "@/state/store";
import { restoreComposerDraft } from "@/lib/drafts";
import { setLocale } from "@/lib/i18n";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn(), group: undefined as unknown }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({
    state: { ...original.initialState, bots: [bot], groups: [(fixture.group as Group | undefined) ?? group], instances: [] },
    dispatch: fixture.dispatch,
  }) };
});
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => false }));
vi.mock("./CallView", () => ({ CallButton: () => null }));
vi.mock("./GroupCallView", () => ({ GroupCallButton: () => null }));
vi.mock("./ModelPicker", () => ({ ModelPicker: () => null }));

import { Composer } from "./Composer";

const bot: Bot = {
  id: "goal-bot", threadId: "goal-bot-thread", name: "Atlas", title: "", description: "",
  color: "blue", notifications: false, unread: false, busy: false, messages: [],
  modelSelection: { instanceId: "fake", model: "fake" },
};
const group: Group = {
  id: "room", threadId: "room-thread", name: "Room", memberIds: [bot.id], defaultResponder: "auto",
  bulletin: "", unread: false, createdAt: 1, messages: [],
} as unknown as Group;
const draftId = `group:${group.id}:${group.threadId}`;

describe("the goal chip in a room's composer", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    setLocale("en");
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    flushSync(() => root.unmount());
    container.remove();
    restoreComposerDraft(draftId, { text: "", attachments: [] });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const render = () => flushSync(() => root.render(createElement(Composer, { group, members: [bot] })));
  const chip = () => container.querySelector<HTMLButtonElement>("[data-composer-goal]");

  it("is absent while the room is in chat mode", () => {
    restoreComposerDraft(draftId, { text: "", attachments: [], channelMode: "chat" });
    render();
    expect(chip()).toBeNull();
  });

  it("shows /goal while the mode is on, and turns it off", () => {
    restoreComposerDraft(draftId, { text: "", attachments: [], channelMode: "goal" });
    render();
    expect(chip()!.textContent).toBe("/goal");
    expect(chip()!.getAttribute("aria-pressed")).toBe("true");
    flushSync(() => chip()!.click());
    expect(chip()).toBeNull();
  });

  const runningRoom = (status: string) => ({
    ...group,
    messages: [{
      id: "run-card", role: "bot", kind: "goal.run",
      goalRun: { runId: "r1", goal: "ship the release", status, coordinatorBotId: bot.id, coordinatorName: "Atlas", turnCount: 1, maxTurns: 8, startedAt: 1 },
    }],
  }) as unknown as Group;
  const renderRoom = (room: Group) => flushSync(() => root.render(createElement(Composer, { group: room, members: [bot] })));
  const textarea = () => container.querySelector("textarea")!;
  const type = (value: string) => {
    const input = textarea();
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    flushSync(() => {
      setter.call(input, value);
      input.setSelectionRange(value.length, value.length);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const option = (label: string) => [...container.querySelectorAll<HTMLElement>('[role="option"]')]
    .find((row) => row.textContent?.includes(label));

  it("turns goal mode on and off from the + menu's modes", () => {
    restoreComposerDraft(draftId, { text: "", attachments: [], channelMode: "chat" });
    render();
    flushSync(() => container.querySelector<HTMLButtonElement>("[data-composer-plus]")!.click());
    const row = container.querySelector<HTMLButtonElement>('[data-composer-plus-item="goal"]')!;
    expect(row.getAttribute("role")).toBe("menuitemcheckbox");
    expect(row.getAttribute("aria-checked")).toBe("false");
    expect(row.dataset.composerPlusGroup).toBe("modes");
    flushSync(() => row.click());
    expect(chip()).not.toBeNull();
    flushSync(() => container.querySelector<HTMLButtonElement>("[data-composer-plus]")!.click());
    const on = container.querySelector<HTMLButtonElement>('[data-composer-plus-item="goal"]')!;
    expect(on.getAttribute("aria-checked")).toBe("true");
    flushSync(() => on.click());
    expect(chip()).toBeNull();
  });

  it("lists /goal's subcommands under Goal, dimmed when there is nothing to act on", () => {
    fixture.group = undefined;
    restoreComposerDraft(draftId, { text: "", attachments: [], channelMode: "chat" });
    render();
    type("/goal ");
    for (const label of ["/goal status", "/goal pause", "/goal resume", "/goal stop"]) {
      expect(option(label)?.getAttribute("aria-disabled")).toBe("true");
    }
    expect(container.textContent).toContain("No goal in this conversation yet");
  });

  it("stops a running goal from /goal stop in the menu", () => {
    const room = runningRoom("working");
    fixture.group = room;
    fixture.dispatch.mockClear();
    restoreComposerDraft(draftId, { text: "", attachments: [], channelMode: "chat" });
    renderRoom(room);
    type("/goal st");
    expect(option("/goal stop")?.getAttribute("aria-disabled")).toBeNull();
    flushSync(() => option("/goal stop")!.click());
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "interruptGroup", groupId: room.id, threadId: room.threadId });
    expect(textarea().value).toBe("");
    fixture.group = undefined;
  });

  it("shows the run's card for /goal status and refills its goal for /goal resume", () => {
    const room = runningRoom("stopped");
    fixture.group = room;
    fixture.dispatch.mockClear();
    restoreComposerDraft(draftId, { text: "", attachments: [], channelMode: "chat" });
    renderRoom(room);
    type("/goal sta");
    flushSync(() => option("/goal status")!.click());
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "focusMessage", threadId: room.threadId, messageId: "run-card" });
    type("/goal re");
    flushSync(() => option("/goal resume")!.click());
    expect(textarea().value).toBe("ship the release");
    expect(chip()).not.toBeNull();
    fixture.group = undefined;
  });
});
