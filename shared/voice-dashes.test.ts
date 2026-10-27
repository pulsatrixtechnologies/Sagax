import { describe, expect, it } from "vitest";
import { replaceDashes, voiceDashesEnabled } from "./voice-dashes.ts";

const EM = "\u2014";
const EN = "\u2013";
const fr = (text: string) => replaceDashes(text, "fr");

describe("replaceDashes (#1208)", () => {
  it("turns a dash between two times into a range word", () => {
    expect(fr(`Réunion 09:30 ${EN} 10:30 demain`)).toBe("Réunion 09:30 à 10:30 demain");
    expect(fr(`de 9h${EM}11h30`)).toBe("de 9h à 11h30");
    expect(replaceDashes(`open 09:30 ${EN} 10:30`, "en")).toBe("open 09:30 to 10:30");
  });
  it("turns a dash between two dates into a range word", () => {
    expect(fr(`du 2026-10-26 ${EN} 2026-10-28`)).toBe("du 2026-10-26 à 2026-10-28");
    expect(fr(`du 12 mars ${EM} 14 mars`)).toBe("du 12 mars à 14 mars");
    expect(fr(`lundi ${EN} vendredi`)).toBe("lundi à vendredi");
  });
  it("turns tight numbers into a range word", () => {
    expect(fr(`5${EN}10 minutes`)).toBe("5 à 10 minutes");
    expect(fr(`1.5${EN}2.5 Go`)).toBe("1.5 à 2.5 Go");
  });
  it("treats a spaced dash between plain numbers as an aside", () => {
    expect(fr(`Projet 801 ${EM} 17 phases`)).toBe("Projet 801, 17 phases");
  });
  it("turns a dash after a list item label into a colon", () => {
    expect(fr(`- **Nom** ${EM} la description`)).toBe("- **Nom** : la description");
    expect(replaceDashes(`1. Name ${EM} what it does`, "en")).toBe("1. Name: what it does");
  });
  it("turns any other dash into a comma", () => {
    expect(fr(`Il est parti ${EM} sans rien dire ${EM} hier.`)).toBe("Il est parti, sans rien dire, hier.");
    expect(fr(`mot${EM}mot`)).toBe("mot, mot");
    expect(fr(`fini, ${EM} voilà`)).toBe("fini, voilà");
    expect(fr(`fin ${EM}`)).toBe("fin");
  });
  it("makes a dash opening a line a list marker", () => {
    expect(fr(`${EM} un\n${EM} deux`)).toBe("- un\n- deux");
  });
  it("keeps code, inline code and links untouched", () => {
    const text = `avant ${EM} \`a ${EM} b\` et\n\`\`\`\nx ${EM} y 5${EN}10\n\`\`\`\n[lien](https://ex.com/a${EN}b) fin`;
    expect(fr(text)).toBe(`avant, \`a ${EM} b\` et\n\`\`\`\nx ${EM} y 5${EN}10\n\`\`\`\n[lien](https://ex.com/a${EN}b) fin`);
    expect(fr(`~~~\n${EM}\n~~~\nz ${EM} y`)).toBe(`~~~\n${EM}\n~~~\nz, y`);
  });
  it("keeps an empty table cell and plain text as they are", () => {
    expect(fr(`| a | ${EM} |`)).toBe("| a | - |");
    expect(fr("rien à changer - ici")).toBe("rien à changer - ici");
  });
});

describe("voiceDashesEnabled", () => {
  it("follows the choice, else French", () => {
    expect(voiceDashesEnabled("on", "en")).toBe(true);
    expect(voiceDashesEnabled("off", "fr-CA")).toBe(false);
    expect(voiceDashesEnabled(undefined, "fr-CA")).toBe(true);
    expect(voiceDashesEnabled(undefined, "en")).toBe(false);
    expect(voiceDashesEnabled(undefined, "")).toBe(false);
  });
});
