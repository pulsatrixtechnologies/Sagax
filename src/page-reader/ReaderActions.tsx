// The actions on the right of the reader's bar. Share only for the page's
// own person (the server tells, shared/page-reader.ts ReaderBoot.can).
import { useState } from "react";
import { Share2 } from "lucide-react";

import { readerText, type ReaderBoot } from "../../shared/page-reader";
import { ReaderShare } from "./ReaderShare";

export function ReaderActions({ boot }: { boot: ReaderBoot }) {
  const [sharing, setSharing] = useState(false);
  const text = (key: Parameters<typeof readerText>[1], values?: Record<string, string>) => readerText(boot.lang, key, values);
  return (
    <>
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
