// A confidential thread's classification band (JC 2026-10-16): top of the
// conversation and above the composer, in the main chat and a side thread,
// whenever the open thread is confidential, never otherwise, and with no
// way to dismiss it.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { Bot, InstanceInfo } from "@/state/store";

vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
});
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({
    state: { ...original.initialState, config: null, instances: [{ instanceId: "test", driverKind: "codex", displayName: "Test" } as InstanceInfo] },
    dispatch: vi.fn(),
  }) };
});
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "other" }, localComputer: { available: false, reasonCode: "cua-driver-unavailable", message: "" } }, ready: true }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/cloud-guest", () => ({ useCanWriteIn: () => null }));
vi.mock("./CitationUI", async (importOriginal) => ({
  ...await importOriginal<typeof import("./CitationUI")>(),
  CitationSelectionToolbar: () => createElement("span"),
}));
vi.mock("./ModelPicker", () => ({ ModelPicker: () => createElement("span") }));
vi.mock("./ApprovalModeSelector", () => ({ ApprovalModeSelector: () => createElement("span") }));

const { ChatView } = await import("./ChatView");
afterAll(() => vi.unstubAllGlobals());

const botWith = (confidential: boolean): Bot => ({
  id: "bot", threadId: "t1", name: "Pepper", title: "", description: "", color: "green",
  notifications: true, unread: false, busy: false,
  messages: [{ id: "m1", role: "bot", kind: "text", text: "An answer", at: 1 } as Bot["messages"][number]],
  modelSelection: { instanceId: "test", model: "profile-default" },
  tasks: [
    { threadId: "t1", title: "Payroll question", createdAt: 1, busy: false, activity: "idle", ...(confidential ? { confidential: true as const } : {}) },
    { threadId: "t2", title: "Other", createdAt: 2, confidential: true },
  ],
});

const banners = (markup: string) => [...markup.matchAll(/data-confidential-banner="(top|bottom)"/g)].map((match) => match[1]);
const side = () => ({ header: createElement("div", null, "Payroll question"), label: "Side thread" });

describe("the confidential banner in the chat", () => {
  it("shows a top and a bottom band when the open thread is confidential", () => {
    const markup = renderToStaticMarkup(createElement(ChatView, { bot: botWith(true) }));
    expect(banners(markup)).toEqual(["top", "bottom"]);
    expect(markup).toMatch(/role="note"[^>]*data-confidential-banner="top"/);
    expect(markup).toContain("Confidential thread: this thread is not remembered, not exported and not shared");
    // the bottom band sits above the composer
    expect(markup.indexOf('data-confidential-banner="bottom"')).toBeLessThan(markup.lastIndexOf("<textarea"));
  });

  it("shows no band on an ordinary thread, even when another thread of the bot is confidential", () => {
    expect(banners(renderToStaticMarkup(createElement(ChatView, { bot: botWith(false) })))).toEqual([]);
  });

  it("shows both bands in a side thread too", () => {
    expect(banners(renderToStaticMarkup(createElement(ChatView, { bot: botWith(true), side: side() })))).toEqual(["top", "bottom"]);
  });

  it("cannot be dismissed: the band has no button", () => {
    const markup = renderToStaticMarkup(createElement(ChatView, { bot: botWith(true) }));
    for (const position of ["top", "bottom"]) {
      const start = markup.indexOf(`data-confidential-banner="${position}"`);
      const band = markup.slice(start, markup.indexOf("</div>", start));
      expect(band).not.toMatch(/<button/);
    }
  });
});
