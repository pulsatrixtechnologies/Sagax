// A widget's chart, drawn as plain SVG from its rows: bars (side by side or
// stacked), lines and areas over one shared band per row. No chart library:
// the marks are few, and their colours have to come from the skin.
import { useLayoutEffect, useRef, useState } from "react";
import { t } from "@/lib/i18n";
import { widgetNumber, type WidgetNode } from "../../../shared/widget";
import { boxStyle } from "./widget-style";

type ChartRow = Record<string, unknown>;
interface ChartSeries {
  type: "bar" | "line" | "area";
  dataKey: string;
  label: string;
  stack?: string;
}

/** One colour per series, all from the skin: the accent, a quieter accent,
 * then two strengths of the ink. A widget takes at most four series. */
export const WIDGET_SERIES_COLORS: readonly string[] = [
  "var(--color-accent)",
  "color-mix(in srgb, var(--color-accent) 45%, transparent)",
  "color-mix(in srgb, var(--color-ink) 55%, transparent)",
  "color-mix(in srgb, var(--color-ink) 22%, transparent)",
];

/** The inside of a 600px card, used until the chart has been measured. */
const FALLBACK_WIDTH = 560;
/** Under the plot: an 11px label on a 16px line, 6px away. */
const LABEL_BAND = 22;
const TOP = 6;
const BAR_GAP = 2;

function readChart(node: WidgetNode): { rows: ChartRow[]; series: ChartSeries[]; xKey: string } {
  const rows = (Array.isArray(node.data) ? node.data as unknown[] : []).filter((row): row is ChartRow => Boolean(row) && typeof row === "object" && !Array.isArray(row));
  const series = (Array.isArray(node.series) ? node.series as unknown[] : []).flatMap((item): ChartSeries[] => {
    const record: Record<string, unknown> = item && typeof item === "object" ? item as Record<string, unknown> : {};
    if (typeof record.dataKey !== "string") return [];
    return [{
      type: record.type === "line" || record.type === "area" ? record.type : "bar",
      dataKey: record.dataKey,
      label: typeof record.label === "string" ? record.label : record.dataKey,
      ...(typeof record.stack === "string" ? { stack: record.stack } : {}),
    }];
  }).slice(0, WIDGET_SERIES_COLORS.length);
  const axis = node.xAxis && typeof node.xAxis === "object" ? node.xAxis as { dataKey?: unknown } : {};
  return { rows, series, xKey: typeof axis.dataKey === "string" ? axis.dataKey : "" };
}

interface Span {
  from: number;
  to: number;
  value: number;
  /** The end of its bar: the segment that carries the rounded corners. */
  cap: boolean;
}

/** Where every value sits. Bar series that share a `stack` pile up in one
 * slot of the band (rising and falling piles apart); the rest sit side by side. */
function layOut(rows: ChartRow[], series: ChartSeries[]) {
  const slotIds: string[] = [];
  const slotOf = series.map((item, index) => {
    if (item.type !== "bar") return -1;
    const id = item.stack ? `stack:${item.stack}` : `series:${index}`;
    const at = slotIds.indexOf(id);
    return at >= 0 ? at : slotIds.push(id) - 1;
  });
  let low = 0;
  let high = 0;
  const spans = rows.map((row) => {
    const up: number[] = [];
    const down: number[] = [];
    const cells = series.map((item, index): Span | null => {
      const value = row[item.dataKey];
      if (typeof value !== "number" || !Number.isFinite(value)) return null;
      const slot = slotOf[index]!;
      const pile = value < 0 ? down : up;
      const from = slot < 0 ? 0 : pile[slot] ?? 0;
      if (slot >= 0) pile[slot] = from + value;
      low = Math.min(low, from + value);
      high = Math.max(high, from + value);
      return { from, to: from + value, value, cap: slot < 0 };
    });
    cells.forEach((cell, index) => {
      const slot = slotOf[index]!;
      if (cell && slot >= 0) cell.cap = cell.to === (cell.value < 0 ? down : up)[slot];
    });
    return cells;
  });
  return { slots: Math.max(1, slotIds.length), slotOf, spans, low, high };
}

