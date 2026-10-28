import { describe, expect, it } from "vitest";
import { introAdvance, introTaskCard } from "./intro-tour.ts";

describe("intro tour", () => {
  it("asks what to start with, then how to act, then closes", () => {
    const first = introTaskCard("en");
    expect(first.card.options).toContain("A project");
    const messages = [{ role: "bot" as const, kind: "text" as const, text: "Hi" }, { role: "bot" as const, kind: "options" as const, card: first.card }];
    const next = introAdvance(messages, "A project");
    expect(next?.kind).toBe("card");
    if (next?.kind !== "card") return;
    const after = [...messages, { role: "user" as const, kind: "text" as const, text: "A project" }, { role: "bot" as const, kind: "options" as const, card: next.card }];
    const done = introAdvance(after, "Ask me first");
    expect(done).toMatchObject({ kind: "done" });
    if (done?.kind === "done") expect(done.text).toContain("A project");
    expect(introAdvance(messages, "something I typed")).toBeNull();
  });

  it("asks in French when the card is French", () => {
    const first = introTaskCard("fr");
    const next = introAdvance([{ role: "bot", kind: "options", card: first.card }], "Un projet");
    expect(next?.kind).toBe("card");
    if (next?.kind !== "card") return;
    expect(next.card.title).toBe("Comment je dois agir?");
  });
});
