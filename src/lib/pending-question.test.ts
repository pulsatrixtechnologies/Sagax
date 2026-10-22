import { describe, expect, it } from "vitest";

import type { Message } from "@/state/store";
import { autoDismissSecondsLeft, pendingQuestions } from "./pending-question";

const question = (id: string, card: Record<string, unknown> = {}): Message =>
  ({ id, at: 1, role: "bot", kind: "options", card: { title: "q", options: [], requestId: `r-${id}`, questionRequest: { version: 1, questions: [] }, ...card } }) as unknown as Message;

describe("pendingQuestions", () => {
  it("keeps only open question cards", () => {
    const list = [
      question("a"),
      question("b", { answered: "answer" }),
      question("c", { dismissed: true }),
      question("d", { expired: true }),
      question("e", { tool: "Bash", questionRequest: undefined }),
      { id: "f", at: 1, role: "bot", kind: "text", text: "hi" } as Message,
    ];
    expect(pendingQuestions(list).map((m) => m.id)).toEqual(["a"]);
  });
});

describe("autoDismissSecondsLeft", () => {
  it("rounds up, floors at zero, and is null without a deadline", () => {
    expect(autoDismissSecondsLeft(undefined, 0)).toBeNull();
    expect(autoDismissSecondsLeft(10_001, 0)).toBe(11);
    expect(autoDismissSecondsLeft(5_000, 9_000)).toBe(0);
  });
});