/** About four round steps that cover the values, zero included. */
function ticksFor(low: number, high: number): number[] {
  const top = high === low ? low + 1 : high;
  const rough = (top - low) / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * power).find((candidate) => candidate >= rough) ?? rough;
  const ticks: number[] = [];
  for (let tick = Math.floor(low / step) * step; tick < Math.ceil(top / step) * step + step / 2; tick += step) ticks.push(Number(tick.toPrecision(12)));
  return ticks;
}

const round = (value: number) => Math.round(value * 100) / 100;

/** A bar from its base to its tip, the tip's two corners rounded when it is the end of the bar. */
function barPath(x: number, base: number, tip: number, width: number, cap: boolean): string {
  const radius = cap ? Math.min(6, width / 2, Math.abs(base - tip)) : 0;
  const turn = tip <= base ? radius : -radius;
  const [left, right] = [round(x), round(x + width)];
  return `M${left},${round(base)}V${round(tip + turn)}Q${left},${round(tip)} ${round(x + radius)},${round(tip)}H${round(x + width - radius)}Q${right},${round(tip)} ${right},${round(tip + turn)}V${round(base)}Z`;
}

interface Point {
  row: number;
  x: number;
  y: number;
}

/** A line breaks where a row has no value, rather than dropping to zero. */
function runsOf(points: Array<Point | null>): Point[][] {
  const runs: Point[][] = [];
  let run: Point[] = [];
  for (const point of [...points, null]) {
    if (point) {
      run.push(point);
    } else if (run.length) {
      runs.push(run);
      run = [];
    }
  }
  return runs;
}

const linePath = (run: Point[]) => run.map((point, index) => `${index ? "L" : "M"}${round(point.x)},${round(point.y)}`).join("");

