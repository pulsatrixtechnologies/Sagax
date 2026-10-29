// The page's state from the reader's bar (2026-10-29), for the page's own
// person only: every value readers set in the page (shared/page-state.ts),
// who set it and when, who may write it as the page declares, a lock to
// make one key read-only, and Clear the state. The server checks every rule
// again (owner only).
import { useCallback, useEffect, useRef, useState } from "react";
import { Database, Lock, LockOpen, Trash2, X } from "lucide-react";

import { readerText, type ReaderBoot, type ReaderStringKey } from "../../shared/page-reader";
import { parseStateAccess, parseStateAnswer, STATE_PREFIX, stateLevelFor, type PageStateView, type StateAccess, type StateWriteLevel } from "../../shared/page-state";
import { ago } from "./AnnotatePanel";
import { readerApi, ReaderApiError } from "./api";
import { STATE_LIVE_EVENT, viewToken } from "./state";

const LEVEL_WORDS: Record<StateWriteLevel, ReaderStringKey> = {
  anyone: "levelAnyone",
  signed_in: "levelSigned",
  editors: "levelEditors",
  owner: "levelOwner",
};

/** A value in one short line. Pure. */
export function stateValueLine(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value) ?? "";
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}

export function ReaderStateButton({ boot, pageId }: { boot: ReaderBoot; pageId: string }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const text = (key: ReaderStringKey) => readerText(boot.lang, key);
  return (
    <div className="sr-anchor">
      <button type="button" className="sr-bar-button" data-reader-state aria-expanded={open} aria-haspopup="dialog" aria-label={text("state")} title={text("stateHint")} onClick={() => setOpen((value) => !value)}>
        <Database size={14} aria-hidden="true" />
        <span className="sr-bar-label">{text("state")}</span>
      </button>
      {open && <ReaderStatePanel boot={boot} pageId={pageId} onClose={close} />}
    </div>
  );
}

function ReaderStatePanel({ boot, pageId, onClose }: { boot: ReaderBoot; pageId: string; onClose(): void }) {
  const text = (key: ReaderStringKey, values?: Record<string, string>) => readerText(boot.lang, key, values);
  const [entries, setEntries] = useState<Record<string, PageStateView> | null>(null);
  const [access, setAccess] = useState<StateAccess | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const token = viewToken(location.pathname);

  const take = useCallback((body: unknown) => {
    const next = parseStateAnswer(body);
    if (next) setEntries(next);
    const rules = parseStateAccess((body as { access?: unknown } | null)?.access);
    if (rules) setAccess(rules);
  }, []);
  const load = useCallback(() => {
    if (!token) return;
    void readerApi<unknown>(`${STATE_PREFIX}${token}`).then(take, () => setError(readerText(boot.lang, "failed")));
  }, [token, take, boot.lang]);

  useEffect(() => {
    load();
    window.addEventListener(STATE_LIVE_EVENT, load);
    return () => window.removeEventListener(STATE_LIVE_EVENT, load);
  }, [load]);

  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && !ref.current?.contains(target) && !target.closest("[data-reader-state]")) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  const act = (path: string, init: { method: string; body?: unknown }) => {
    setBusy(true);
    setError("");
    void readerApi<unknown>(path, init).then((body) => {
      take(body);
      // the page in this tab reads the state again too
      window.dispatchEvent(new Event(STATE_LIVE_EVENT));
    }, (cause: unknown) => setError(cause instanceof ReaderApiError ? cause.message : readerText(boot.lang, "failed"))).finally(() => setBusy(false));
  };
  const id = encodeURIComponent(pageId);
  const lock = (key: string, locked: boolean) => act(`/api/pages/${id}/state/lock`, { method: "PUT", body: { key, locked } });
  const clear = () => {
    setConfirming(false);
    act(`/api/pages/${id}/state`, { method: "DELETE" });
  };

  const now = Date.now();
  const keys = Object.keys(entries ?? {}).sort();
  const locked = new Set(access?.locked ?? []);
  // a read-only key with no value still shows, so it can be unlocked
  for (const key of locked) if (!keys.includes(key)) keys.push(key);
  return (
    <div ref={ref} role="dialog" aria-label={text("state")} data-page-state-panel={pageId} className="sr-popover">
      <div className="sr-popover-head">
        <h2>{text("state")}</h2>
        <button type="button" className="sr-icon-button" aria-label={text("close")} onClick={onClose}><X size={15} aria-hidden="true" /></button>
      </div>
      <p className="sr-muted sr-state-hint">{text("stateHint")}</p>
      {error && <p className="sr-error" role="alert">{error}</p>}
      {entries && keys.length === 0 && <p className="sr-muted sr-pad">{text("stateEmpty")}</p>}
      {keys.length > 0 && (
        <ul className="sr-people sr-state-list">
          {keys.map((key) => {
            const entry = entries?.[key];
            const isLocked = locked.has(key);
            const level = access ? stateLevelFor(access.rules, key) : "signed_in";
            return (
              <li key={key} className="sr-row" data-state-key={key}>
                <span className="sr-row-text">
                  <span><code>{key}</code>{entry ? ` · ${stateValueLine(entry.value)}` : ""}</span>
                  <small>
                    {isLocked ? text("stateLocked") : text(LEVEL_WORDS[level])}
                    {entry ? ` · ${text("stateBy", { name: entry.name || text("someoneElse"), when: ago(entry.at, now, boot.lang) })}` : ""}
                  </small>
                </span>
                <button
                  type="button"
                  className="sr-icon-button"
                  data-state-lock={key}
                  aria-pressed={isLocked}
                  disabled={busy}
                  aria-label={text(isLocked ? "stateUnlock" : "stateLock", { key })}
                  title={text(isLocked ? "stateUnlock" : "stateLock", { key })}
                  onClick={() => lock(key, !isLocked)}
                >
                  {isLocked ? <Lock size={14} aria-hidden="true" /> : <LockOpen size={14} aria-hidden="true" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {confirming ? (
        <div className="sr-state-confirm">
          <p className="sr-muted">{text("stateClearConfirm")}</p>
          <div className="sr-state-actions">
            <button type="button" className="sr-button sr-button-small" onClick={() => setConfirming(false)}>{text("cancel")}</button>
            <button type="button" className="sr-button sr-button-small sr-button-primary" data-state-clear-confirm disabled={busy} onClick={clear}>{text("stateClear")}</button>
          </div>
        </div>
      ) : (
        <button type="button" className="sr-button sr-button-wide" data-state-clear disabled={busy || !entries || Object.keys(entries).length === 0} onClick={() => setConfirming(true)}>
          <Trash2 size={14} aria-hidden="true" />
          {text("stateClear")}
        </button>
      )}
    </div>
  );
}
