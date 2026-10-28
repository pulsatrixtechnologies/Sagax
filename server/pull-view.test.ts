import { describe, expect, it } from "vitest";
import { failedActionRuns, parsePullView } from "./pull-view.ts";

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

  it("reads auto-merge and the head branch only when the forge named them", () => {
    expect(parsePullView(JSON.stringify({ ...view, autoMergeRequest: { enabledAt: "t" }, headRefName: "fix/sso" }), 12)).toMatchObject({
      autoMerge: true, head: "fix/sso",
    });
    expect(parsePullView(JSON.stringify({ ...view, autoMergeRequest: null, headRefName: "../main" }), 12)).not.toHaveProperty("autoMerge");
    expect(parsePullView(JSON.stringify({ ...view, headRefName: "../main" }), 12)).not.toHaveProperty("head");
  });
});

describe("failed action runs", () => {
  it("keeps the Actions run id of a failed check and skips the rest", () => {
    const stdout = JSON.stringify({
      statusCheckRollup: [
        { conclusion: "FAILURE", detailsUrl: "https://github.com/acme/app/actions/runs/99/job/1" },
        { conclusion: "SUCCESS", detailsUrl: "https://github.com/acme/app/actions/runs/100/job/2" },
        { conclusion: "FAILURE", detailsUrl: "https://ci.example.test/build/3" },
      ],
    });
    expect(failedActionRuns(stdout)).toEqual(["99"]);
    expect(failedActionRuns("{}")).toEqual([]);
  });
});