export function WidgetChart({ node }: { node: WidgetNode }) {
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(FALLBACK_WIDTH);
  useLayoutEffect(() => {
    const element = frame.current;
    if (!element) return;
    const measure = () => {
      const next = Math.round(element.getBoundingClientRect().width);
      if (next > 0) setWidth(next);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const { rows, series, xKey } = readChart(node);
  if (!rows.length || !series.length) return null;
  const ratio = widgetNumber(node, "aspectRatio");
  const height = Math.round(Math.min(400, Math.max(80, widgetNumber(node, "height") ?? (ratio ? width / ratio : 160))));
  const model = layOut(rows, series);
  const axis = node.showYAxis === true;
  const steps = ticksFor(model.low, model.high);
  // with numbers down the side the plot ends on a round one; without them the tallest mark fills it, as in the mock
  const floor = axis ? steps[0]! : model.low;
  const ceiling = axis ? steps[steps.length - 1]! : model.high > model.low ? model.high : model.low + 1;
  const ticks = steps.filter((tick) => tick >= floor && tick <= ceiling);
  const format = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 2 });
  const tickLabels = ticks.map((tick) => format.format(tick));
  const left = axis ? Math.min(64, Math.max(...tickLabels.map((label) => label.length)) * 6.5 + 10) : 0;
  const bottom = height - LABEL_BAND;
  const plotWidth = Math.max(1, width - left);
  const band = plotWidth / rows.length;
  const y = (value: number) => TOP + (bottom - TOP) * (1 - (value - floor) / (ceiling - floor));
  const group = Math.max(1, band - Math.min(10, band * 0.3));
  const barWidth = Math.max(1, (group - (model.slots - 1) * BAR_GAP) / model.slots);
  // a label every 44px at the closest: the rest are read from the marks' own titles
  const every = Math.max(1, Math.ceil(rows.length / Math.max(1, Math.floor(plotWidth / 44))));
  const xLabel = (row: number) => {
    const value = rows[row]![xKey];
    return typeof value === "string" || typeof value === "number" ? String(value) : "";
  };
  const tip = (row: number, item: ChartSeries, value: number) => `${xLabel(row)} · ${item.label}: ${format.format(value)}`;
  const points = series.map((_, index) => rows.map((_, row): Point | null => {
    const span = model.spans[row]![index];
    return span ? { row, x: left + band * (row + 0.5), y: y(span.to) } : null;
  }));
  const dot = rows.length > 40 ? 0 : rows.length > 16 ? 1.5 : 2.5;
  const { height: _height, aspectRatio: _ratio, ...box } = boxStyle(node);

  return (
    <div ref={frame} className="min-w-0" style={box}>
      <svg
        role="img"
        aria-label={t("widget.chart.label", { series: series.map((item) => item.label).join(", "), count: rows.length })}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="block max-w-full"
        style={{ fontSize: 11, fontVariantNumeric: "tabular-nums" }}
      >
        {node.showGrid !== false && ticks.map((tick) => (
          // a tint of the ink, like every rule on the card: the hairline token does not show on it in the dark skins
          <line key={tick} x1={left} x2={width} y1={round(y(tick))} y2={round(y(tick))} style={{ stroke: "var(--color-ink)", opacity: tick === 0 ? 0.16 : 0.08 }} />
        ))}
        {axis && ticks.map((tick, index) => (
          <text key={tick} x={left - 8} y={round(y(tick)) + 4} textAnchor="end" style={{ fill: "var(--color-ink-tertiary)" }}>{tickLabels[index]}</text>
        ))}
        {series.map((item, index) => item.type === "bar" && (
          <g key={index} data-chart-series={item.dataKey} style={{ fill: WIDGET_SERIES_COLORS[index] }}>
            {rows.map((_, row) => {
              const span = model.spans[row]![index];
              if (!span) return null;
              const x = left + band * row + (band - group) / 2 + model.slotOf[index]! * (barWidth + BAR_GAP);
              return <path key={row} data-chart-mark="bar" d={barPath(x, y(span.from), y(span.to), barWidth, span.cap)}><title>{tip(row, item, span.value)}</title></path>;
            })}
          </g>
        ))}
        {series.map((item, index) => item.type === "area" && runsOf(points[index]!).map((run) => (
          <path
            key={`${index}:${run[0]!.row}`}
            d={`${linePath(run)}V${round(y(Math.min(Math.max(0, floor), ceiling)))}H${round(run[0]!.x)}Z`}
            style={{ fill: WIDGET_SERIES_COLORS[index], opacity: 0.18 }}
          />
        )))}
        {series.map((item, index) => item.type !== "bar" && (
          <g key={index} data-chart-series={item.dataKey}>
            {runsOf(points[index]!).map((run) => (
              <path key={run[0]!.row} d={linePath(run)} strokeLinecap="round" strokeLinejoin="round" style={{ fill: "none", stroke: WIDGET_SERIES_COLORS[index], strokeWidth: 2 }} />
            ))}
            {points[index]!.map((point) => point && (
              <circle key={point.row} data-chart-mark="point" cx={round(point.x)} cy={round(point.y)} r={dot} style={{ fill: WIDGET_SERIES_COLORS[index] }}>
                <title>{tip(point.row, item, model.spans[point.row]![index]!.value)}</title>
              </circle>
            ))}
          </g>
        ))}
        {rows.map((_, row) => row % every === 0 && (
          <text key={row} x={round(left + band * (row + 0.5))} y={height - 5} textAnchor="middle" style={{ fill: "var(--color-ink-tertiary)" }}>
            {xLabel(row).length > 14 ? `${xLabel(row).slice(0, 13)}…` : xLabel(row)}
          </text>
        ))}
      </svg>
      {node.showLegend !== false && (series.length > 1 || series[0]!.label !== series[0]!.dataKey) && (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] leading-4 text-ink-secondary">
          {series.map((item, index) => (
            <li key={index} className="flex min-w-0 items-center gap-1.5">
              <span aria-hidden="true" className="size-2 shrink-0 rounded-[3px]" style={{ background: WIDGET_SERIES_COLORS[index] }} />
              <span dir="auto" className="truncate">{item.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
