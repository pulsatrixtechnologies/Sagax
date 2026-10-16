// @vitest-environment happy-dom
// The account menu's second levels (Grok Bot's Usage ›, Help ›, Switch
// organization ›): a chevron and a grey value on the row, the level opens on
// click or the right arrow, closes with the left arrow, and its actions run.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SidebarPopoverMenu, type SidebarMenuItem } from "./SidebarPopoverMenu";

let host: HTMLDivElement;
let root: Root;
const viewUsage = vi.fn();
const items: SidebarMenuItem[] = [
  {
    key: "usage",
    label: "Usage",
    value: "42% used",
    submenu: [
      { key: "weekly", label: "Claude Max · Weekly", value: "42% used", info: true },
      { key: "view-usage", label: "View usage", separatorBefore: true, onSelect: viewUsage },
    ],
    onSelect: () => {},
  },
  { key: "settings", label: "Settings", onSelect: () => {} },
];

beforeEach(() => {
  viewUsage.mockReset();
  document.documentElement.dataset.reducedMotion = "true";
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root.render(createElement(SidebarPopoverMenu, { items, ariaLabel: "Account", renderTrigger: () => createElement("span", null, "JC") })));
  flushSync(() => host.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!.click());
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
});

const row = (key: string) => host.querySelector<HTMLButtonElement>(`[data-menu-key="${key}"]`)!;

describe("a second level in the sidebar's popover menu", () => {
  it("shows the value in grey and a chevron, folded until asked", () => {
    expect(row("usage").querySelector("[data-menu-value]")!.textContent).toBe("42% used");
    expect(row("usage").getAttribute("aria-haspopup")).toBe("menu");
    expect(row("usage").getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector("[data-submenu]")).toBeNull();
  });

  it("opens on click with its figures and actions, and runs an action", () => {
    flushSync(() => row("usage").click());
    const sub = document.querySelector<HTMLElement>('[data-submenu="usage"]')!;
    expect(sub.getAttribute("role")).toBe("menu");
    expect(sub.querySelector("[data-submenu-info]")!.textContent).toContain("42% used");
    const action = [...sub.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((button) => button.textContent === "View usage")!;
    // the level floats on the page, outside the menu's box: a press in it
    // must not count as a press outside the menu
    flushSync(() => action.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    expect(document.querySelector('[data-submenu="usage"]')).not.toBeNull();
    flushSync(() => action.click());
    expect(viewUsage).toHaveBeenCalledOnce();
  });

  it("opens with the right arrow and closes with the left arrow", () => {
    flushSync(() => row("usage").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    const sub = document.querySelector<HTMLElement>('[data-submenu="usage"]')!;
    expect(sub).not.toBeNull();
    flushSync(() => sub.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
    expect(document.querySelector("[data-submenu]")).toBeNull();
  });
});
