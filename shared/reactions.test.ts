import { describe, expect, it } from "vitest";

import { applyReaction, botReactionActorId, normalizeReactions, QUICK_REACTIONS, reactionEmoji, reactionsBy, type ReactionActor } from "./reactions.ts";

const ALICE: ReactionActor = { id: "pr_alice", kind: "person", name: "Alice" };
const BOB: ReactionActor = { id: "pr_bob", kind: "person", name: "Bob" };
const CRYPTIC: ReactionActor = { id: botReactionActorId("cryptic"), kind: "bot", name: "Cryptic" };

describe("reactionEmoji", () => {
  it("takes every quick reaction and real emoji sequences", () => {
    for (const emoji of QUICK_REACTIONS) expect(reactionEmoji(emoji)).toBe(emoji);
    expect(reactionEmoji(" 👍🏽 ")).toBe("👍🏽");
    expect(reactionEmoji("👩‍💻")).toBe("👩‍💻");
    expect(reactionEmoji("🇨🇦")).toBe("🇨🇦");
    expect(reactionEmoji("1️⃣")).toBe("1️⃣");
  });

  it("refuses text, markup, emptiness and runaway sequences", () => {
    for (const bad of ["", " ", "ok", "+1", "<b>👍</b>", "👍 nice", "1", "#", 42, null, undefined, "👍".repeat(20)]) {
      expect(reactionEmoji(bad)).toBeNull();
    }
  });
});

describe("applyReaction", () => {
  it("toggles one actor's own reaction and keeps the others'", () => {
    const one = applyReaction([], "👍", BOB, "toggle", 10);
    expect(one).toEqual({ reactions: [{ emoji: "👍", actors: [BOB], at: 10 }], changed: true, added: true });
    const two = applyReaction(one.reactions, "👍", ALICE, "toggle", 20);
    expect(two.reactions).toEqual([{ emoji: "👍", actors: [BOB, ALICE], at: 10 }]);
    const back = applyReaction(two.reactions, "👍", ALICE, "toggle", 30);
    expect(back).toMatchObject({ changed: true, added: false, reactions: [{ emoji: "👍", actors: [BOB], at: 10 }] });
    expect(applyReaction(back.reactions, "👍", BOB, "toggle", 40).reactions).toEqual([]);
  });

  it("adds and removes without toggling, and reports a no-op", () => {
    const added = applyReaction([], "✅", CRYPTIC, "add", 1);
    expect(applyReaction(added.reactions, "✅", CRYPTIC, "add", 2)).toMatchObject({ changed: false });
    expect(applyReaction(added.reactions, "👀", CRYPTIC, "remove", 2)).toMatchObject({ changed: false });
    expect(applyReaction(added.reactions, "✅", CRYPTIC, "remove", 2)).toMatchObject({ changed: true, reactions: [] });
  });

  it("caps the distinct emojis of one message", () => {
    let reactions = applyReaction([], "😀", ALICE, "add", 0).reactions;
    const faces = ["😁", "😂", "🤣", "😃", "😄", "😅", "😆", "😉", "😊", "😋", "😎", "😍", "😘", "🥰", "😗", "😙", "😚", "🙂", "🤗", "🤩", "🤔", "🤨", "😐"];
    for (const face of faces) reactions = applyReaction(reactions, face, ALICE, "add", 0).reactions;
    expect(reactions).toHaveLength(24);
    expect(applyReaction(reactions, "😶", ALICE, "add", 0)).toMatchObject({ changed: false, full: true });
    // an existing emoji still takes more people
    expect(applyReaction(reactions, "😀", BOB, "add", 0).changed).toBe(true);
  });
});

describe("normalizeReactions", () => {
  it("reads the stored shape and drops what is malformed", () => {
    expect(normalizeReactions([
      { emoji: "👍", actors: [BOB, { id: "bot:cryptic", name: "Cryptic" }, { name: "nobody" }], at: 5 },
      { emoji: "nope", actors: [ALICE], at: 6 },
      { emoji: "🎉", actors: [], at: 7 },
      "junk",
    ])).toEqual([{ emoji: "👍", actors: [BOB, CRYPTIC], at: 5 }]);
    expect(normalizeReactions(undefined)).toEqual([]);
  });

  it("merges legacy { emoji, by } entries by emoji, naming the desktop's person when known", () => {
    const legacy = [{ emoji: "👍", by: "user" }, { emoji: "👍", by: "cryptic" }, { emoji: "❤️", by: "user" }];
    expect(normalizeReactions(legacy)).toEqual([
      { emoji: "👍", actors: [{ id: "user", kind: "person", name: "" }, { id: "bot:cryptic", kind: "bot", name: "cryptic" }], at: 0 },
      { emoji: "❤️", actors: [{ id: "user", kind: "person", name: "" }], at: 0 },
    ]);
    expect(normalizeReactions(legacy, ALICE)[0]!.actors[0]).toEqual(ALICE);
    expect(reactionsBy(normalizeReactions(legacy, ALICE), ALICE.id)).toEqual(["👍", "❤️"]);
  });
});
