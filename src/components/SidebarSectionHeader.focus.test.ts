// @vitest-environment happy-dom
// The group header's blue focus frame: keyboard focus only (JC, 2026-10-15).
// A click, or focus handed back after the group's right-click menu, marks the
// header data-pointer-focus, which styles.css draws without an outline.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SidebarSectionHeader } from "./SidebarSectionHeader";

let host: HTMLDivElement;
let root: Root;
const header = () => host.querySelector<HTMLButtonElement>("[data-sidebar-section-header]")!;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root.render(createElement(SidebarSectionHeader, { name: "Mon équipe", collapsed: false, onToggle: () => {}, reorderable: false, dragging: false })));
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
});

describe("group header focus frame", () => {
  it("marks a focus that follows a click (or a right click and its menu)", () => {
    header().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    header().focus();
    expect(header().hasAttribute("data-pointer-focus")).toBe(true);
  });

  it("leaves a Tab focus unmarked, so the frame shows", () => {
    header().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    header().focus();
    header().blur();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    header().focus();
    expect(header().hasAttribute("data-pointer-focus")).toBe(false);
  });

  it("drops the mark once the keyboard moves on the header", () => {
    header().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    header().focus();
    header().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(header().hasAttribute("data-pointer-focus")).toBe(false);
  });
});
