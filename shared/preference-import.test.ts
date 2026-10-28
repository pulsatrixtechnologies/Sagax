import { describe, expect, it } from "vitest";

import { applyPreferenceImport, parsePreferenceLines, previewPreferenceImport } from "./preference-import.ts";

describe("preference import", () => {
  it("adds a new line, leaves a match, and replaces a conflict only when that line is accepted", () => {
    const existing = parsePreferenceLines("Langue: francais\nTon: court");
    const incoming = parsePreferenceLines("Langue: francais\nTon: detaille\nHeure: matin");
    const preview = previewPreferenceImport(existing, incoming);
    expect(preview.map((line) => line.kind)).toEqual(["same", "conflict", "add"]);
    const conflict = preview.find((line) => line.kind === "conflict");
    const added = preview.find((line) => line.kind === "add");
    if (!conflict || !added) throw new Error("preview");
    const refused = applyPreferenceImport(existing, preview, new Set([added.id]));
    expect(refused.map((item) => item.text)).toEqual(["Langue: francais", "Ton: court", "Heure: matin"]);
    const agreed = applyPreferenceImport(existing, preview, new Set([conflict.id, added.id]));
    expect(agreed.map((item) => item.text)).toEqual(["Langue: francais", "Ton: detaille", "Heure: matin"]);
  });

  it("does not write a line the paste did not contain", () => {
    const existing = parsePreferenceLines("Reste: ici");
    const preview = previewPreferenceImport(existing, parsePreferenceLines("Autre: chose"));
    const next = applyPreferenceImport(existing, preview, new Set(["pref_not_in_the_card"]));
    expect(next).toEqual(existing);
  });
});
