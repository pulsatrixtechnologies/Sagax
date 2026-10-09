import { describe, expect, it } from "vitest";
import { nameFilter } from "./name-filter.mjs";

describe("nameFilter", () => {
  it("keeps the names that contain any of the words", () => {
    const only = nameFilter("chat|panel")!;
    expect(["main", "chat-room", "settings-panel", "onboarding"].filter(only)).toEqual(["chat-room", "settings-panel"]);
    expect(nameFilter(undefined)).toBeNull();
    expect(nameFilter("  ")).toBeNull();
    expect(nameFilter("|")).toBeNull();
  });

  it("treats regular expression syntax as plain text, so it cannot widen or stall the match", () => {
    expect(nameFilter(".*")!("chat")).toBe(false);
    expect(nameFilter("(a+)+$")!("a".repeat(5000) + "!")).toBe(false);
    expect(nameFilter("[")!("chat[1]")).toBe(true);
  });

  it("refuses an oversized filter", () => {
    expect(() => nameFilter("x".repeat(101))).toThrow(/at most/);
    expect(() => nameFilter(Array.from({ length: 33 }, (_, i) => `w${i}`).join("|"))).toThrow(/at most/);
  });
});
