// @vitest-environment happy-dom
// A routine's row menu and its name typed in place (2026-10-29): the menu
// acts on the routine (Run now or Stop, Pause or Resume, Rename, Open,
// Duplicate, Delete last), never moves it between folders (drag and drop
// does); New folder lives in the section's "…". Rename: Enter saves through
// the routine's own PATCH, Escape cancels, an empty name is refused.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { Routine } from "@/lib/routines";

const fixture = vi.hoisted(() => ({
  state: { routinesLoadState: "ready", routineFolders: {} as Record<string, string[]>, config: {} as Record<string, unknown>, routineRuns: [] as Array<Record<string, unknown>> },
  dispatch: vi.fn(),
}));
vi.mock("@/state/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/state/store")>()),
  useStore: () => ({ state: fixture.state, dispatch: fixture.dispatch, flushBotPatches: async () => {} }),
}));

const { RoutineFolderList } = await import("./RoutineFolders");
const { resetServerFeatures } = await import("@/lib/server-features");

const bot = { id: "bot-1", threadId: "t1", name: "Scout", title: "", description: "", notifications: false, color: "green", unread: false, messages: [] };
const routine = (id: string, name: string, folder?: string, enabled = true): Routine => ({
  id, name, ...(folder ? { folder } : {}), prompt: "x", target: "bot", botId: bot.id, runOn: "maus", enabled, canRun: true,
  schedule: { type: "daily", time: "09:00", weekdays: [1, 2, 3, 4, 5] }, durationMinutes: 5, nextRunAt: null, createdAt: 0, updatedAt: 0,
} as Routine);
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let host: HTMLDivElement;
let root: Root;
const opened: string[] = [];
const duplicated: string[] = [];
const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const routines = [routine("r1", "Morning", "Home lab"), routine("r2", "Backup", undefined, false)];
const mount = async () => {
  await act(async () => {
    root.render(createElement(RoutineFolderList, {
      bot: bot as never, routines, runs: fixture.state.routineRuns as never, grouped: true, viewerPrincipalId: null,
      onOpen: (r: Routine) => { opened.push(r.id); }, onCreateIn: () => {}, onDuplicate: (r: Routine) => { duplicated.push(r.id); },
    }));
  });
  await flush();
};
const row = (id: string) => host.querySelector(`[data-routine-id="${id}"]`)!;
const rightClick = (target: Element) => act(() => { target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 20, clientY: 20 })); });
const menuItems = () => [...document.querySelectorAll<HTMLButtonElement>('[data-routine-folder-menu="row"] [role=menuitem]')].map((item) => item.getAttribute("data-routine-action"));
const click = (selector: string) => act(() => { document.querySelector<HTMLElement>(selector)!.click(); });
const key = (target: Element, name: string) => act(() => { target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true })); });
const type = (input: HTMLInputElement, value: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
});

beforeEach(() => {
  setLocale("en");
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  resetServerFeatures();
  localStorage.clear();
  fixture.dispatch.mockReset();
  fixture.state.routineFolders = { "bot-1": ["Home lab"] };
  fixture.state.routineRuns = [];
  opened.length = 0;
  duplicated.length = 0;
  vi.stubGlobal("fetch", vi.fn(async () => json(200, { folders: ["Home lab"], routines: [] })));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("a routine's row menu", () => {
  it("runs, pauses, renames, opens, duplicates and deletes, Delete last and red; no Move to folder", async () => {
    await mount();
    rightClick(row("r1"));
    expect(menuItems()).toEqual(["run-now", "pause", "rename", "open", "duplicate", "delete"]);
    expect(document.querySelector('[data-routine-action="delete"]')!.className).toContain("text-danger");
    expect(document.body.textContent).not.toContain("Move to folder");
    expect(document.querySelector("[data-routine-move-to],[data-routine-remove-folder]")).toBeNull();
    click('[data-routine-action="run-now"]');
    expect(fixture.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "runRoutine", routineId: "r1" }));
  });

  it("offers Stop instead of Run now while a run is in flight, and Resume for a paused routine", async () => {
    fixture.state.routineRuns = [{ id: "x1", routineId: "r1", status: "running" }];
    await mount();
    rightClick(row("r1"));
    expect(menuItems()[0]).toBe("stop");
    click('[data-routine-action="stop"]');
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "cancelRoutineRun", runId: "x1" });
    rightClick(row("r2"));
    expect(menuItems().slice(0, 2)).toEqual(["run-now", "resume"]);
  });

  it("Open and Duplicate reach the list's own handlers; Delete deletes", async () => {
    await mount();
    rightClick(row("r1"));
    click('[data-routine-action="open"]');
    expect(opened).toEqual(["r1"]);
    rightClick(row("r1"));
    click('[data-routine-action="duplicate"]');
    expect(duplicated).toEqual(["r1"]);
    rightClick(row("r1"));
    click('[data-routine-action="delete"]');
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "deleteRoutine", routineId: "r1" });
  });
});

describe("renaming a routine in place", () => {
  it("Rename opens the field on the row; Enter saves through the routine's update", async () => {
    await mount();
    rightClick(row("r1"));
    click('[data-routine-action="rename"]');
    const input = row("r1").querySelector<HTMLInputElement>("[data-routine-name-input] input")!;
    expect(input.value).toBe("Morning");
    type(input, "Morning brief");
    key(input, "Enter");
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "updateRoutine", routineId: "r1", patch: { name: "Morning brief" } });
    expect(row("r1").querySelector("[data-routine-name-input]")).toBeNull();
  });

  it("Escape cancels, and an empty name is refused with a reason", async () => {
    await mount();
    const button = row("r2").querySelector("button")!;
    key(button, "F2");
    let input = row("r2").querySelector<HTMLInputElement>("[data-routine-name-input] input")!;
    type(input, "   ");
    key(input, "Enter");
    expect(row("r2").querySelector("[data-routine-name-empty]")).not.toBeNull();
    expect(fixture.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "updateRoutine" }));
    key(input, "Escape");
    expect(row("r2").querySelector("[data-routine-name-input]")).toBeNull();
    key(row("r2").querySelector("button")!, "F2");
    input = row("r2").querySelector<HTMLInputElement>("[data-routine-name-input] input")!;
    expect(input.value).toBe("Backup");
  });
});

describe("the section's menu", () => {
  it("makes a new folder through the folders route", async () => {
    await mount();
    const control = { current: null as null | { openSectionMenu: (at: { x: number; y: number }, trigger: HTMLElement) => void } };
    await act(async () => {
      root.render(createElement(RoutineFolderList, {
        bot: bot as never, routines, runs: [] as never, grouped: true, viewerPrincipalId: null, onOpen: () => {}, onCreateIn: () => {}, controlRef: control as never,
      }));
    });
    act(() => control.current!.openSectionMenu({ x: 10, y: 10 }, host));
    click("[data-routine-new-folder]");
    const input = document.querySelector<HTMLInputElement>("[data-routine-folder-name-input] input")!;
    type(input, "Reports");
    key(input, "Enter");
    await flush();
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("/api/routines/folders")) as unknown as [string, RequestInit];
    expect(JSON.parse(String(call[1].body))).toEqual({ action: "create", botId: "bot-1", name: "Reports" });
  });
});
