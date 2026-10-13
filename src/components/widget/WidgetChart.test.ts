// The chart is plain SVG drawn from the rows: one mark for every value of
// every series, in colours that come from the skin.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WIDGET_SAMPLES } from "../../../shared/widget-samples";
import { parseWidgetInput, type WidgetNode } from "../../../shared/widget";
import { WIDGET_SERIES_COLORS, WidgetChart } from "./WidgetChart";

const data = [
  { day: "Mon", a: 4, b: 1 }, { day: "Tue", a: 6, b: 2 }, { day: "Wed", a: 9, b: 3 }, { day: "Thu", a: 5, b: 0 }, { day: "Fri", a: 2, b: 4 },
];

/** A canonical Chart node, by way of the normaliser a bot's input goes through. */
function chart(props: Record<string, unknown>): WidgetNode {
  const parsed = parseWidgetInput({ type: "Card", children: [{ type: "Chart", xAxis: "day", data, ...props }] });
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value.children![0]!;
}

const draw = (node: WidgetNode) => renderToStaticMarkup(createElement(WidgetChart, { node }));
const count = (markup: string, piece: string) => markup.split(piece).length - 1;
const two = (type: string, more: Record<string, unknown> = {}) => chart({ series: [{ type, dataKey: "a", label: "Alpha", ...more }, { type, dataKey: "b", label: "Beta", ...more }] });

describe("WidgetChart", () => {
  it.each([["bar", "bar"], ["line", "point"], ["area", "point"]])("draws one mark per datum per series for %s", (type, mark) => {
    const markup = draw(two(type));
    expect(count(markup, `data-chart-mark="${mark}"`)).toBe(data.length * 2);
    expect(count(markup, "data-chart-series=")).toBe(2);
    expect(count(markup, "<title>")).toBe(data.length * 2);
    expect(markup).toContain("<title>Wed · Alpha: 9</title>");
    // one continuous line per series, and for an area the fill under it
    expect(count(markup, 'stroke-linejoin="round"')).toBe(type === "bar" ? 0 : 2);
    expect(count(markup, "opacity:0.18")).toBe(type === "area" ? 2 : 0);
  });

  it("puts stacked bars in one column and unstacked ones side by side", () => {
    const starts = (markup: string) => [...markup.matchAll(/data-chart-mark="bar" d="M([\d.]+),([\d.]+)V([\d.]+)/g)].map((match) => match.slice(1).map(Number));
    const side = starts(draw(two("bar")));
    const stacked = starts(draw(two("bar", { stack: "all" })));
    // Mon: a = 4, b = 1
    expect(side[0]![0]).not.toBe(side[data.length]![0]);
    expect(side[0]![1]).toBe(side[data.length]![1]);
    expect(stacked[0]![0]).toBe(stacked[data.length]![0]);
    // the second segment starts where the first one ends, above it
    expect(stacked[data.length]![1]).toBeLessThan(stacked[0]![1]!);
  });

  it("leaves a gap in a line where a row has no value, instead of a mark at zero", () => {
    const markup = draw(chart({ data: [{ day: "Mon", a: 1 }, { day: "Tue", a: null }, { day: "Wed", a: 3 }, { day: "Thu", a: 2 }], series: [{ type: "line", dataKey: "a" }] }));
    expect(count(markup, 'data-chart-mark="point"')).toBe(3);
    expect(count(markup, 'stroke-linejoin="round"')).toBe(2);
  });

  it("labels the x axis from its dataKey, and draws the y axis, the grid and the legend only when they are on", () => {
    const plain = draw(two("bar"));
    for (const row of data) expect(plain).toContain(`>${row.day}</text>`);
    expect(plain).toContain('role="img"');
    expect(plain).toContain('aria-label="Chart of Alpha, Beta across 5 points"');
    expect(count(plain, "<line")).toBeGreaterThan(2);
    expect(count(plain, 'text-anchor="end"')).toBe(0);
    expect(plain).toContain("<li");
    expect(plain).toContain("Beta</span>");

    const dressed = draw(chart({ series: [{ type: "bar", dataKey: "a" }], showYAxis: true, showGrid: false, showLegend: false, height: 200 }));
    expect(count(dressed, "<line")).toBe(0);
    expect(count(dressed, 'text-anchor="end"')).toBeGreaterThan(2);
    expect(dressed).not.toContain("<li");
    expect(dressed).toContain('height="200"');
  });

  it("takes every colour from the skin's tokens", () => {
    const markup = draw(chart({ series: ["a", "b"].flatMap((dataKey) => [{ type: "bar", dataKey }, { type: "line", dataKey }]) }));
    for (const color of WIDGET_SERIES_COLORS) {
      expect(color).toMatch(/var\(--color-(accent|ink)\)/);
      expect(markup).toContain(color);
    }
    expect(markup).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  });

  it("draws the sample's stacked week, and nothing for a chart with no rows or no series", () => {
    const parsed = parseWidgetInput(WIDGET_SAMPLES.tokenChart);
    if (!parsed.ok) throw new Error(parsed.error);
    const markup = draw(parsed.value.children![0]!);
    expect(count(markup, 'data-chart-mark="bar"')).toBe(14);
    expect(markup).toContain('height="160"');
    expect(markup).toContain("<title>Fri · Opus: 9.4</title>");
    expect(draw({ type: "Chart", id: "n1" })).toBe("");
    expect(draw({ type: "Chart", id: "n1", data: [{ day: "Mon", a: 1 }], series: [] })).toBe("");
  });
});
