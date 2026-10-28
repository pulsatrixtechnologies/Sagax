import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TurnTimingLine } from "./TurnTimingLine";

describe("TurnTimingLine", () => {
  it("shows the wait and the first text only when a number is there", () => {
    expect(renderToStaticMarkup(createElement(TurnTimingLine, {}))).toBe("");
    const markup = renderToStaticMarkup(createElement(TurnTimingLine, { timing: { queueMs: 40, firstResponseMs: 160 } }));
    expect(markup).toContain('data-turn-timing=""');
    expect(markup).toContain("Wait before send: 40 ms");
    expect(markup).toContain("First text: 160 ms");
    expect(markup).not.toContain("hello");
  });
});
