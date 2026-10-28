import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { TurnTimingLine, turnTimingLabel } from "./TurnTimingLine";
import { setShowTurnTiming } from "@/lib/turn-timing-preferences";

describe("TurnTimingLine", () => {
  afterEach(() => setShowTurnTiming(false));

  // 2026-10-28: a diagnostic, never part of the conversation by default
  it("shows nothing in the conversation unless the developer setting is on", () => {
    expect(renderToStaticMarkup(createElement(TurnTimingLine, { timing: { queueMs: 421900, firstResponseMs: 29779 } }))).toBe("");
  });

  it("with the developer setting on, shows the wait and the first text only when a number is there", () => {
    setShowTurnTiming(true);
    expect(renderToStaticMarkup(createElement(TurnTimingLine, {}))).toBe("");
    const markup = renderToStaticMarkup(createElement(TurnTimingLine, { timing: { queueMs: 40, firstResponseMs: 160 } }));
    expect(markup).toContain('data-turn-timing=""');
    expect(markup).toContain("Wait before send: 40 ms");
    expect(markup).toContain("First text: 160 ms");
    expect(markup).not.toContain("hello");
  });

  it("words the counters the same way when shown", () => {
    expect(turnTimingLabel({ queueMs: 1 })).toBe("Wait before send: 1 ms");
    expect(turnTimingLabel(undefined)).toBeNull();
  });
});
