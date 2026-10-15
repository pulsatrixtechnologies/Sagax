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

const fixture = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({
    state: { ...original.initialState, bots: [bot], groups: [group], instances: [] },
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
});
