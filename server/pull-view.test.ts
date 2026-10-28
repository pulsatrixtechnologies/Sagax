import { describe, expect, it } from "vitest";
import { parsePullView } from "./pull-view.ts";

const view = { number: 12, additions: 10, deletions: 2, state: "OPEN", isDraft: false, url: "https://github.com/acme/app/pull/12" };

describe("pull view", () => {
  it("reads the forge's counts and state, and nothing it did not say", () => {
    expect(parsePullView(JSON.stringify(view), 12)).toEqual({
      number: 12, additions: 10, deletions: 2, state: "open", url: "https://github.com/acme/app/pull/12",
    });
    const partial = { ...view };
    delete (partial as { additions?: number }).additions;
    expect(parsePullView(JSON.stringify(partial), 12)).not.toHaveProperty("additions");
  });

  it("refuses a different pull request, a draft flag only when true, and junk", () => {
    expect(parsePullView(JSON.stringify({ ...view, isDraft: true }), 12)?.draft).toBe(true);
    expect(parsePullView(JSON.stringify(view), 9)).toBeUndefined();
    expect(parsePullView("not json")).toBeUndefined();
    expect(parsePullView(JSON.stringify({ ...view, state: "UNKNOWN" }))).toBeUndefined();
  });
});
