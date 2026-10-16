// ChatView in its compact side-thread form (SideThreadPanel).
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { Bot, InstanceInfo } from "@/state/store";
import type { ApprovalModeSelector } from "./ApprovalModeSelector";
import type { ModelPicker } from "./ModelPicker";

const fixture = vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  return { dispatch: vi.fn(), canWrite: null as boolean | null, showToolCalls: false, platform: "other", localReasonCode: "cua-driver-unavailable", localMessage: "", model: null as ComponentProps<typeof ModelPicker> | null,
    approval: null as ComponentProps<typeof ApprovalModeSelector> | null };
});
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({
    state: { ...original.initialState, config: fixture.showToolCalls ? { features: { showToolCalls: true } } : null,
      instances: [{ instanceId: "test", driverKind: "codex", displayName: "Test" } as InstanceInfo] },
    dispatch: fixture.dispatch,
  }) };
});
// The real useCaptionChrome rides along: it only asks this module for the
// window chrome, and these tests render the desktop-neutral layout.
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: fixture.platform }, localComputer: { available: false, reasonCode: fixture.localReasonCode, message: fixture.localMessage } }, ready: true }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/cloud-guest", () => ({ useCanWriteIn: () => fixture.canWrite }));
vi.mock("./CitationUI", async (importOriginal) => ({
  ...await importOriginal<typeof import("./CitationUI")>(),
  CitationSelectionToolbar: () => createElement("span", { "data-testid": "citation-toolbar" }),
}));
vi.mock("./ModelPicker", () => ({ ModelPicker: (props: ComponentProps<typeof ModelPicker>) => {
  fixture.model = props;
  return createElement("span", { "data-test-model-control": true });
} }));
vi.mock("./ApprovalModeSelector", () => ({ ApprovalModeSelector: (props: ComponentProps<typeof ApprovalModeSelector>) => {
  fixture.approval = props;
  return createElement("span", { "data-test-approval-control": true });
} }));

// The + menu opens on a click; rendered statically here with its items and
// rows laid out, so the rows it holds (approval level, workspace) are seen.
vi.mock("./ComposerControls", async (importOriginal) => {
  const original = await importOriginal<typeof import("./ComposerControls")>();
  return { ...original, ComposerPlusMenu: (props: ComponentProps<typeof original.ComposerPlusMenu>) => createElement("div", { "data-test-plus-menu": true },
    ...props.items.map((item) => createElement("button", { key: item.id, "data-composer-plus-item": item.id }, item.label)),
    props.rows?.(() => {})) };
});

const { ChatView } = await import("./ChatView");
afterAll(() => vi.unstubAllGlobals());

const bot: Bot = {
  id: "bot", threadId: "side", name: "Pepper", title: "", description: "", color: "green",
  notifications: true, unread: false, busy: false,
  messages: [{ id: "m1", role: "bot", kind: "text", text: "Side answer", at: 1 } as Bot["messages"][number]],
  modelSelection: { instanceId: "test", model: "profile-default" },
  tasks: [
    { threadId: "main", title: "Main", createdAt: 1 },
    { threadId: "side", title: "Side work", createdAt: 2, busy: false, activity: "idle" },
  ],
};

describe("the chat view in a side thread", () => {
  const side = () => ({ header: createElement("div", { "data-test-side-header": true }, "Side work"), label: "Side thread: Side work" });

  it("draws the side header in place of the bot pill and controls, as a section", () => {
    const markup = renderToStaticMarkup(createElement(ChatView, { bot, side: side() }));
    expect(markup).toMatch(/^<section[^>]*aria-label="Side thread: Side work"[^>]*data-side-chat=""/);
    expect(markup).toContain("data-test-side-header");
    expect(markup).not.toContain("data-chathead-controls");
    expect(markup).not.toContain("<main");
    // the thread's own transcript and composer stay
    expect(markup).toContain("Side answer");
    expect(markup).toMatch(/<textarea/);
  });

  it("keeps the main chat as it was without the side prop", () => {
    const markup = renderToStaticMarkup(createElement(ChatView, { bot: { ...bot, threadId: "main", messages: [] } }));
    expect(markup).toMatch(/^<main/);
    expect(markup).toContain("data-chathead-controls");
    expect(markup).not.toContain("data-side-chat");
  });
});
