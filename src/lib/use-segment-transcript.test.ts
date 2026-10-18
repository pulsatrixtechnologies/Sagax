import { describe, expect, it } from "vitest";
import { holdsMessage, prependOlder } from "./use-segment-transcript";
import type { Message } from "@/state/store";

const m = (id: string) => ({ id, role: "bot", kind: "text", text: id, at: 1 }) as Message;

describe("an earlier topic's older pages", () => {
  it("go in front of the messages already held, without duplicates", () => {
    const held = { messages: [m("c"), m("d")], activeLeafId: "d", loaded: true };
    const next = prependOlder(held, [m("a"), m("b"), m("c")]);
    expect(next.messages.map((message) => message.id)).toEqual(["a", "b", "c", "d"]);
    expect(next.activeLeafId).toBe("d");
  });
});

describe("reaching a linked message in an earlier topic", () => {
  it("knows when the message is held, and that no message asks for nothing", () => {
    const held = { messages: [m("c"), m("d")], activeLeafId: "d", loaded: true };
    expect(holdsMessage(held, "c")).toBe(true);
    expect(holdsMessage(held, "a")).toBe(false);
    expect(holdsMessage(held, undefined)).toBe(true);
  });
});
