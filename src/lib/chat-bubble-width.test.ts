import { describe, expect, it } from "vitest";

import { CHAT_BUBBLE_WIDTH_CLASS, chatBubbleWidth } from "./chat-bubble-width";

describe("chat bubble width", () => {
  it("gives a terminal the whole transcript column, not a bubble's width", () => {
    expect(chatBubbleWidth({ terminal: true, wide: false })).toBe("column");
    expect(CHAT_BUBBLE_WIDTH_CLASS.column).toContain("w-full");
    expect(CHAT_BUBBLE_WIDTH_CLASS.column).not.toMatch(/\d+px,/);
  });

  it("keeps prose narrow and rich blocks wide", () => {
    expect(chatBubbleWidth({ terminal: false, wide: false })).toBe("fit");
    expect(chatBubbleWidth({ terminal: false, wide: true })).toBe("wide");
  });
});
