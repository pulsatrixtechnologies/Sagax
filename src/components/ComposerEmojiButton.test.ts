// The composer's emoji button inserts at the caret or over the selection.
import { describe, expect, it } from "vitest";

import { insertEmoji } from "./ComposerEmojiButton";

describe("insertEmoji", () => {
  it("inserts at the caret and moves the caret after the emoji", () => {
    expect(insertEmoji("Bon matin", "☀️", 3)).toEqual({ text: "Bon☀️ matin", caret: 5 });
  });
  it("replaces the selection", () => {
    expect(insertEmoji("Merci beaucoup", "🙏", 6, 14)).toEqual({ text: "Merci 🙏", caret: 8 });
  });
  it("clamps a stale caret to the text", () => {
    expect(insertEmoji("ok", "👍", 40)).toEqual({ text: "ok👍", caret: 4 });
  });
});
