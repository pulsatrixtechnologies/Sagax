import { describe, expect, it } from "vitest";

import { foldForSearch, paletteMatchTier, rankByName, rankFuzzy } from "./palette-rank";

const names = (items: Array<{ name: string }>) => items.map((i) => i.name);

describe("rankByName", () => {
  it("puts prefix matches above substring matches", () => {
    const items = [{ name: "Big Momo" }, { name: "Momo" }, { name: "Lemon Momo" }];
    expect(names(rankByName(items, "mo"))).toEqual(["Momo", "Big Momo", "Lemon Momo"]);
  });

  it("matches case-insensitively on both sides", () => {
    const items = [{ name: "MOSS" }, { name: "quiet moss" }];
    expect(names(rankByName(items, "Moss"))).toEqual(["MOSS", "quiet moss"]);
  });

  it("keeps input order within a tier", () => {
    const items = [{ name: "Miso One" }, { name: "Miso Two" }, { name: "A Miso" }, { name: "B Miso" }];
    expect(names(rankByName(items, "miso"))).toEqual(["Miso One", "Miso Two", "A Miso", "B Miso"]);
  });

  it("filters out non-matches", () => {
    const items = [{ name: "Momo" }, { name: "Moss" }];
    expect(rankByName(items, "zebra")).toEqual([]);
    expect(names(rankByName(items, "oss"))).toEqual(["Moss"]);
  });

  it("returns everything in input order for an empty or whitespace query", () => {
    const items = [{ name: "Momo" }, { name: "Moss" }];
    expect(names(rankByName(items, ""))).toEqual(["Momo", "Moss"]);
    expect(names(rankByName(items, "   "))).toEqual(["Momo", "Moss"]);
  });
});

describe("paletteMatchTier and rankFuzzy", () => {
  it("folds accents and case", () => {
    expect(paletteMatchTier("Réglages", "regl")).toBe(0);
    expect(foldForSearch("Écran Été")).toBe("ecran ete");
  });

  it("ranks prefix, word start, substring, search words, then letters in order", () => {
    expect(paletteMatchTier("New conversation", "new")).toBe(0);
    expect(paletteMatchTier("New conversation", "conv")).toBe(1);
    expect(paletteMatchTier("Keyboard shortcuts", "board")).toBe(2);
    expect(paletteMatchTier("Team map", "canvas", ["canvas"])).toBe(3);
    expect(paletteMatchTier("Nouvelle conversation", "nvconv")).toBe(4);
    expect(paletteMatchTier("Team map", "zebra")).toBeNull();
  });

  it("keeps input order inside a tier and drops non-matches", () => {
    const items = [{ label: "Big Momo" }, { label: "Momo" }, { label: "Mxoxmxo" }, { label: "Moss" }];
    const ranked = rankFuzzy(items, "momo", (item) => ({ label: item.label }));
    expect(ranked.map((item) => item.label)).toEqual(["Momo", "Big Momo", "Mxoxmxo"]);
    expect(rankFuzzy(items, " ", (item) => ({ label: item.label }))).toEqual(items);
  });
});
