import { describe, expect, it } from "vitest";
import { normalizePersonLabel, PERSON_LABEL_MAX } from "./person-label.ts";

describe("normalizePersonLabel", () => {
  it("trims and keeps a one-line label", () => {
    expect(normalizePersonLabel("  CTO ")).toEqual({ ok: true, label: "CTO" });
  });

  it("clears with null, undefined or blank text", () => {
    expect(normalizePersonLabel(null)).toEqual({ ok: true, label: null });
    expect(normalizePersonLabel(undefined)).toEqual({ ok: true, label: null });
    expect(normalizePersonLabel("   ")).toEqual({ ok: true, label: null });
  });

  it("refuses a line break, a control character, a non-string and more than 40 characters", () => {
    expect(normalizePersonLabel("CTO\nCFO")).toEqual({ ok: false, code: "label_one_line" });
    expect(normalizePersonLabel("A\u0007")).toEqual({ ok: false, code: "label_one_line" });
    expect(normalizePersonLabel(42)).toEqual({ ok: false, code: "label_type" });
    expect(normalizePersonLabel("x".repeat(PERSON_LABEL_MAX + 1))).toEqual({ ok: false, code: "label_too_long" });
    expect(normalizePersonLabel("x".repeat(PERSON_LABEL_MAX))).toEqual({ ok: true, label: "x".repeat(PERSON_LABEL_MAX) });
  });

  it("counts characters, not UTF-16 units", () => {
    const label = "\u{1F680}".repeat(PERSON_LABEL_MAX);
    expect(normalizePersonLabel(label)).toEqual({ ok: true, label });
  });
});
