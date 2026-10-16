// One artifact drawn in a sandboxed iframe, the same sandbox and CSP as a
// chat widget (WidgetFrame.tsx): scripts only, opaque origin, no network,
// no cookies or storage of the app. The document is built once per version
// of the widget; fresh data from the source is posted into the frame, so a
// refresh never reloads it (and never loses what the person scrolled to).
import { useEffect, useMemo, useRef, useState } from "react";
import geistLatin from "@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?inline";

import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { clampWidgetHeight, WIDGET_MESSAGE } from "@/lib/rich-blocks";
import { widgetFontFace } from "@/lib/widget-kit";
import { buildArtifactDocument } from "@/lib/artifact-document";
import { postWidgetTheme, useWidgetTheme, widgetFrameAttributes } from "../WidgetFrame";
import { ARTIFACT_DATA_MESSAGE, type Artifact } from "../../../shared/artifacts";

const FONT_FACE = widgetFontFace(geistLatin);
const DEFAULT_HEIGHT = 160;

/** Hand the frame its data. The frame has an opaque origin, hence "*"; the
 * message carries only the source's JSON, which the person's own bot saved. */
export function postArtifactData(frame: HTMLIFrameElement | null, data: Artifact["data"]): void {
  if (!data) return;
  frame?.contentWindow?.postMessage({ type: ARTIFACT_DATA_MESSAGE, data: data.value, at: data.at }, "*");
}

export function ArtifactFrame({ artifact, fill = false, className }: {
  artifact: Pick<Artifact, "id" | "title" | "html" | "data" | "rev">;
  /** Take the whole box (a window, a dialog); otherwise grow with the widget. */
  fill?: boolean;
  className?: string;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const theme = useWidgetTheme(holder);
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const dataRef = useRef(artifact.data);
  dataRef.current = artifact.data;
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [generation, setGeneration] = useState(0);
  const [escapes, setEscapes] = useState(0);
  const loads = useRef(0);
  // Built per widget version: a theme change is posted, data is posted.
  const firstTheme = useRef(theme);
  const srcDoc = useMemo(
    () => buildArtifactDocument(artifact.html, firstTheme.current, FONT_FACE, dataRef.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- data rides postMessage, not a reload
    [artifact.html, artifact.id, generation],
  );

  useEffect(() => { postWidgetTheme(frame.current, theme); }, [theme]);
  useEffect(() => { postArtifactData(frame.current, artifact.data); }, [artifact.data]);

  useEffect(() => {
    loads.current = 0;
    if (fill) return;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const data = event.data as { type?: unknown; height?: unknown } | null;
      if (!data || data.type !== WIDGET_MESSAGE) return;
      const next = clampWidgetHeight(data.height);
      if (next !== null) setHeight(next);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [srcDoc, fill]);

  const blocked = escapes >= 2;
  return (
    <div ref={holder} dir="ltr" data-artifact-frame={artifact.id} className={cn("relative min-w-0", fill && "size-full", className)}>
      {blocked ? (
        <p role="alert" className="py-2 text-[12px] text-warning">{t("rich.widget.blocked")}</p>
      ) : (
        <iframe
          key={generation}
          ref={frame}
          {...widgetFrameAttributes(srcDoc, artifact.title)}
          onLoad={() => {
            postWidgetTheme(frame.current, themeRef.current);
            loads.current += 1;
            // the first load is our document; any later one is the widget
            // sending its frame somewhere else: reset it, then stop it
            if (loads.current > 1) {
              setEscapes((value) => value + 1);
              setGeneration((value) => value + 1);
            }
          }}
          style={fill ? { colorScheme: theme.scheme } : { height, colorScheme: theme.scheme }}
          className={fill ? "block size-full border-0 bg-transparent" : "block w-full border-0 bg-transparent"}
        />
      )}
    </div>
  );
}
