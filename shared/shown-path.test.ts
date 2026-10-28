import { describe, expect, it } from "vitest";

import { planShownPath } from "./shown-path.ts";
import type { TeachStep } from "./teach-recording.ts";

const steps: TeachStep[] = [{ id: "1", kind: "note", text: "Check the total." }];

describe("planShownPath", () => {
  it("previews a replayable skill and says when the name is taken", () => {
    const fresh = planShownPath({ title: "Weekly total", description: "Read the total", steps }, "preview", new Set());
    expect(fresh).toMatchObject({ action: "preview", name: "weekly-total", exists: false });
    if (fresh.action === "preview") expect(fresh.markdown).toContain("Check the total.");
    const taken = planShownPath({ title: "Weekly total", steps }, "preview", new Set(["weekly-total"]));
    expect(taken).toMatchObject({ action: "preview", exists: true });
  });

  it("refuses without writing a plan to save", () => {
    expect(planShownPath({ title: "Weekly total", steps }, "refuse", new Set(["weekly-total"]))).toEqual({ action: "refused" });
  });

  it("does not replace an existing skill unless the person agrees", () => {
    const names = new Set(["weekly-total", "uploaded-one"]);
    expect(planShownPath({ title: "Weekly total", steps }, "save", names)).toEqual({ action: "needs-agreement", name: "weekly-total" });
    const agreed = planShownPath({ title: "Weekly total", steps, replace: true }, "save", names);
    expect(agreed).toMatchObject({ action: "save", name: "weekly-total", replace: true });
    expect(planShownPath({ title: "New path", steps }, "save", names)).toMatchObject({ action: "save", name: "new-path", replace: false });
  });

  it("rejects an empty title or an empty step list", () => {
    expect(planShownPath({ title: "  ", steps }, "save", new Set())).toMatchObject({ action: "invalid" });
    expect(planShownPath({ title: "Weekly total", steps: [] }, "save", new Set())).toMatchObject({ action: "invalid" });
  });
});
