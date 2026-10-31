import { describe, expect, it } from "vitest";

import {
  setSidebarPeopleApart,
  sidebarPeopleApartChoice,
  sidebarPeopleApartEnabled,
} from "./sidebar-people-apart-preference";

describe("sidebar people-apart preference", () => {
  it("defaults to on and records off", () => {
    setSidebarPeopleApart(true);
    expect(sidebarPeopleApartEnabled()).toBe(true);
    setSidebarPeopleApart(false);
    expect(sidebarPeopleApartChoice.get()).toBe("off");
    expect(sidebarPeopleApartEnabled()).toBe(false);
    setSidebarPeopleApart(true);
    expect(sidebarPeopleApartChoice.get()).toBe("on");
    expect(sidebarPeopleApartEnabled()).toBe(true);
  });
});
