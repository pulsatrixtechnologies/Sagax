// @vitest-environment happy-dom
// The composer's controls after Grok Bot's prompt bar (JC, 2026-10-15): one +
// that opens Attach files / Teach a task / the conversation's approval level
// and workspace; no Send button (Enter sends; the round CTA turns into the
// send arrow while something is typed, Voice otherwise, in the bot's color);
// a grey mic that dictates into the field, with a recording pill, or opens
// the Keys card when nothing can transcribe here.
import { createElement, type ComponentProps, type ReactElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, InstanceInfo } from "@/state/store";
import type { ModelPicker } from "./ModelPicker";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn(), instances: [] as unknown[], dictation: false }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, api: vi.fn(async () => ({})), useStore: () => ({
    state: { ...original.initialState, instances: fixture.instances },
    dispatch: fixture.dispatch,
  }) };
});
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: fixture.dictation }, host: { packaged: true, platform: "other" }, localComputer: { available: false, reasonCode: "x", message: "" } }, ready: true }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: vi.fn() }));
vi.mock("./ModelPicker", () => ({ ModelPicker: (_props: ComponentProps<typeof ModelPicker>) => createElement("span") }));
vi.mock("./settings/ProviderKeys", async (importOriginal) => ({
  ...await importOriginal<typeof import("./settings/ProviderKeys")>(),
  openProviderKeyDialog: vi.fn(),
}));

const { Composer } = await import("./Composer");
const { ComposerPlusMenu } = await import("./ComposerControls");
const { setLocale } = await import("@/lib/i18n");
const { openProviderKeyDialog } = await import("./settings/ProviderKeys");
const { forgetVoiceModeStatus } = await import("@/lib/voice-mode/api");

const bot = (color: string): Bot => ({
  id: "bot", threadId: "selected", name: "Harrie", title: "", description: "", color: color as Bot["color"],
  notifications: true, unread: false, busy: false, messages: [],
  modelSelection: { instanceId: "test", model: "m" },
  tasks: [{ threadId: "selected", title: "Selected", createdAt: 1, busy: false, activity: "idle",
    modelSelection: { instanceId: "test", model: "m" }, approvalMode: "ask" }],
});

let host: HTMLDivElement;
let root: Root;
const render = (element: ReactElement) => flushSync(() => root.render(element));
const $ = <T extends Element = HTMLElement>(selector: string) => host.querySelector<T>(selector);
const textarea = () => $<HTMLTextAreaElement>("textarea")!;
const click = (element: Element | null) => flushSync(() => (element as HTMLElement).click());

function type(value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  flushSync(() => {
    setValue.call(textarea(), value);
    textarea().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  setLocale("en");
  fixture.dispatch.mockClear();
  fixture.instances = [];
  fixture.dictation = false;
  forgetVoiceModeStatus();
  // voice mode answers "not available" for this bot
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ provider: "xai", available: false, refusal: { cause: "no_credentials" } }), { status: 200, headers: { "content-type": "application/json" } })));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  delete window.ogb;
  vi.unstubAllGlobals();
});

