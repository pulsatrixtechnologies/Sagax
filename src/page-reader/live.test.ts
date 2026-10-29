// Live presence in the reader's bar (src/page-reader/live.ts).
import { describe, expect, it } from "vitest";

import { othersHere, parsePresence } from "./live";

describe("presence", () => {
  it("keeps well-formed people only, and never shows the reader themself", () => {
    const people = parsePresence({ people: [{ id: "pr_me", name: "Me" }, { id: "pr_b", name: "B".repeat(200) }, { id: 3 }, null] })!;
    expect(people).toEqual([{ id: "pr_me", name: "Me" }, { id: "pr_b", name: "B".repeat(80) }]);
    expect(othersHere(people, "PR_ME").map((person) => person.id)).toEqual(["pr_b"]);
    expect(parsePresence({})).toBeNull();
  });
});
