// A widget's chart: its Vega-Lite spec (shared/widget-chart.ts) drawn by
// vega-embed with the shared config, the way the Data panel draws its charts.
// vega-embed loads with the first chart, not with the app; until it has drawn,
// the chart's space is held so the message does not jump.
import { useEffect, useMemo, useRef, useState } from "react";
import type { Result } from "vega-embed";
import { useColorScheme } from "@/lib/color-scheme";
import { t } from "@/lib/i18n";
import { vegaConfig } from "../../../shared/vega-config";
import type { WidgetNode } from "../../../shared/widget";
import { WIDGET_CHART_WIDTH, widgetChartHeight, widgetChartSpec } from "../../../shared/widget-chart";
import { boxStyle } from "./widget-style";

function chartCite(node: WidgetNode): { pieces: string; asOf?: string } | null {
  const sources = Array.isArray(node.sources) ? node.sources as Array<{ piece?: unknown; asOf?: unknown }> : [];
  const pieces = sources.map((source) => typeof source.piece === "string" ? source.piece.trim() : "").filter(Boolean);
  const asOf = typeof node.asOf === "string" ? node.asOf : sources.find((source) => typeof source.asOf === "string")?.asOf;
  if (!pieces.length && typeof asOf !== "string") return null;
  return { pieces: pieces.join(", "), ...(typeof asOf === "string" ? { asOf } : {}) };
}

function ChartCite({ node }: { node: WidgetNode }) {
  const cite = chartCite(node);
  if (!cite) return null;
  const text = cite.pieces && cite.asOf
    ? t("rich.chart.cited", { pieces: cite.pieces, asOf: cite.asOf })
    : cite.asOf ? t("rich.chart.citedDate", { asOf: cite.asOf }) : cite.pieces;
  return <p className="mt-1 text-[11.5px] text-ink-tertiary" data-chart-sources="">{text}</p>;
}

export function WidgetChart({ node }: { node: WidgetNode }) {
  const theme = useColorScheme();
  const host = useRef<HTMLDivElement>(null);
  const drawn = useRef<Result | null>(null);
  const [width, setWidth] = useState(WIDGET_CHART_WIDTH);
  const [failed, setFailed] = useState<string | null>(null);
  // A message re-renders with an equal node; redraw only when the chart changes.
  const specText = useMemo(() => JSON.stringify(widgetChartSpec(node)), [node]);
  const height = widgetChartHeight(node, width);
  const size = useRef({ width, height });
  size.current = { width, height };

  useEffect(() => {
    const element = host.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth > 0) setWidth(element.clientWidth);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [specText]);

  useEffect(() => {
    const element = host.current;
    const spec = JSON.parse(specText) as Record<string, unknown> | null;
    if (!element || !spec) return;
    let alive = true;
    setFailed(null);
    void (async () => {
      const { default: embed } = await import("vega-embed");
      if (!alive) return;
      const target = document.createElement("div");
      element.replaceChildren(target);
      const result = await embed(target, { ...spec, ...size.current } as Parameters<typeof embed>[1], { actions: false, config: vegaConfig(theme) });
      if (!alive) { result.finalize(); return; }
      drawn.current = result;
    })().catch((cause) => {
      if (alive) setFailed(cause instanceof Error ? cause.message : String(cause));
    });
    return () => {
      alive = false;
      drawn.current?.finalize();
      drawn.current = null;
      element.replaceChildren();
    };
  }, [specText, theme]);

  useEffect(() => {
    void drawn.current?.view.width(width).height(height).resize().runAsync().catch(() => undefined);
  }, [width, height]);

  if (specText === "null") return null;
  const series = (node.series as Array<{ label?: string; dataKey: string }>).map((item) => item.label ?? item.dataKey);
  const { height: _height, aspectRatio: _ratio, ...box } = boxStyle(node);
  return (
    <div className="min-w-0" style={box}>
      <div
        ref={host}
        role="img"
        aria-label={t("widget.chart.label", { series: series.join(", "), count: (node.data as unknown[]).length })}
        style={{ height }}
      />
      {failed && <p role="alert" className="mt-1 text-[12px] text-danger">{t("data.chart.failed", { reason: failed })}</p>}
      <ChartCite node={node} />
    </div>
  );
}
