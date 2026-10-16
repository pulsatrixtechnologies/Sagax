// A Mermaid diagram in the full window: drag to pan, wheel or buttons to
// zoom (around the pointer), Fit to screen, copy the source, export SVG or
// PNG. It shows the same SVG the message drew (mermaid, securityLevel
// "strict"); nothing else is injected.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from "react";
import { Check, Copy, FileImage, FileCode2, Maximize, Minus, Plus } from "lucide-react";

import { t } from "@/lib/i18n";
import { copyText } from "@/lib/copy-text";
import {
  downloadBlob,
  exportFileName,
  fitTransform,
  standaloneSvg,
  svgSize,
  svgToPng,
  zoomAt,
  type ViewTransform,
} from "@/lib/diagram-view";
import { ViewerDialog } from "./ViewerDialog";

export interface DiagramViewerProps {
  svg: string;
  code: string;
  title?: string;
  /** Background of the exported PNG (the diagram's own is transparent). */
  background?: string;
  /** Draws the diagram again with every label as SVG text, for the PNG
   * export when the shown SVG cannot be drawn on a canvas. */
  renderForExport?: () => Promise<string>;
  onClose: () => void;
  returnFocus: HTMLElement | null;
}

export function DiagramViewer({ svg, code, title, background, renderForExport, onClose, returnFocus }: DiagramViewerProps) {
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; view: ViewTransform } | null>(null);
  const natural = useMemo(() => svgSize(svg) ?? { width: 800, height: 600 }, [svg]);
  const markup = useMemo(() => ({ __html: svg }), [svg]);
  const [view, setView] = useState<ViewTransform>({ scale: 1, x: 0, y: 0 });
  const [status, setStatus] = useState<{ kind: "copied" | "exported" | "failed"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const fit = useCallback(() => {
    const box = stage.current?.getBoundingClientRect();
    if (box) setView(fitTransform(natural, { width: box.width, height: box.height }));
  }, [natural]);
  // The view opens fitted to the screen.
  useLayoutEffect(() => { fit(); }, [fit]);
  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(() => setStatus(null), 2500);
    return () => clearTimeout(timer);
  }, [status]);

  const zoomBy = (factor: number, point?: { x: number; y: number }) => {
    const box = stage.current?.getBoundingClientRect();
    const center = point ?? { x: (box?.width ?? 0) / 2, y: (box?.height ?? 0) / 2 };
    setView((current) => zoomAt(current, factor, center));
  };
  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const point = { x: event.clientX - box.left, y: event.clientY - box.top };
    // A trackpad pinch arrives as a wheel with ctrlKey; a plain wheel zooms too.
    const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0015));
    setView((current) => zoomAt(current, factor, point));
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, view };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start || start.id !== event.pointerId) return;
    setView({ ...start.view, x: start.view.x + event.clientX - start.x, y: start.view.y + event.clientY - start.y });
  };
  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id === event.pointerId) drag.current = null;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = 48;
    const keys: Record<string, () => void> = {
      "+": () => zoomBy(1.25), "=": () => zoomBy(1.25), "-": () => zoomBy(0.8), "0": fit,
      ArrowLeft: () => setView((v) => ({ ...v, x: v.x + step })), ArrowRight: () => setView((v) => ({ ...v, x: v.x - step })),
      ArrowUp: () => setView((v) => ({ ...v, y: v.y + step })), ArrowDown: () => setView((v) => ({ ...v, y: v.y - step })),
    };
    const action = keys[event.key];
    if (!action || event.altKey) return;
    event.preventDefault();
    action();
  };

  const base = title?.trim() || "diagram";
  const copySource = async () => {
    const result = await copyText(code);
    setStatus(result === "copied" ? { kind: "copied", text: t("diagram.sourceCopied") } : { kind: "failed", text: t("common.copyFailed") });
  };
  const exportSvg = () => {
    downloadBlob(new Blob([standaloneSvg(svg)], { type: "image/svg+xml;charset=utf-8" }), exportFileName(base, "svg"));
    setStatus({ kind: "exported", text: t("diagram.exported") });
  };
  const exportPng = async () => {
    setBusy(true);
    try {
      let blob: Blob;
      try {
        blob = await svgToPng(svg, { background });
      } catch (first) {
        if (!renderForExport) throw first;
        blob = await svgToPng(await renderForExport(), { background });
      }
      downloadBlob(blob, exportFileName(base, "png"));
      setStatus({ kind: "exported", text: t("diagram.exported") });
    } catch {
      setStatus({ kind: "failed", text: t("diagram.exportFailed") });
    } finally {
      setBusy(false);
    }
  };

  const actions = (
    <>
      <button type="button" className="table-action" onClick={() => zoomBy(0.8)} aria-label={t("viewer.zoomOut")} title={t("viewer.zoomOut")}><Minus size={15} /></button>
      <output className="min-w-12 text-center text-xs tabular-nums text-ink-secondary" aria-live="polite">{Math.round(view.scale * 100)} %</output>
      <button type="button" className="table-action" onClick={() => zoomBy(1.25)} aria-label={t("viewer.zoomIn")} title={t("viewer.zoomIn")}><Plus size={15} /></button>
      <button type="button" className="table-action" onClick={fit} aria-label={t("viewer.fit")} title={t("viewer.fit")}><Maximize size={15} /></button>
      <span className="mx-1 h-5 w-px bg-hairline/60" aria-hidden="true" />
      <button type="button" className="table-action" onClick={() => void copySource()} aria-label={t("diagram.copySource")} title={t("diagram.copySource")}>
        {status?.kind === "copied" ? <Check size={15} className="text-success" /> : <Copy size={15} />}
      </button>
      <button type="button" className="table-action gap-1 px-1.5 text-xs" onClick={exportSvg} aria-label={t("diagram.exportSvg")} title={t("diagram.exportSvg")}><FileCode2 size={15} /><span className="hidden sm:inline">SVG</span></button>
      <button type="button" className="table-action gap-1 px-1.5 text-xs" disabled={busy} onClick={() => void exportPng()} aria-label={t("diagram.exportPng")} title={t("diagram.exportPng")}><FileImage size={15} /><span className="hidden sm:inline">PNG</span></button>
    </>
  );

  return (
    <ViewerDialog title={title || t("diagram.title")} onClose={onClose} returnFocus={returnFocus} actions={actions} bodyClassName="bg-inset">
      <div
        ref={stage}
        role="application"
        tabIndex={0}
        aria-label={t("diagram.canvas")}
        aria-roledescription={t("diagram.canvasRole")}
        dir="ltr"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        onDoubleClick={fit}
        className="absolute inset-0 cursor-grab touch-none select-none overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60 active:cursor-grabbing"
      >
        <div
          data-diagram-content
          className="absolute left-0 top-0 origin-top-left [&_svg]:!h-full [&_svg]:!w-full [&_svg]:!max-w-none"
          style={{ width: natural.width, height: natural.height, transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
          dangerouslySetInnerHTML={markup}
        />
      </div>
      {status && (
        <p role={status.kind === "failed" ? "alert" : "status"} className={`pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-lg border border-hairline/50 bg-panel px-3 py-1.5 text-xs shadow ${status.kind === "failed" ? "text-danger" : "text-ink-secondary"}`}>
          {status.text}
        </p>
      )}
    </ViewerDialog>
  );
}

export default DiagramViewer;
