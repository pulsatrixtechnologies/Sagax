import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { QUARANTINE, quarantined } from "./quarantine.ts";

const root = new URL("../../", import.meta.url);

describe("the test quarantine", () => {
  it("dates, explains and tracks every entry", () => {
    for (const entry of QUARANTINE) {
      expect(entry.issue, entry.id).toMatch(/^https:\/\/github\.com\/pulsatrixtechnologies\/Sagax\/issues\/\d+$/);
      expect(entry.expires, entry.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.reason.length, entry.id).toBeGreaterThan(10);
      expect(entry.platforms.length, entry.id).toBeGreaterThan(0);
    }
    expect(new Set(QUARANTINE.map((entry) => entry.id)).size).toBe(QUARANTINE.length);
  });

  it("has no expired entry: fix the test or extend it on its issue", () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(QUARANTINE.filter((entry) => entry.expires <= today).map((entry) => `${entry.id} expired ${entry.expires} (${entry.issue})`)).toEqual([]);
  });

  it("is used by the file it names, and only through quarantined()", () => {
    for (const entry of QUARANTINE) {
      expect(readFileSync(new URL(entry.file, root), "utf8"), entry.id).toContain(`quarantined("${entry.id}")`);
    }
  });

  it("applies only on the listed platforms and refuses an unknown id", () => {
    expect(quarantined("acp-qwen-stop-windows", "win32")).toBe(true);
    expect(quarantined("acp-qwen-stop-windows", "linux")).toBe(false);
    expect(() => quarantined("nope")).toThrow(/No quarantine entry/);
  });
});
