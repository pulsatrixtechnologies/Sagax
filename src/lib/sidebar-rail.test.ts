// The compact sidebar's keyboard: the arrow keys walk its avatars.
import { describe, expect, it } from "vitest";
import { railFocusIndex } from "./sidebar-rail";

describe("rail arrow keys", () => {
  it("moves one item at a time and stops at the ends", () => {
    expect(railFocusIndex(4, 1, "ArrowDown")).toBe(2);
    expect(railFocusIndex(4, 3, "ArrowDown")).toBe(3);
    expect(railFocusIndex(4, 1, "ArrowUp")).toBe(0);
    expect(railFocusIndex(4, 0, "ArrowUp")).toBe(0);
  });
  it("jumps to the first and last items with Home and End", () => {
    expect(railFocusIndex(4, 2, "Home")).toBe(0);
    expect(railFocusIndex(4, 0, "End")).toBe(3);
  });
  it("enters from outside the items at the near end", () => {
    expect(railFocusIndex(4, -1, "ArrowDown")).toBe(0);
    expect(railFocusIndex(4, -1, "ArrowUp")).toBe(3);
  });
  it("leaves other keys and an empty rail alone", () => {
    expect(railFocusIndex(4, 1, "ArrowLeft")).toBeNull();
    expect(railFocusIndex(4, 1, "Enter")).toBeNull();
    expect(railFocusIndex(0, -1, "ArrowDown")).toBeNull();
  });
});
