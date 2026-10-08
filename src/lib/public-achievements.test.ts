import { describe, expect, it } from "vitest";
import { cleanPublicCard } from "./public-achievements";

describe("public achievement cards", () => {
  it("keeps a full card", () => {
    expect(cleanPublicCard({ points: 5, level: 1, title: "rookie", unlocked: [{ id: "first-words", points: 5, unlockedAt: 1 }] }))
      .toEqual({ points: 5, level: 1, title: "rookie", unlocked: [{ id: "first-words", points: 5, unlockedAt: 1 }] });
  });

  it("keeps a card whose person hid the points or the title, without them", () => {
    expect(cleanPublicCard({ unlocked: [{ id: "first-words", points: 5, unlockedAt: 1 }] }))
      .toEqual({ unlocked: [{ id: "first-words", points: 5, unlockedAt: 1 }] });
    expect(cleanPublicCard({ title: "rookie", unlocked: [] })).toEqual({ title: "rookie", unlocked: [] });
  });

  it("still reads an older server's points-only card, and refuses junk", () => {
    expect(cleanPublicCard({ points: 5, level: 1 })).toEqual({ points: 5, level: 1, unlocked: [] });
    expect(cleanPublicCard({ title: "rookie" })).toBeNull();
    expect(cleanPublicCard(null)).toBeNull();
    expect(cleanPublicCard("x")).toBeNull();
  });
});
