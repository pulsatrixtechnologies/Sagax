// Report a message another person wrote (App Store guideline 1.2,
// src/lib/moderation.ts): a reason, an optional note, then Send. The report
// goes to the organization's admins (the server's owner on a solo server)
// with the message's words. Once sent, the person may also block the author.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { REPORT_REASONS, blockPerson, reportMessage, type ReportReason } from "@/lib/moderation";
import { DIALOG, FIELD, GROUP_CARD, PILL, PRIMARY_PILL } from "./SettingsPrimitives";

export function ReportPersonDialog({ threadId, messageId, author, blocked, onClose }: {
  threadId: string;
  messageId: string;
  author: { id: string; name: string };
  /** already blocked: no "Block" offer after sending */
  blocked: boolean;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<ReportReason>("harassment");
  const [note, setNote] = useState("");
  const [state, setState] = useState<"edit" | "sending" | "sent" | "blocked">("edit");
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLSelectElement>(null);
  useModalDialog(dialog, onClose);
  useEffect(() => { first.current?.focus(); }, []);

  const send = async () => {
    setState("sending");
    setError(null);
    try {
      await reportMessage({ threadId, messageId, reason, note });
      setState("sent");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setState("edit");
    }
  };
  const block = async () => {
    try {
      await blockPerson(author);
      setState("blocked");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };

  return createPortal(<div data-thread-overlay className={cn(DIALOG.backdrop, "z-50")}
    onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialog} role="dialog" tabIndex={-1} aria-modal="true" aria-labelledby="report-person-title" data-report-dialog="" className={`${DIALOG.frame} max-w-[460px]`}>
      <div className={DIALOG.header}>
        <h2 id="report-person-title" className={DIALOG.title}>{t("moderation.report.title")}</h2>
        <p className={DIALOG.subtitle}>{t("moderation.report.subtitle", { name: author.name })}</p>
        <button type="button" onClick={onClose} aria-label={t("common.close")} className={DIALOG.close}><X size={18} className="pointer-events-none" /></button>
      </div>
      {state === "sent" || state === "blocked" ? (
        <>
          <div className={DIALOG.body}>
            <p role="status" className="text-[13px] leading-[19px] text-ink">{t("moderation.report.sent")}</p>
            {state === "blocked" && <p className="mt-2 text-[13px] leading-[19px] text-ink-secondary">{t("moderation.block.done", { name: author.name })}</p>}
            {error && <p role="alert" className="mt-2 text-[12.5px] text-danger">{error}</p>}
          </div>
          <div className={DIALOG.footer}>
            {state === "sent" && !blocked && <button type="button" onClick={() => void block()} className={PILL} data-report-block="">{t("moderation.block.action", { name: author.name })}</button>}
            <button type="button" onClick={onClose} className={PRIMARY_PILL}>{t("moderation.done")}</button>
          </div>
        </>
      ) : (
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => { event.preventDefault(); void send(); }}>
          <div className={DIALOG.body}>
            <div className={cn(GROUP_CARD, "flex flex-col gap-3 p-3")}>
              <label className="flex flex-col gap-1 text-[13px] text-ink">
                {t("moderation.report.reason")}
                <select ref={first} value={reason} onChange={(event) => setReason(event.target.value as ReportReason)} className={FIELD} data-report-reason="">
                  {REPORT_REASONS.map((id) => <option key={id} value={id}>{t(`moderation.reason.${id}`)}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[13px] text-ink">
                {t("moderation.report.note")}
                <textarea value={note} maxLength={1000} rows={3} onChange={(event) => setNote(event.target.value)} placeholder={t("moderation.report.notePlaceholder")} className={cn(FIELD, "h-auto py-2")} />
              </label>
            </div>
            <p className="mt-3 text-[12.5px] leading-[18px] text-ink-secondary">{t("moderation.report.who")}</p>
            {error && <p role="alert" className="mt-2 text-[12.5px] text-danger">{error}</p>}
          </div>
          <div className={DIALOG.footer}>
            <button type="button" onClick={onClose} className={PILL}>{t("common.cancel")}</button>
            <button type="submit" disabled={state === "sending"} className={PRIMARY_PILL} data-report-send="">{t("moderation.report.send")}</button>
          </div>
        </form>
      )}
    </div>
  </div>, document.body);
}
