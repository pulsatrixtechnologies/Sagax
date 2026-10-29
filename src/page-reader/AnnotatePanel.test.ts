// The comments panel (src/page-reader/AnnotatePanel.tsx): what goes into
// the page's frame, and how long ago.
import { describe, expect, it } from "vitest";

import { ago, frameMarks } from "./AnnotatePanel";
import type { PageThreadView } from "../../shared/page-threads";

const thread = (id: string, resolved = false): PageThreadView => ({
  id, at: 0, by: "pr_x", version: 1, text: "secret words of a reader", replies: [{ id: "r", at: 0, by: "pr_y", text: "a reply" }],
  anchor: { kind: "text", quote: "page words", prefix: "", suffix: "", path: "body", tag: "p" }, mine: false,
  ...(resolved ? { resolved: { at: 1, by: "pr_x" } } : {}),
});

describe("frameMarks", () => {
  it("sends the frame anchors only, never a comment, a reply or a name", () => {
    const marks = frameMarks([thread("a"), thread("b", true)], "a", false);
    expect(marks).toEqual([{ id: "a", anchor: thread("a").anchor, resolved: false, active: true }]);
    expect(JSON.stringify(marks)).not.toMatch(/secret|reply|pr_x/);
    expect(frameMarks([thread("b", true)], null, true)).toHaveLength(1);
  });
});

describe("ago", () => {
  it("minutes, hours, then the date", () => {
    expect(ago(0, 30_000, "fr")).toBe("à l'instant");
    expect(ago(0, 5 * 60_000, "en")).toBe("5 min");
    expect(ago(0, 3 * 3_600_000, "fr")).toBe("3 h");
  });
});
