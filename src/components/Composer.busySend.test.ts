// @vitest-environment happy-dom
// A message sent while the bot works (JC 2026-10-18): no chooser, the send
// goes out at once as "auto" and the bot routes it (server/busy-routing.ts).
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";
import { restoreComposerDraft } from "@/lib/drafts";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn(), busy: true }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({
    state: { ...original.initialState, bots: [{ ...bot, busy: fixture.busy }], instances: [{
      instanceId: "fake", driverKind: "claude", displayName: "Fake",
      capabilities: { agentsMcp: true, queueing: true },
    }] },
    dispatch: fixture.dispatch,
  }) };
});
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => false }));
vi.mock("./CallView", () => ({ CallButton: () => null }));
vi.mock("./ModelPicker", () => ({ ModelPicker: () => null }));

import { Composer } from "./Composer";

const bot: Bot = {
  id: "busy-bot", threadId: "busy-thread", name: "Atlas", title: "", description: "",
  color: "blue", notifications: false, unread: false, busy: true, messages: [],
  modelSelection: { instanceId: "fake", model: "fake" },
};
const draftId = `bot:${bot.id}:${bot.threadId}`;

describe("sending while the bot works", () => {
  let root: Root;
  let container: HTMLDivElement;

  const mount = (busy: boolean) => {
    fixture.busy = busy;
    flushSync(() => root.render(createElement(Composer, { bot: { ...bot, busy } })));
  };

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
    restoreComposerDraft(draftId, { text: "", attachments: [] });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    flushSync(() => root.unmount());
    container.remove();
    restoreComposerDraft(draftId, { text: "", attachments: [] });
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const sendWithEnter = (text: string) => {
    flushSync(() => restoreComposerDraft(draftId, { text, attachments: [] }));
    const input = container.querySelector("textarea")!;
    flushSync(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
  };

  it("sends at once as auto, with no chooser to answer", () => {
    mount(true);
    sendWithEnter("Prépare aussi le rapport mensuel");
    expect(container.querySelector("[data-busy-send-chooser]")).toBeNull();
    expect(fixture.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "send", botId: bot.id, text: "Prépare aussi le rapport mensuel", busyMode: "auto" }));
  });

  it("names no mode when the bot is idle", () => {
    mount(false);
    sendWithEnter("Bonjour");
    const sent = fixture.dispatch.mock.calls.map(([action]) => action).find((action) => action.type === "send");
    expect(sent).toBeDefined();
    expect(sent.busyMode).toBeUndefined();
  });
});
