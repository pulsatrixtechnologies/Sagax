// @vitest-environment happy-dom
// Make confidential (JC 2026-10-16): one way only. The menu asks first,
// because it is permanent; a confidential thread offers no way back.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThreadMenu, ThreadMenuItems, type ThreadMenuActions } from "./ThreadMenu";
import { pickerRowActions } from "./TaskPicker";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

const base = (): ThreadMenuActions => ({ onRename: vi.fn(), onDelete: vi.fn() });
const item = (id: string) => document.querySelector<HTMLButtonElement>(`[data-thread-menu-item="${id}"]`);

function Menu({ task, actions }: { task: Parameters<typeof ThreadMenu>[0]["task"]; actions: ThreadMenuActions }) {
  return createElement(ThreadMenu, { task, actions, position: { left: 10, top: 10 }, onClose: () => {} });
}

describe("make a thread confidential from its menu", () => {
  it("asks for confirmation, then makes it confidential once", () => {
    const onMakeConfidential = vi.fn();
    act(() => root.render(createElement(Menu, { task: { threadId: "t1", title: "Payroll" }, actions: { ...base(), onMakeConfidential } })));
    act(() => item("make-confidential")!.click());
    expect(onMakeConfidential).not.toHaveBeenCalled();
    const dialog = document.querySelector('[role="alertdialog"]')!;
    expect(dialog.textContent).toContain("This is permanent");
    expect(dialog.textContent).toContain("open a new thread");
    const confirm = [...dialog.querySelectorAll("button")].find((button) => button.textContent === "Make confidential")!;
    act(() => confirm.click());
    expect(onMakeConfidential).toHaveBeenCalledTimes(1);
  });

  it("cancelling leaves the thread as it was", () => {
    const onMakeConfidential = vi.fn();
    act(() => root.render(createElement(Menu, { task: { threadId: "t1", title: "Payroll" }, actions: { ...base(), onMakeConfidential } })));
    act(() => item("make-confidential")!.click());
    const cancel = [...document.querySelectorAll('[role="alertdialog"] button')].find((button) => button.textContent === "Cancel") as HTMLButtonElement;
    act(() => cancel.click());
    expect(onMakeConfidential).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it("a confidential thread shows that it is permanent, and nothing turns it off", () => {
    act(() => root.render(createElement(Menu, { task: { threadId: "t1", title: "Payroll", confidential: true }, actions: { ...base(), onMakeConfidential: vi.fn() } })));
    expect(item("make-confidential")).toBeNull();
    const info = item("confidential-info")!;
    expect(info.disabled).toBe(true);
    expect(info.textContent).toBe("Confidential thread (permanent)");
    const labels = [...document.querySelectorAll('[role="menuitem"]')].map((button) => button.textContent ?? "");
    expect(labels.some((label) => /ordinary|not confidential|turn off|remove confidential/i.test(label))).toBe(false);
  });

  it("is offered only where the owner gives it (bot threads)", () => {
    const html = ThreadMenuItems({ task: { threadId: "t", title: "x" }, actions: base(), page: "main", onPage: () => {}, onClose: () => {}, regenerating: false, onRegenerate: () => {}, advanced: false });
    act(() => root.render(html));
    expect(item("make-confidential")).toBeNull();
  });

  it("the header picker passes it for an ordinary thread only", () => {
    const onMakeConfidential = vi.fn();
    const given = { onRename: vi.fn(), onDelete: vi.fn(), threadActions: { onMakeConfidential } };
    pickerRowActions({ threadId: "t1" }, given).onMakeConfidential!();
    expect(onMakeConfidential).toHaveBeenCalledWith("t1");
    expect(pickerRowActions({ threadId: "t2", confidential: true }, given).onMakeConfidential).toBeUndefined();
  });
});
