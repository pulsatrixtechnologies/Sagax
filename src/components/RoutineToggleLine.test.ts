// @vitest-environment happy-dom
// "Disabled · 5 routines" in the conversation (2026-10-15, JC, after Grok
// Bot): one quiet centered line per action and per turn, opening the list of
// the routines it names; a routine the person can open goes to its page.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { RoutineToggleEvent } from "../../shared/wire";
import { RoutineToggleLine } from "./RoutineToggleLine";

let root: Root | null = null;
const five: RoutineToggleEvent = {
  action: "disabled",
  turnKey: "u1",
  routines: [
    { id: "r1", name: "[Daily] Sagax & Perspicax daily dev + Connector memory watch and review" },
    { id: "r2", name: "[Fleet] Weekly review of Ember's routines" },
    { id: "r3", name: "Morning brief" },
    { id: "r4", name: "Invoices check" },
    { id: "r5", name: "Gone routine" },
  ],
};

function render(event: RoutineToggleEvent, onOpen = vi.fn(), canOpen = (id: string) => id !== "r5") {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  flushSync(() => root!.render(createElement(RoutineToggleLine, { event, canOpen, onOpen })));
  return container;
}
const line = (container: HTMLElement) => container.querySelector<HTMLButtonElement>("[data-routine-toggle] button")!;

afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = "";
  setLocale("en");
});

describe("the routines line", () => {
  it("reads Disabled · 5 routines, centered and closed", () => {
    const container = render(five);
    const button = line(container);
    expect(button.textContent).toBe("Disabled·5 routines");
    expect(button.querySelector("svg")).not.toBeNull();
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector("[data-routine-toggle]")!.className).toContain("justify-center");
    expect(container.querySelector("[data-routine-toggle-menu]")).toBeNull();
  });

  it("says one routine in the singular, and Enabled for routines turned on", () => {
    const container = render({ action: "enabled", turnKey: "u1", routines: [five.routines[2]] });
    expect(line(container).textContent).toBe("Enabled·1 routine");
  });

  it("reads in French with the vouvoiement copy", () => {
    setLocale("fr");
    const container = render(five);
    expect(line(container).textContent).toBe("Désactivé·5 routines");
    expect(line(container).getAttribute("aria-label")).toBe("Désactivé : 5 routines. Les afficher");
    root?.unmount();
    const one = render({ action: "enabled", turnKey: "u1", routines: [five.routines[0]] });
    expect(line(one).textContent).toBe("Activé·1 routine");
  });

  it("opens a menu of every routine, each with the clock and its whole name for truncation", () => {
    const container = render(five);
    flushSync(() => line(container).click());
    const menu = container.querySelector("[data-routine-toggle-menu]")!;
    expect(menu.getAttribute("role")).toBe("menu");
    const items = [...menu.querySelectorAll<HTMLButtonElement>("[role=menuitem]")];
    expect(items.map((item) => item.textContent)).toEqual(five.routines.map((routine) => routine.name));
    expect(items.every((item) => item.querySelector("svg") && item.querySelector("span.truncate"))).toBe(true);
    expect(line(container).getAttribute("aria-expanded")).toBe("true");
  });

  it("opens a routine the person can open, and keeps one they cannot inert", () => {
    const onOpen = vi.fn();
    const container = render(five, onOpen);
    flushSync(() => line(container).click());
    const item = (id: string) => container.querySelector<HTMLButtonElement>(`[data-routine-toggle-item="${id}"]`)!;
    expect(item("r5").disabled).toBe(true);
    flushSync(() => item("r2").click());
    expect(onOpen).toHaveBeenCalledWith(five.routines[1]);
  });

  it("draws nothing for a line with no routine left", () => {
    const container = render({ ...five, routines: [] });
    expect(container.querySelector("[data-routine-toggle]")).toBeNull();
  });
});
