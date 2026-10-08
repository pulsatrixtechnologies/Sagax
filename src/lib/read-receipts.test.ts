import { afterEach, describe, expect, it } from "vitest";

import { setLocale } from "@/lib/i18n";
import { applyReadFrame, botSeenCaption, messageParticipant, seenCaption, seenRows, seenTooltip } from "./read-receipts";

const ALICE = "pr_alice";
const BOB = "pr_bob";
const CAROL = "pr_carol";
const time = (at: number) => `T${at}`;

type Line = { id: string; role: "user" | "bot"; kind: string; from?: { botId: string }; sender?: { id?: string; name: string } };
const room: Line[] = [
  { id: "m1", role: "user", kind: "text", sender: { id: ALICE, name: "Alice" } },
  { id: "m2", role: "bot", kind: "text", from: { botId: "cryptic" } },
  { id: "a1", role: "bot", kind: "activity", from: { botId: "cryptic" } },
  { id: "m3", role: "user", kind: "text", sender: { id: BOB, name: "Bob" } },
];
const byId = new Map(room.map((line) => [line.id, line]));
const authorOf = (id: string) => {
  const line = byId.get(id);
  return line ? messageParticipant(line) : null;
};
const anchorable = new Set(["m1", "m2", "m3"]);

afterEach(() => setLocale("en"));

describe("seenRows", () => {
  it("puts each reader once, under the last drawn line they read, oldest reader first", () => {
    const rows = seenRows({
      order: room,
      anchorable,
      reads: { [BOB]: { messageId: "m2", at: 20 }, "bot:cryptic": { messageId: "m1", at: 10 }, [CAROL]: { messageId: "m2", at: 15 } },
      self: ALICE,
      authorOf,
    });
    expect([...rows.keys()]).toEqual(["m2", "m1"]);
    // two readers on the same line stack, the earlier first
    expect(rows.get("m2")).toEqual([{ participantId: CAROL, at: 15 }, { participantId: BOB, at: 20 }]);
    expect(rows.get("m1")).toEqual([{ participantId: "bot:cryptic", at: 10 }]);
  });

  it("never draws the viewer, whatever the case of their id", () => {
    const rows = seenRows({ order: room, anchorable, reads: { [ALICE.toUpperCase()]: { messageId: "m3", at: 1 } }, self: ALICE, authorOf });
    expect(rows.size).toBe(0);
  });

  it("moves a reader up past lines that are not drawn and past their own lines", () => {
    // the activity chip is not a bubble: the bot's reader row goes to m2...
    const past = seenRows({ order: room, anchorable, reads: { [CAROL]: { messageId: "a1", at: 5 } }, self: ALICE, authorOf });
    expect([...past.keys()]).toEqual(["m2"]);
    // ...and a bot whose position is its own reply sits under what it answered
    const own = seenRows({ order: room, anchorable, reads: { "bot:cryptic": { messageId: "a1", at: 5 } }, self: ALICE, authorOf });
    expect([...own.keys()]).toEqual(["m1"]);
    // Bob at his own message sits under the line before it
    const bob = seenRows({ order: room, anchorable, reads: { [BOB]: { messageId: "m3", at: 5 } }, self: ALICE, authorOf });
    expect([...bob.keys()]).toEqual(["m2"]);
  });

  it("leaves out a position on a message this page has not loaded", () => {
    expect(seenRows({ order: room, anchorable, reads: { [BOB]: { messageId: "older", at: 1 } }, self: ALICE, authorOf }).size).toBe(0);
  });
});

describe("botSeenCaption", () => {
  const chat: Line[] = [
    { id: "u1", role: "user", kind: "text" },
    { id: "b1", role: "bot", kind: "text" },
    { id: "u2", role: "user", kind: "text" },
  ];
  const chatAuthor = (id: string) => {
    const line = chat.find((candidate) => candidate.id === id);
    return line ? messageParticipant(line, "cryptic") : null;
  };
  const users = new Set(["u1", "u2"]);

  it("sits under the last message the bot consumed, until it answers", () => {
    expect(botSeenCaption({ order: chat, anchorable: users, reads: { "bot:cryptic": { messageId: "u2", at: 9 } }, botId: "cryptic", authorOf: chatAuthor }))
      .toEqual({ messageId: "u2", at: 9 });
    // the answer below u1 already says it was seen
    expect(botSeenCaption({ order: chat, anchorable: users, reads: { "bot:cryptic": { messageId: "u1", at: 9 } }, botId: "cryptic", authorOf: chatAuthor })).toBeNull();
    expect(botSeenCaption({ order: chat, anchorable: users, reads: {}, botId: "cryptic", authorOf: chatAuthor })).toBeNull();
  });
});

describe("words", () => {
  it("names every reader with the time in the tooltip", () => {
    expect(seenTooltip([{ name: "Alice", at: 1 }, { name: "Cryptic", at: 2 }], time)).toBe("Seen by Alice at T1, Cryptic at T2");
    setLocale("fr");
    expect(seenTooltip([{ name: "Alice", at: 1 }], time)).toBe("Vu par Alice à T1");
  });

  it("says Seen, and the time once a minute has passed", () => {
    expect(seenCaption(1_000, 30_000, time)).toBe("Seen");
    expect(seenCaption(1_000, 61_000, time)).toBe("Seen at T61000");
  });

  it("takes a live position, and ignores a repeat", () => {
    const reads = { [BOB]: { messageId: "m1", at: 1 } };
    expect(applyReadFrame(reads, BOB, { messageId: "m1", at: 1 })).toBe(reads);
    expect(applyReadFrame(reads, BOB, { messageId: "m2", at: 2 })).toEqual({ [BOB]: { messageId: "m2", at: 2 } });
  });
});
