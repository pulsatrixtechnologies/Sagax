import { describe, expect, it } from "vitest";

import { attachCandidates } from "./InterimPeople";

describe("interim attach picker", () => {
  it("offers active people only, by name", () => {
    const person = (principalId: string, name: string, disabled = false) => ({ principalId, name, login: name.toLowerCase(), role: "member" as const, disabled });
    expect(attachCandidates([person("b", "Zoe"), person("a", "Eve"), person("c", "Mallory", true)]).map((p) => p.principalId)).toEqual(["a", "b"]);
  });
});
