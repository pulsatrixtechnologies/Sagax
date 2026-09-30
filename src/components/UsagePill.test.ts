import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { UsagePill, usagePillLabel } from "./UsagePill";
import type { TaskUsage } from "@/state/store";

const usage = (percent: number | null, extra: Partial<TaskUsage> = {}): TaskUsage => ({
  input: 480_000,
  output: 12_400,
  cachedInput: 430_000,
  costUsd: 0.21,
  turns: 7,
  lastTurn: { input: 52_000, output: 1_800, cachedInput: 48_000, costUsd: 0.034 },
  ...(percent === null ? {} : { context: { tokens: percent * 2_000, window: 200_000 } }),
  ...extra,
});

const render = (u: TaskUsage, defaultOpen = false) =>
  renderToStaticMarkup(createElement(UsagePill, { usage: u, billing: "metered", onOpen: () => {}, defaultOpen }));

const tone = (html: string) => /data-tone="(\w+)"/.exec(html)?.[1];

describe("UsagePill", () => {
  it("stays hidden until a turn has settled", () => {
    expect(render({ input: 0, output: 0, costUsd: null, turns: 0 })).toBe("");
  });

  it("shows the ring, the percentage and the cost, without the old ctx prefix", () => {
    const html = render(usage(26));
    expect(html).toContain("data-usage-ring");
    expect(html).toContain("data-usage-arc");
    expect(html).toContain(">26%<");
    expect(html).toContain("data-usage-divider");
    expect(html).toContain(">$0.21<");
    expect(html).not.toMatch(/ctx/i);
    expect(html).toContain("h-9");
  });

  it("colours the ring by the shared context tone", () => {
    expect(tone(render(usage(26)))).toBe("quiet");
    expect(tone(render(usage(49)))).toBe("quiet");
    expect(tone(render(usage(50)))).toBe("warning");
    expect(tone(render(usage(75)))).toBe("warning");
    expect(tone(render(usage(79)))).toBe("warning");
    expect(tone(render(usage(80)))).toBe("danger");
    expect(tone(render(usage(95)))).toBe("danger");
    expect(render(usage(26))).toContain("text-accent");
    expect(render(usage(75))).toContain("text-warning");
    expect(render(usage(95))).toContain("text-danger");
  });

  it("fills the arc to the share and caps it at a full ring", () => {
    const offset = (html: string) => Number(/stroke-dashoffset="([\d.]+)"/.exec(html)?.[1]);
    const dash = (html: string) => Number(/stroke-dasharray="([\d.]+)"/.exec(html)?.[1]);
    const quarter = render(usage(25));
    expect(offset(quarter) / dash(quarter)).toBeCloseTo(0.75, 2);
    expect(offset(render(usage(150)))).toBe(0);
  });

  it("names both figures for assistive tech", () => {
    expect(usagePillLabel(usage(26))).toBe("Context 52k (26% of 200k), $0.21 for this conversation");
    expect(render(usage(26))).toContain('aria-label="Context 52k (26% of 200k), $0.21 for this conversation"');
    // no reported cost: the token headline stands in, unlabelled as spend
    expect(usagePillLabel(usage(null, { costUsd: null }))).toBe("50k uncached");
  });

  it("folds the context part away in a narrow header and keeps the cost", () => {
    const html = render(usage(26));
    expect(html).toMatch(/class="[^"]*@max-4xl\/chathead:hidden[^"]*" data-testid="usage-context"/);
    expect(html).toMatch(/data-testid="usage-cost"/);
    expect(html).not.toMatch(/data-testid="usage-cost"[^>]*hidden/);
  });

  it("drops the context part when no model call reported one", () => {
    const html = render(usage(null));
    expect(html).not.toContain("usage-context");
    expect(html).not.toContain("data-usage-ring");
    expect(html).toContain(">$0.21<");
  });

  it("shows raw tokens and an empty track when the window is unknown", () => {
    const html = render(usage(null, { context: { tokens: 142_000 } }));
    expect(html).toContain(">142k<");
    expect(html).toContain("data-usage-ring");
    expect(html).not.toContain("data-usage-arc");
    expect(tone(html)).toBe("quiet");
  });

  it("keeps the card closed until hover or focus", () => {
    const html = render(usage(26));
    expect(html).not.toContain('role="tooltip"');
    expect(html).not.toContain("aria-describedby");
  });

  it("breaks the figures down in the card", () => {
    const html = render(usage(26), true);
    expect(html).toContain('role="tooltip"');
    expect(html).toMatch(/aria-describedby="([^"]+)"[\s\S]*id="\1"/);
    expect(html).toContain("52k / 200k tokens");
    expect(html).toContain("This conversation");
    expect(html).toContain("billed to your API key");
    expect(html).toContain("Last message");
    expect(html).toContain(">$0.03<");
    expect(html).not.toContain("Long thread");
    expect(render(usage(95), true)).toContain("Long thread");
  });
});
