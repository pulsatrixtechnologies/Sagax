// The actions on the right of the reader's bar: Download PDF for every
// reader; Annotate for anyone signed in who may read the page; Share only
// for the page's own person (the server tells, shared/page-reader.ts
// ReaderBoot.can).
import { useCallback, useEffect, useState } from "react";
import { FileDown, MessageSquareText, Share2 } from "lucide-react";

import { readerText, type ReaderBoot } from "../../shared/page-reader";
import { AnnotatePanel } from "./AnnotatePanel";
import { downloadPdf } from "./print";
import { ReaderShare } from "./ReaderShare";

/** The panel sits under the bar, whose height can change (a phone wraps it). */
function useBarHeight(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const bar = document.querySelector(".sagax-bar");
    const set = () => document.documentElement.style.setProperty("--sr-bar-h", `${Math.round(bar?.getBoundingClientRect().bottom ?? 52)}px`);
    set();
    window.addEventListener("resize", set);
    return () => window.removeEventListener("resize", set);
  }, [active]);
}

export function ReaderActions({ boot }: { boot: ReaderBoot }) {
  const [sharing, setSharing] = useState(false);
  const [annotating, setAnnotating] = useState(false);
  const text = (key: Parameters<typeof readerText>[1], values?: Record<string, string>) => readerText(boot.lang, key, values);
  const frame = typeof document === "undefined" ? null : document.querySelector<HTMLIFrameElement>("iframe");
  useBarHeight(annotating);
  useEffect(() => {
    document.body.classList.toggle("sr-panel-open", annotating);
  }, [annotating]);
  const closePanel = useCallback(() => setAnnotating(false), []);
  return (
    <>
      <button type="button" className="sr-bar-button" data-reader-pdf title={text("pdfHint")} onClick={downloadPdf}>
        <FileDown size={14} aria-hidden="true" />
        <span className="sr-bar-label">{text("pdf")}</span>
      </button>
      {boot.can.annotate && boot.pageId && (
        <button type="button" className="sr-bar-button" data-reader-annotate aria-pressed={annotating} title={text("annotateHint")} onClick={() => setAnnotating((open) => !open)}>
          <MessageSquareText size={14} aria-hidden="true" />
          <span className="sr-bar-label">{text("annotate")}</span>
        </button>
      )}
      {annotating && boot.pageId && <AnnotatePanel boot={boot} pageId={boot.pageId} frame={frame} onClose={closePanel} />}
      {boot.can.share && boot.pageId && (
        <div className="sr-anchor">
          <button type="button" className="sr-bar-button sr-bar-button-primary" data-reader-share aria-expanded={sharing} aria-haspopup="dialog" onClick={() => setSharing((open) => !open)}>
            <Share2 size={14} aria-hidden="true" />
            <span>{text("share")}</span>
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
          {sharing && <ReaderShare boot={boot} pageId={boot.pageId} onClose={() => setSharing(false)} />}
        </div>
      )}
    </>
  );
}
