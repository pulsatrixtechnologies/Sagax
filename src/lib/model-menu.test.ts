import { describe, expect, it } from "vitest";

import { activeRowKey, filterModelSections, foldSearch, pickableRows, stepRow, type ModelMenuRow, type ModelMenuSection } from "./model-menu";

const model = (key: string, label: string, extra: Partial<ModelMenuRow> = {}): ModelMenuRow => ({ key, kind: "model", modelId: key, label, current: false, ...extra });
const sections: ModelMenuSection[] = [
  { key: "top", rows: [{ key: "auto", kind: "auto", label: "Auto", detail: "le meilleur modèle par tâche", current: false }] },
  { key: "claude", label: "Claude", rows: [model("opus", "Claude Opus 5.5", { detail: "Élevé" }), model("sonnet", "Claude Sonnet 5", { current: true, tags: ["Par défaut"] })] },
  { key: "grok", label: "Grok", rows: [model("grok-4.7", "Grok 4.7"), model("local", "DwarfStar: Qwen", { unavailable: "Grok cannot run it." })] },
];

describe("the model menu's search", () => {
  it("folds case and accents", () => {
    expect(foldSearch("Élevé")).toBe("eleve");
  });

  it("keeps everything for an empty query and drops empty sections", () => {
    expect(filterModelSections(sections, "  ")).toEqual(sections);
    expect(filterModelSections([...sections, { key: "empty", label: "Empty", rows: [] }], "")).toHaveLength(3);
  });

  it("matches every word against the name, the detail, the tags, the id and the engine", () => {
    expect(filterModelSections(sections, "opus").flatMap((section) => section.rows.map((row) => row.key))).toEqual(["opus"]);
    expect(filterModelSections(sections, "claude eleve").flatMap((section) => section.rows.map((row) => row.key))).toEqual(["opus"]);
    expect(filterModelSections(sections, "grok").flatMap((section) => section.rows.map((row) => row.key))).toEqual(["grok-4.7", "local"]);
    expect(filterModelSections(sections, "par defaut").flatMap((section) => section.rows.map((row) => row.key))).toEqual(["sonnet"]);
    expect(filterModelSections(sections, "nothing like it")).toEqual([]);
  });
});

describe("the model menu's keys", () => {
  const rows = pickableRows(sections);

  it("skips rows that cannot be picked", () => {
    expect(rows.map((row) => row.key)).toEqual(["auto", "opus", "sonnet", "grok-4.7"]);
  });

  it("starts on the current choice, or the first match while searching", () => {
    expect(activeRowKey(rows, null, false)).toBe("sonnet");
    expect(activeRowKey(rows, null, true)).toBe("auto");
    expect(activeRowKey(rows, "opus", false)).toBe("opus");
    // a row the search filtered out is forgotten
    expect(activeRowKey(rows.slice(0, 2), "grok-4.7", true)).toBe("auto");
    expect(activeRowKey([], null, false)).toBeNull();
  });

  it("moves with the arrows and wraps at both ends", () => {
    expect(stepRow(rows, "sonnet", "ArrowDown")).toBe("grok-4.7");
    expect(stepRow(rows, "grok-4.7", "ArrowDown")).toBe("auto");
    expect(stepRow(rows, "auto", "ArrowUp")).toBe("grok-4.7");
    expect(stepRow(rows, null, "ArrowDown")).toBe("auto");
    expect(stepRow(rows, "opus", "End")).toBe("grok-4.7");
    expect(stepRow(rows, "opus", "Home")).toBe("auto");
    expect(stepRow([], null, "ArrowDown")).toBeNull();
  });
});
