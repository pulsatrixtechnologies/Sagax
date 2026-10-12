import { describe, expect, it } from "vitest";

import { computerMenuOnKey, powerFromEnvironment, powerFromScreen, powerLabelKey } from "./computer-menu";

const base = { open: false, count: 3, active: 0, chosen: 1, labels: ["Cloud", "GOX-PC-07", "Jean-Christophes-MacBook-Pro"] };

describe("computer menu keyboard", () => {
  it("opens on the chosen machine, or the ends of the list", () => {
    expect(computerMenuOnKey({ ...base, key: "ArrowDown" })).toMatchObject({ handled: true, open: true, active: 1, select: null });
    expect(computerMenuOnKey({ ...base, key: "Enter" })).toMatchObject({ open: true, active: 1 });
    expect(computerMenuOnKey({ ...base, key: " " })).toMatchObject({ open: true, active: 1 });
    expect(computerMenuOnKey({ ...base, key: "ArrowUp" })).toMatchObject({ open: true, active: 2 });
    expect(computerMenuOnKey({ ...base, key: "End" })).toMatchObject({ open: true, active: 2 });
    expect(computerMenuOnKey({ ...base, key: "Home" })).toMatchObject({ open: true, active: 0 });
    expect(computerMenuOnKey({ ...base, key: "a" })).toMatchObject({ handled: false, open: false });
  });

  it("moves, wraps, and chooses while the menu is open", () => {
    const open = { ...base, open: true, active: 1 };
    expect(computerMenuOnKey({ ...open, key: "ArrowDown" })).toMatchObject({ open: true, active: 2, select: null });
    expect(computerMenuOnKey({ ...open, key: "ArrowDown", active: 2 })).toMatchObject({ active: 0 });
    expect(computerMenuOnKey({ ...open, key: "ArrowUp" })).toMatchObject({ active: 0 });
    expect(computerMenuOnKey({ ...open, key: "ArrowUp", active: 0 })).toMatchObject({ active: 2 });
    expect(computerMenuOnKey({ ...open, key: "Home" })).toMatchObject({ active: 0, open: true });
    expect(computerMenuOnKey({ ...open, key: "End" })).toMatchObject({ active: 2, open: true });
    expect(computerMenuOnKey({ ...open, key: "Enter" })).toMatchObject({ handled: true, open: false, select: 1, close: true });
    expect(computerMenuOnKey({ ...open, key: " " })).toMatchObject({ select: 1, close: true });
  });

  it("closes on Escape and Tab, and Escape is the only one it handles", () => {
    const open = { ...base, open: true, active: 2 };
    expect(computerMenuOnKey({ ...open, key: "Escape" })).toEqual({ handled: true, open: false, active: 2, select: null, close: true });
    expect(computerMenuOnKey({ ...open, key: "Tab" })).toEqual({ handled: false, open: false, active: 2, select: null, close: true });
  });

  it("jumps to the next name that starts with the typed letter", () => {
    const open = { ...base, open: true, active: 0 };
    expect(computerMenuOnKey({ ...open, key: "j" }).active).toBe(2);
    expect(computerMenuOnKey({ ...open, key: "g" }).active).toBe(1);
    expect(computerMenuOnKey({ ...open, key: "c", active: 1 }).active).toBe(0);
    expect(computerMenuOnKey({ ...open, key: "é", labels: ["Écran", "Infonuagique", "Allumé"] }).active).toBe(0);
    expect(computerMenuOnKey({ ...open, key: "z" })).toMatchObject({ handled: false, active: 0 });
  });

  it("ignores shortcuts and an empty list", () => {
    for (const modifier of ["altKey", "metaKey", "ctrlKey"] as const) {
      expect(computerMenuOnKey({ ...base, key: "ArrowDown", [modifier]: true }).handled).toBe(false);
    }
    expect(computerMenuOnKey({ ...base, key: "Enter", count: 0 }).handled).toBe(false);
    expect(computerMenuOnKey({ ...base, key: "ArrowDown", chosen: 99 }).active).toBe(2);
  });
});

describe("computer menu power", () => {
  it("reads a running screen as on, and keeps the other states", () => {
    expect(powerFromScreen("running")).toBe("on");
    expect(powerFromScreen("off")).toBe("off");
    expect(powerFromScreen("paused")).toBe("paused");
    expect(powerFromScreen("starting")).toBe("starting");
    expect(powerFromScreen("error")).toBe("error");
  });

  it("reads the server environment the way the screen does", () => {
    expect(powerFromEnvironment({ configured: false })).toBe("off");
    expect(powerFromEnvironment({ configured: true, state: "running" })).toBe("on");
    expect(powerFromEnvironment({ configured: true, state: "paused" })).toBe("paused");
    expect(powerFromEnvironment({ configured: true, state: "missing" })).toBe("off");
    expect(powerFromEnvironment({ configured: true, state: "stopped" })).toBe("off");
    expect(powerFromEnvironment({ configured: true, state: "whatever" })).toBe("unavailable");
    expect(powerFromEnvironment({ configured: true })).toBe("unavailable");
  });

  it("names each power with its own string", () => {
    expect(powerLabelKey("off")).toBe("orgComputer.choice.status.off");
    expect(powerLabelKey("on")).toBe("orgComputer.choice.status.on");
    expect(powerLabelKey("unavailable")).toBe("orgComputer.choice.status.unavailable");
  });
});
