// The reader's bar (shared/page-reader.ts): what its script accepts from the
// wrapper, and its words in both languages.
import { describe, expect, it } from "vitest";

import { parseReaderBoot, READER_STRING_KEYS, READER_STRINGS_FR_KEYS, readerNotice, readerText } from "./page-reader.ts";

const BOOT = { v: 1, lang: "fr", title: "Rapport", kind: "html", version: 2, pageId: "page_12345678", me: { id: "pr_x", name: "X" }, owner: { name: "X" }, can: { share: true } };

describe("parseReaderBoot", () => {
  it("keeps a well-formed block", () => {
    expect(parseReaderBoot(BOOT)).toEqual(BOOT);
  });

  it("a right without the page's id is no right", () => {
    const { pageId: _gone, ...rest } = BOOT;
    expect(parseReaderBoot(rest)!.can.share).toBe(false);
    expect(parseReaderBoot({ ...BOOT, pageId: "../x" })!.can.share).toBe(false);
  });

  it("refuses anything else", () => {
    for (const bad of [null, [], "x", { ...BOOT, v: 2 }, { ...BOOT, lang: "de" }, { ...BOOT, kind: "pdf" }, { ...BOOT, version: 0 }, { ...BOOT, title: 3 }]) {
      expect(parseReaderBoot(bad)).toBeNull();
    }
  });
});

describe("the bar's words", () => {
  it("the notice keeps every word of the old banner", () => {
    expect(readerNotice({ bot: "Scout", person: "P", lang: "en" })).toEqual({ who: "Page published by Scout for P", warning: "This is not a Sagax screen, never enter a password here." });
    expect(readerNotice({ bot: "Scout", person: "P", lang: "fr" }).warning).toBe("Ceci n'est pas un écran Sagax, n'y entrez jamais de mot de passe.");
  });

  it("every key has French and English, with the same placeholders", () => {
    expect([...READER_STRINGS_FR_KEYS].sort()).toEqual([...READER_STRING_KEYS].sort());
    for (const key of READER_STRING_KEYS) {
      const names = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
      expect(names(readerText("fr", key))).toEqual(names(readerText("en", key)));
    }
    expect(readerText("en", "shareTitle", { title: "R" })).toBe("Share “R”");
  });
});
