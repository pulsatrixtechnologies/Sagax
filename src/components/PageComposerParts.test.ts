// The line over the floating composer while a page is open: the bot working,
// or its newest answer since the page was opened, in one line.
import { describe, expect, it } from "vitest";

import { pageBotStatusLine } from "./PageComposerParts";

const bot = (text: string, at: number) => ({ role: "bot" as const, kind: "text" as const, text, at });
const user = (text: string, at: number) => ({ role: "user" as const, kind: "text" as const, text, at });

describe("pageBotStatusLine", () => {
  it("says the bot is on it while it works", () => {
    expect(pageBotStatusLine([bot("old", 1)], true, 5)).toEqual({ kind: "working" });
  });

  it("shows the newest answer after the page was opened, in one line, words kept whole", () => {
    expect(pageBotStatusLine([user("x", 6), bot("**Got it**, the `summary_table`\nis shorter", 7)], false, 5)).toEqual({ kind: "reply", text: "Got it, the summary_table is shorter" });
  });

  it("shows nothing for an answer from before the page was opened", () => {
    expect(pageBotStatusLine([bot("earlier", 1)], false, 5)).toBeNull();
    expect(pageBotStatusLine([], false, 5)).toBeNull();
  });

  it("cuts a long answer", () => {
    const line = pageBotStatusLine([bot("x".repeat(400), 9)], false, 5);
    expect(line?.kind === "reply" && line.text.length).toBe(160);
  });
});
