// @vitest-environment happy-dom
// "Edit routine" (2026-10-29): titled for a routine, the name up top with a
// one-line summary, When / What / Where results go in that order, More
// options folded, Save and Cancel always there, unsaved changes said and
// confirmed before closing. A webhook routine picks "When a webhook
// arrives" and manages its webhook in When.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";
import type { Routine } from "../../shared/routines";

const fixture = vi.hoisted(() => ({ webhooks: [] as unknown[] }));
vi.mock("@/hooks/use-modal-dialog", () => ({ useModalDialog: () => {} }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    api: vi.fn(async () => ({})),
    useStore: () => ({ state: { ...original.initialState, webhooks: fixture.webhooks, webhookIngress: { available: true, baseUrl: "https://hooks.example.test" } }, dispatch: vi.fn() }),
  };
});
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { host: {}, dictation: { available: false } }, ready: true }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

const { setLocale } = await import("@/lib/i18n");
const { RoutineEditor } = await import("./RoutineCalendarPage");

const bot = { id: "runner", threadId: "main", name: "Runner", color: "green", tasks: [], modelSelection: { instanceId: "t", model: "t" } } as unknown as Bot;
const routine = (schedule: Routine["schedule"]): Routine => ({
  id: "r1", name: "Weekly digest", prompt: "Summarise the week", target: "bot", botId: bot.id,
  runOn: "maus", enabled: true, schedule, durationMinutes: 30, nextRunAt: null, createdAt: 1, updatedAt: 1, postResults: true,
});

let host: HTMLDivElement;
let root: Root;
const mount = (value: Routine, onClose = vi.fn()) => {
  flushSync(() => root.render(createElement(RoutineEditor, { routine: value, bots: [bot], lockedBotId: bot.id, onClose })));
  return onClose;
};

beforeEach(() => {
  setLocale("en");
  fixture.webhooks = [];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("Edit routine", () => {
  it("reads as a routine: title, name, summary, then When, What, Where it runs, More options", () => {
    mount(routine({ type: "cron", expression: "30 8,12,16 * * 1-5", timeZone: "America/Toronto" }));
    expect(host.querySelector("[data-editor-title]")?.textContent).toBe("Edit routine");
    expect(host.querySelector<HTMLInputElement>("[data-routine-editor-name]")?.value).toBe("Weekly digest");
    expect(host.querySelector("[data-routine-editor-summary]")?.textContent).toBe("Weekdays, at 8:30 AM, 12:30 PM and 4:30 PM (Toronto time) · Results in the conversation");
    const sections = [...host.querySelectorAll("[data-routine-editor-section]")].map((section) => section.getAttribute("data-routine-editor-section"));
    expect(sections).toEqual(["when", "what", "where"]);
    const more = host.querySelector<HTMLDetailsElement>("[data-routine-editor-more]")!;
    expect(more.open).toBe(false);
    expect(more.textContent).toContain("If the previous run is still working");
    expect(more.textContent).toContain("Only when I'm here");
    expect(host.querySelector("[data-markdown-editor]")?.querySelector("[data-md-full]")).not.toBeNull();
    expect(host.textContent).not.toMatch(/cron/i);
    expect(host.querySelector("[data-editor-dirty]")).toBeNull();
  });

  it("says a change is not saved and asks before closing over it", () => {
    const onClose = mount(routine({ type: "cron", expression: "0 9 * * *", timeZone: "UTC" }));
    const name = host.querySelector<HTMLInputElement>("[data-routine-editor-name]")!;
    flushSync(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "Daily digest");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.querySelector("[data-editor-dirty]")?.textContent).toBe("Not saved");
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    const cancel = [...host.querySelectorAll("button")].find((button) => button.textContent === "Cancel")!;
    flushSync(() => cancel.click());
    expect(confirm).toHaveBeenCalledWith("Close without saving your changes?");
    expect(onClose).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    flushSync(() => cancel.click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("manages a webhook routine's webhook in When", () => {
    fixture.webhooks = [{ id: "w1", endpointId: "wh_abc", routineId: "r1", name: "Weekly digest", prompt: "", botId: bot.id, runOn: "maus", enabled: true, createdAt: 1, updatedAt: 1, deliveryCount: 2, tokenLast4: "k3Yz" }];
    mount(routine({ type: "webhook" }));
    expect(host.querySelector<HTMLSelectElement>("[data-schedule-frequency]")?.value).toBe("webhook");
    const when = host.querySelector("[data-routine-editor-section=when]")!;
    expect(when.querySelector("[data-webhook-url]")?.textContent).toBe("https://hooks.example.test/hooks/wh_abc");
    expect(when.textContent).toContain("whsec_••••k3Yz");
    expect(when.textContent).toContain("Copy a curl example");
    expect(host.querySelector("[data-routine-editor-summary]")?.textContent).toContain("When a webhook fires");
  });

  it("opens read-only for a routine the person cannot change: fields off, no Save, its owner named", () => {
    mount({ ...routine({ type: "cron", expression: "0 9 * * *", timeZone: "UTC" }), canEdit: false, owner: { id: "pr_other", name: "Alex" } } as Routine);
    expect(host.querySelector("[data-editor-title]")?.textContent).toBe("Routine");
    expect(host.querySelector("[data-routine-editor-readonly]")).not.toBeNull();
    expect(host.querySelector("[data-routine-editor-owner]")?.textContent).toBe("Owner: Alex");
    expect(host.querySelector<HTMLFieldSetElement>("fieldset")?.disabled).toBe(true);
    const labels = [...host.querySelectorAll("button")].map((button) => button.textContent);
    expect(labels).toContain("Close");
    expect(labels).not.toContain("Save");
  });
});