describe("composer controls (Grok Bot's prompt bar)", () => {
  it("has no Send button: the CTA is Voice when empty and the send arrow once typed", () => {
    render(createElement(Composer, { bot: bot("pink") }));
    expect($('[aria-label="Attach a file"]')).toBeNull();
    expect($("[data-composer-cta]")?.getAttribute("data-composer-cta")).toBe("voice");
    type("hello");
    expect($("[data-composer-cta]")?.getAttribute("data-composer-cta")).toBe("send");
    click($("[data-composer-send]"));
    expect(fixture.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "send", text: "hello" }));
  });

  it("paints the Voice button in the open bot's color, and keeps a grey bot on the ink button", () => {
    render(createElement(Composer, { bot: bot("pink") }));
    const pink = $("[data-composer-voice]")!.getAttribute("style") ?? "";
    expect(pink).toContain("--cta-fill: #d84f8b");
    render(createElement(Composer, { key: "teal", bot: bot("teal") }));
    const teal = $("[data-composer-voice]")!.getAttribute("style") ?? "";
    expect(teal).toContain("--cta-fill");
    expect(teal).not.toBe(pink);
    render(createElement(Composer, { key: "grey", bot: bot("grey") }));
    expect($("[data-composer-voice]")!.getAttribute("style") ?? "").not.toContain("--cta-fill");
  });

  it("opens one + menu in groups: Attach files and Teach a task, the modes, then the approval row", () => {
    fixture.instances = [{ instanceId: "test", driverKind: "claude", displayName: "Claude", capabilities: { agentsMcp: true } } as unknown as InstanceInfo];
    render(createElement(Composer, { bot: bot("teal") }));
    click($("[data-composer-plus]"));
    const menu = $('[data-composer-plus-menu]')!;
    expect(menu.getAttribute("role")).toBe("menu");
    const items = [...menu.querySelectorAll<HTMLElement>("[data-composer-plus-item]")];
    expect(items.map((item) => [item.dataset.composerPlusGroup, item.dataset.composerPlusItem])).toEqual([
      ["add", "attach"], ["add", "teach"], ["modes", "setup"],
    ]);
    const labels = items.map((item) => item.querySelector(".truncate")?.textContent);
    expect(labels).toEqual(["Attach files", "Teach a task", "Set up this bot"]);
    // a hairline between add and the modes, and before the conversation's rows
    expect(items[2]!.previousElementSibling?.getAttribute("role")).toBe("separator");
    expect(menu.querySelectorAll('[role="separator"]').length).toBe(2);
    expect(menu.querySelector('[data-composer-plus-row="approval"]')).not.toBeNull();
    click(menu.querySelector('[data-composer-plus-item="teach"]'));
    expect(textarea().value).toBe("/learn ");
    expect($("[data-composer-plus]")!.getAttribute("aria-expanded")).toBe("false");
  });

  it("leaves Teach a task out when the bot cannot draft a skill", () => {
    render(createElement(Composer, { bot: bot("teal") }));
    click($("[data-composer-plus]"));
    expect($('[data-composer-plus-item="teach"]')).toBeNull();
    expect($('[data-composer-plus-item="attach"]')).not.toBeNull();
  });

  it("opens the Keys card from the mic when nothing can transcribe here", () => {
    render(createElement(Composer, { bot: bot("teal") }));
    const mic = $("[data-composer-mic]")!;
    expect(mic.getAttribute("data-composer-mic")).toBe("setup");
    click(mic);
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "toggleAppSettings", open: true, section: "engines" });
    expect(openProviderKeyDialog).toHaveBeenCalledWith("xai");
    expect($("[data-dictation-chip]")).toBeNull();
  });

  it("dictates into the field with the Mac's helper: pill with stop, timer and levels; Escape discards", () => {
    fixture.dictation = true;
    let transcript: ((line: { text?: string }) => void) | undefined;
    const speechStart = vi.fn(async () => {});
    const speechStop = vi.fn(async () => {});
    window.ogb = {
      speechStart, speechStop,
      onSpeechTranscript: (cb: (line: { text?: string }) => void) => { transcript = cb; return () => {}; },
      onSpeechEnd: () => () => {},
    } as unknown as NonNullable<Window["ogb"]>;
    render(createElement(Composer, { bot: bot("teal") }));
    type("Note:");
    click($("[data-composer-mic]"));
    expect(speechStart).toHaveBeenCalled();
    const chip = $('[data-dictation-chip="recording"]')!;
    expect(chip.textContent).toContain("0:00");
    expect(chip.querySelectorAll("[data-dictation-levels] > span")).toHaveLength(5);
    expect(chip.querySelector("button")?.getAttribute("aria-label")).toBe("Stop dictation, 0:00");
    // the CTA and the mic give way to the pill
    expect($("[data-composer-cta]")).toBeNull();
    flushSync(() => transcript?.({ text: "buy milk" }));
    expect(textarea().value).toBe("Note: buy milk");
    // Escape on the pill discards what was dictated
    flushSync(() => chip.querySelector("button")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(textarea().value).toBe("Note:");
    expect($("[data-dictation-chip]")).toBeNull();
    expect(speechStop).toHaveBeenCalled();
  });

  it("toggles dictation with ⌘D / Ctrl+D in the field", () => {
    fixture.dictation = true;
    window.ogb = {
      speechStart: vi.fn(async () => {}), speechStop: vi.fn(async () => {}),
      onSpeechTranscript: () => () => {}, onSpeechEnd: () => () => {},
    } as unknown as NonNullable<Window["ogb"]>;
    render(createElement(Composer, { bot: bot("teal") }));
    const mac = navigator.userAgent.includes("Mac");
    const press = () => {
      const event = new KeyboardEvent("keydown", { key: "d", metaKey: mac, ctrlKey: !mac, bubbles: true, cancelable: true });
      flushSync(() => textarea().dispatchEvent(event));
      return event;
    };
    expect(press().defaultPrevented).toBe(true);
    expect($('[data-dictation-chip="recording"]')).not.toBeNull();
    press();
    expect($("[data-dictation-chip]")).toBeNull();
  });
});

describe("ComposerPlusMenu", () => {
  it("moves with the arrow keys and closes on Escape, focus back on the +", async () => {
    const picked = vi.fn();
    render(createElement(ComposerPlusMenu, { items: [
      { id: "a", label: "Attach files", icon: null, onSelect: picked },
      { id: "b", label: "Teach a task", icon: null, onSelect: picked },
    ] }));
    click($("[data-composer-plus]"));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const items = [...host.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(document.activeElement).toBe(items[0]);
    flushSync(() => items[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(items[1]);
    flushSync(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect($("[data-composer-plus]")!.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe($("[data-composer-plus]"));
  });
});
