import { describe, expect, it } from "vitest";

import { approvalLevelPrompt } from "./approval-level-prompt.ts";

describe("what a turn is told about its approval level (2026-10-28)", () => {
  it("Full access acts without asking: no card, no confirmation, no typed GO", () => {
    const text = approvalLevelPrompt("full");
    expect(text).toContain("Full access");
    expect(text).toMatch(/without asking first/);
    expect(text).toMatch(/Never ask the person to type GO/);
    // a plugin's or skill's "operator GO" is answered by the level itself
    expect(text).toMatch(/this approval level is that answer/);
    // only Sagax's own holds remain: Refuse, Ask first, allowed recipients
    expect(text).toMatch(/Refuse or Ask first/);
    expect(text).toMatch(/allowed recipients/);
    // it never tells the bot to wait for or ask for an approval
    expect(text).not.toMatch(/wait(?:s)? for the person's approval card/);
    expect(text).not.toMatch(/ask (?:the person )?(?:for )?(?:a )?confirmation before/i);
  });

  it("below Full the card does the asking, never a typed word", () => {
    for (const level of ["ask", "edits", "auto", "custom"] as const) {
      const text = approvalLevelPrompt(level);
      expect(text, level).toMatch(/approval card/);
      expect(text, level).toMatch(/Never ask the person to type GO/);
      expect(text, level).not.toContain("Full access");
    }
  });

  it("no level, no section; never a dash read as an em dash", () => {
    expect(approvalLevelPrompt(undefined)).toBe("");
    for (const level of ["ask", "edits", "auto", "full", "custom"] as const) expect(approvalLevelPrompt(level)).not.toMatch(/[–—]/);
  });
});
