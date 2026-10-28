import { afterEach, describe, expect, it } from "vitest";

import { buildRecall } from "./recall.ts";
import { SEMANTIC_RECALL_MISSING, fusePassages, semanticPassages, setSemanticIndex, type SemanticIndex } from "./semantic-recall.ts";

afterEach(() => setSemanticIndex(null));

const lexical = [
  { source: "memory" as const, label: "memory/notes.md", snippet: "the invoice is in the drawer" },
];

describe("optional local semantic recall", () => {
  it("keeps FTS5 in front and adds only a new label", () => {
    const fused = fusePassages(lexical, [
      { source: "memory", label: "memory/notes.md", snippet: "same file, ignore" },
      { source: "memory", label: "memory/places.md", snippet: "the quiet room upstairs" },
    ], 4);
    expect(fused.map((passage) => passage.label)).toEqual(["memory/notes.md", "memory/places.md"]);
    expect(fused[0]?.snippet).toBe("the invoice is in the drawer");
  });

  it("stays on FTS5 when no local index is ready, and says what vectors need", () => {
    expect(semanticPassages("bot-a", "where is the quiet room", 4)).toEqual([]);
    expect(SEMANTIC_RECALL_MISSING).toMatch(/FTS5/);
    expect(SEMANTIC_RECALL_MISSING).not.toMatch(/https?:/);
    const input = { botId: "bot-missing", message: "where is the invoice?", threadIds: [] as string[], label: () => "", author: () => "" };
    expect(buildRecall({ ...input, semantic: true })).toEqual(buildRecall(input));
  });

  it("appends a ready local hit and never pulls a conversation into a turn that has none", () => {
    const local: SemanticIndex = {
      ready: (botId) => botId === "bot-a",
      search: () => [
        { source: "memory", label: "memory/places.md", snippet: "the quiet room upstairs", score: 0.5 },
        { source: "conversation", label: "chat private", snippet: "a private aside", score: 0.9 },
      ],
    };
    setSemanticIndex(local);
    const block = buildRecall({
      botId: "bot-a",
      message: "where is the quiet room tonight",
      threadIds: [],
      label: () => "",
      author: () => "",
      semantic: true,
    });
    expect(block?.text).toContain("quiet room upstairs");
    expect(block?.text).not.toContain("private aside");
    expect(buildRecall({
      botId: "bot-a",
      message: "where is the quiet room tonight",
      threadIds: [],
      label: () => "",
      author: () => "",
    })?.text ?? "").not.toContain("quiet room");
  });
});
