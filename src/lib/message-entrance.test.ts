// A person bubble enters (animate-msg-in) only when it is genuinely new,
// and once per send even when the server's copy replaces the optimistic one.
import { beforeEach, describe, expect, it } from "vitest";
import { claimMessageEntrance, ENTRANCE_WINDOW_MS, resetMessageEntrances } from "./message-entrance";

const now = 1_000_000;

describe("claimMessageEntrance", () => {
  beforeEach(() => resetMessageEntrances());

  it("plays for a line just sent, once per send", () => {
    expect(claimMessageEntrance({ id: "optimistic-s1", at: now, sendId: "s1" }, now)).toBe(true);
    // the server's copy: a new id, the same send
    expect(claimMessageEntrance({ id: "m1", at: now + 200, sendId: "s1" }, now + 300)).toBe(false);
    // the same row mounting again (a window re-mount)
    expect(claimMessageEntrance({ id: "optimistic-s1", at: now, sendId: "s1" }, now + 400)).toBe(false);
  });

  it("plays for a line written moments ago, elsewhere", () => {
    expect(claimMessageEntrance({ id: "m2", at: now - 500 }, now)).toBe(true);
  });

  it("stays still for rows drawn on opening a thread or showing earlier ones", () => {
    expect(claimMessageEntrance({ id: "old", at: now - ENTRANCE_WINDOW_MS }, now)).toBe(false);
    expect(claimMessageEntrance({ id: "older", at: now - 86_400_000 }, now)).toBe(false);
    expect(claimMessageEntrance({ id: "no-time", at: Number.NaN }, now)).toBe(false);
  });
});
