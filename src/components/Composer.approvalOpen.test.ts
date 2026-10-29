// @vitest-environment happy-dom
// 2026-10-29: the person can always write. A pending approval used to
// disable the box ("Answer the approval above to continue"); now the card
// waits in the chat, the box stays open, and a message sent past it goes
// out as any message while the bot works (steered in or queued by the
// server), without answering the card for the person.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Message } from "@/state/store";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn(), messages: [] as unknown[] }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({
    state: { ...original.initialState, bots: [{ ...bot, messages: fixture.messages }], instances: [{
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

const { Composer } = await import("./Composer");
const { restoreComposerDraft } = await import("@/lib/drafts");
const { setLocale } = await import("@/lib/i18n");

const bot: Bot = {
  id: "ask-bot", threadId: "ask-thread", name: "Atlas", title: "", description: "",
  color: "blue", notifications: false, unread: false, busy: true, messages: [],
  modelSelection: { instanceId: "fake", model: "fake" },
};
const draftId = `bot:${bot.id}:${bot.threadId}`;
const approval = {
  id: "a1", at: 1, role: "bot", kind: "options",
  card: { title: "Run a command", subtitle: "ls -la", options: ["Allow", "Deny"], requestId: "req-1", tool: "bash" },
} as unknown as Message;

describe("writing while an approval waits", () => {
  let root: Root;
  let container: HTMLDivElement;
  const mount = (messages: Message[]) => {
    fixture.messages = messages;
    flushSync(() => root.render(createElement(Composer, { bot: { ...bot, messages } })));
  };
  beforeEach(() => {
    setLocale("en");
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

  it("keeps the box open, says the card stays, and sends past it without answering for the person", () => {
    mount([approval]);
    const input = container.querySelector("textarea")!;
    expect(input.disabled).toBe(false);
    expect(input.getAttribute("placeholder")).toBe("Answer the approval above, or write something else: it stays open");
    expect(container.textContent).toContain("ls -la");
    sendWithEnter("Pendant que tu attends, note aussi le port");
    const actions = fixture.dispatch.mock.calls.map(([action]) => action);
    expect(actions).toContainEqual(expect.objectContaining({ type: "send", botId: bot.id, text: "Pendant que tu attends, note aussi le port" }));
    expect(actions.some((action) => action.type === "decideRequest")).toBe(false);
  });

  it("is open with nothing pending as well", () => {
    mount([]);
    expect(container.querySelector("textarea")!.disabled).toBe(false);
  });
});
