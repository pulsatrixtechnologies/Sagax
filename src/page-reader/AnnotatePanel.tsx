// Annotate (2026-10-28): the comments panel of the reader's bar, beside the
// page. While it is open the page's frame is in annotation mode: the reader
// selects text or clicks a part of the page, writes a comment, and the
// thread shows to everyone who may read the page, with replies and a
// resolved state. The frame only gets anchors back to highlight (ids and the
// page's own words), never a comment or a name (shared/page-threads.ts).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, CornerDownRight, MessageSquarePlus, PencilLine, RotateCcw, Trash2, X } from "lucide-react";

import { initialsOf } from "@/lib/page-share-plan";
import { readerText, type ReaderBoot, type ReaderStringKey } from "../../shared/page-reader";
import {
  ANNOTATE_MARKS_MESSAGE,
  ANNOTATE_MODE_MESSAGE,
  orderThreads,
  parseFocusMessage,
  parseFoundMessage,
  parseSelectMessage,
  type FrameMark,
  type PageQuote,
  type PageThreadsAnswer,
  type PageThreadView,
  suggestable,
} from "../../shared/page-threads";
import { readerApi, ReaderApiError } from "./api";

/** "just now", "5 min", "3 h", else the date. Pure. */
export function ago(at: number, now: number, lang: ReaderBoot["lang"]): string {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return readerText(lang, "justNow");
  if (minutes < 60) return readerText(lang, "minutes", { n: String(minutes) });
  if (minutes < 24 * 60) return readerText(lang, "hours", { n: String(Math.floor(minutes / 60)) });
  return new Date(at).toLocaleDateString(lang === "fr" ? "fr-CA" : "en-CA", { day: "numeric", month: "short" });
}

/** The marks the frame draws: open threads, and resolved ones when shown;
 * the anchor only (the page's own words), never a comment. Pure. */
export function frameMarks(threads: readonly PageThreadView[], active: string | null, showResolved: boolean): FrameMark[] {
  return threads
    .filter((thread) => showResolved || !thread.resolved || thread.id === active)
    .map((thread) => ({ id: thread.id, anchor: thread.anchor, resolved: Boolean(thread.resolved), active: thread.id === active }));
}

function Person({ name }: { name: string }) {
  return <span aria-hidden="true" className="sr-avatar sr-avatar-small">{initialsOf(name)}</span>;
}

function Quote({ anchor, text }: { anchor: PageQuote; text: (key: ReaderStringKey) => string }) {
  const words = anchor.quote.replace(/\s+/g, " ").trim();
  return <blockquote className="sr-quote">{anchor.kind === "text" ? words : `${text("onPart")}${words ? ` : ${words}` : ""}`}</blockquote>;
}

export function AnnotatePanel({ boot, pageId, frame, changes = 0, onClose }: { boot: ReaderBoot; pageId: string; frame: HTMLIFrameElement | null; changes?: number; onClose(): void }) {
  const text = useCallback((key: ReaderStringKey, values?: Record<string, string>) => readerText(boot.lang, key, values), [boot.lang]);
  const [answer, setAnswer] = useState<PageThreadsAnswer | null>(null);
  const [draft, setDraft] = useState<PageQuote | null>(null);
  const [comment, setComment] = useState("");
  // a suggested edit (Markdown and slides): the words that replace the quote
  const [suggesting, setSuggesting] = useState(false);
  const [replacement, setReplacement] = useState("");
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [active, setActive] = useState<string | null>(null);
  const [found, setFound] = useState<string[] | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const scrollTo = useRef<string | null>(null);
  const draftField = useRef<HTMLTextAreaElement>(null);
  const base = `/api/pages/${encodeURIComponent(pageId)}/threads`;

  const send = useCallback((message: Record<string, unknown>) => frame?.contentWindow?.postMessage({ v: 1, ...message }, "*"), [frame]);

  const call = useCallback(async (path: string, init?: { method?: string; body?: unknown }) => {
    setBusy(true);
    setError("");
    try {
      const next = await readerApi<PageThreadsAnswer & { version?: number }>(`${base}${path}`, init);
      setAnswer(next);
      return next;
    } catch (cause) {
      // the server's words when it says why (a suggestion that no longer applies)
      setError(cause instanceof ReaderApiError && cause.status === 409 ? cause.message : text("failed"));
      return null;
    } finally {
      setBusy(false);
    }
  }, [base, text]);

  // annotation mode while the panel is open; the threads once
  useEffect(() => {
    send({ type: ANNOTATE_MODE_MESSAGE, on: true });
    void call("");
    return () => {
      send({ type: ANNOTATE_MODE_MESSAGE, on: false });
      send({ type: ANNOTATE_MARKS_MESSAGE, marks: [] });
    };
  }, [send, call]);

  // someone changed the annotations (the live stream): read them again,
  // quietly, keeping what this reader is writing
  useEffect(() => {
    if (!changes) return;
    let live = true;
    void readerApi<PageThreadsAnswer>(base).then((next) => { if (live) setAnswer(next); }, () => undefined);
    return () => { live = false; };
  }, [changes, base]);

  // what the frame tells: only from the page's own frame, every field checked
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!frame || event.source !== frame.contentWindow) return;
      const selection = parseSelectMessage(event.data);
      if (selection) {
        setDraft(selection);
        setActive(null);
        setTimeout(() => draftField.current?.focus(), 0);
        return;
      }
      const focus = parseFocusMessage(event.data);
      if (focus) {
        setActive(focus);
        document.querySelector(`[data-thread="${CSS.escape(focus)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        return;
      }
      const ids = parseFoundMessage(event.data);
      if (ids) setFound(ids);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [frame]);

  // the highlights follow the threads, the active one and the filter
  useEffect(() => {
    if (!answer) return;
    const scroll = scrollTo.current;
    scrollTo.current = null;
    send({ type: ANNOTATE_MARKS_MESSAGE, marks: frameMarks(answer.threads, active, showResolved), ...(scroll ? { scroll } : {}) });
  }, [answer, active, showResolved, send]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (draft) setDraft(null);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draft, onClose]);

  const ordered = useMemo(() => orderThreads(answer?.threads ?? [], found ?? []), [answer, found]);
  const open = ordered.filter((thread) => !thread.resolved);
  const resolved = ordered.filter((thread) => thread.resolved);
  const names = answer?.names ?? {};
  const nameOf = (id: string) => names[id] || (id === boot.me?.id ? boot.me.name : "") || text("someoneElse");
  const now = Date.now();

  const canSuggest = suggestable(boot.kind) && draft?.kind === "text";
  const suggestion = suggesting && canSuggest;
  const ready = suggestion ? replacement !== draft?.quote : Boolean(comment.trim());
  const submit = async () => {
    if (!draft || !ready) return;
    const next = await call("", { method: "POST", body: { anchor: draft, text: comment, ...(suggestion ? { suggestion: replacement } : {}) } });
    if (!next) return;
    const made = next.threads.at(-1);
    setDraft(null);
    setComment("");
    setSuggesting(false);
    if (made) {
      scrollTo.current = made.id;
      setActive(made.id);
    }
  };
  const reply = async (thread: PageThreadView) => {
    const value = (replies[thread.id] ?? "").trim();
    if (!value) return;
    if (await call(`/${encodeURIComponent(thread.id)}/replies`, { method: "POST", body: { text: value } })) setReplies((all) => ({ ...all, [thread.id]: "" }));
  };
  const choose = (id: string) => {
    scrollTo.current = id;
    setActive((current) => (current === id ? null : id));
  };

  const card = (thread: PageThreadView) => {
    const mayDelete = thread.mine || answer?.owner === true;
    const missing = found !== null && !found.includes(thread.id);
    return (
      <li key={thread.id} data-thread={thread.id} className={`sr-thread${thread.id === active ? " sr-thread-active" : ""}${thread.resolved ? " sr-thread-done" : ""}`}>
        <button type="button" className="sr-thread-anchor" onClick={() => choose(thread.id)}>
          <Quote anchor={thread.anchor} text={text} />
          {missing && <small className="sr-muted">{text("notFound")}</small>}
        </button>
        <div className="sr-thread-head">
          <Person name={nameOf(thread.by)} />
          <span className="sr-thread-who">{nameOf(thread.by)}</span>
          <span className="sr-muted">{ago(thread.at, now, boot.lang)}</span>
          <span className="sr-thread-tools">
            <button type="button" className="sr-icon-button" disabled={busy} data-thread-resolve
              aria-label={thread.resolved ? text("reopen") : text("resolve")} title={thread.resolved ? text("reopen") : text("resolve")}
              onClick={() => void call(`/${encodeURIComponent(thread.id)}/resolve`, { method: "POST", body: { resolved: !thread.resolved } })}>
              {thread.resolved ? <RotateCcw size={13} /> : <Check size={14} />}
            </button>
            {mayDelete && (
              <button type="button" className="sr-icon-button" disabled={busy} aria-label={text("delete")} title={text("delete")}
                onClick={() => void call(`/${encodeURIComponent(thread.id)}`, { method: "DELETE" })}><Trash2 size={13} /></button>
            )}
          </span>
        </div>
        {thread.text && <p className="sr-thread-text">{thread.text}</p>}
        {thread.suggestion && (
          <div className="sr-suggestion" data-suggestion={thread.suggestion.state}>
            <p className="sr-label"><PencilLine size={12} aria-hidden="true" /> {text("suggestion")}</p>
            <p className="sr-suggestion-old">{thread.anchor.quote}</p>
            <p className="sr-suggestion-new">{thread.suggestion.text || "∅"}</p>
            {thread.suggestion.state === "open" && answer?.owner && (
              <span className="sr-confirm-actions">
                <button type="button" className="sr-button sr-button-primary sr-button-small" disabled={busy} data-suggestion-accept
                  onClick={() => void call(`/${encodeURIComponent(thread.id)}/accept`, { method: "POST", body: {} }).then((next) => { if (next?.version) location.reload(); })}>{text("accept")}</button>
                <button type="button" className="sr-button sr-button-small" disabled={busy}
                  onClick={() => void call(`/${encodeURIComponent(thread.id)}/decline`, { method: "POST", body: {} })}>{text("decline")}</button>
              </span>
            )}
            {thread.suggestion.state === "accepted" && <p className="sr-muted">{text("accepted", { n: String(thread.suggestion.version ?? "") })}</p>}
            {thread.suggestion.state === "declined" && <p className="sr-muted">{text("declined")}</p>}
          </div>
        )}
        {thread.replies.map((entry) => (
          <div key={entry.id} className="sr-reply">
            <div className="sr-thread-head">
              <CornerDownRight size={12} className="sr-muted" aria-hidden="true" />
              <Person name={nameOf(entry.by)} />
              <span className="sr-thread-who">{nameOf(entry.by)}</span>
              <span className="sr-muted">{ago(entry.at, now, boot.lang)}</span>
              {(entry.by.toLowerCase() === boot.me?.id.toLowerCase() || answer?.owner) && (
                <span className="sr-thread-tools">
                  <button type="button" className="sr-icon-button" disabled={busy} aria-label={text("delete")} title={text("delete")}
                    onClick={() => void call(`/${encodeURIComponent(thread.id)}/replies/${encodeURIComponent(entry.id)}`, { method: "DELETE" })}><Trash2 size={12} /></button>
                </span>
              )}
            </div>
            <p className="sr-thread-text">{entry.text}</p>
          </div>
        ))}
        {thread.resolved ? (
          <p className="sr-muted sr-thread-state"><Check size={12} aria-hidden="true" /> {text("resolved")} · {nameOf(thread.resolved.by)}</p>
        ) : (
          <form className="sr-reply-form" onSubmit={(event) => { event.preventDefault(); void reply(thread); }}>
            <input value={replies[thread.id] ?? ""} maxLength={2000} placeholder={text("replyTo")} aria-label={text("reply")}
              onChange={(event) => setReplies((all) => ({ ...all, [thread.id]: event.target.value }))} />
            {(replies[thread.id] ?? "").trim() && <button type="submit" className="sr-button sr-button-primary sr-button-small" disabled={busy}>{text("reply")}</button>}
          </form>
        )}
      </li>
    );
  };

  return createPortal(
    <aside className="sr-panel sagax-reader-overlay" aria-label={text("comments")} data-reader-panel>
      <div className="sr-panel-head">
        <h2>{text("comments")}{answer ? ` (${open.length})` : ""}</h2>
        <button type="button" className="sr-icon-button" aria-label={text("close")} title={text("close")} onClick={onClose}><X size={15} /></button>
      </div>
      <p className="sr-panel-hint"><MessageSquarePlus size={14} aria-hidden="true" />{text("annotateHint")}</p>
      {draft && (
        <form className="sr-draft" data-reader-draft onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <p className="sr-label">{text("newComment")}</p>
          <Quote anchor={draft} text={text} />
          {canSuggest && (
            <label className="sr-toggle">
              <input type="checkbox" checked={suggesting} data-reader-suggest
                onChange={(event) => { setSuggesting(event.target.checked); setReplacement(draft.quote); }} />
              <PencilLine size={13} aria-hidden="true" /> {text("suggest")}
            </label>
          )}
          {suggestion && (
            <textarea value={replacement} maxLength={8000} rows={3} aria-label={text("suggestWith")} placeholder={text("suggestWith")} data-reader-replacement
              onChange={(event) => setReplacement(event.target.value)} />
          )}
          <textarea ref={draftField} value={comment} maxLength={2000} rows={suggestion ? 2 : 3} placeholder={suggestion ? text("suggestNote") : text("write")} aria-label={suggestion ? text("suggestNote") : text("write")}
            onChange={(event) => setComment(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void submit(); } }} />
          <span className="sr-confirm-actions">
            <button type="submit" className="sr-button sr-button-primary" disabled={busy || !ready}>{suggestion ? text("suggest") : text("send")}</button>
            <button type="button" className="sr-button" onClick={() => { setDraft(null); setComment(""); setSuggesting(false); }}>{text("cancel")}</button>
          </span>
        </form>
      )}
      {error && <p role="alert" className="sr-error">{error}</p>}
      <ul className="sr-threads">
        {open.map(card)}
      </ul>
      {answer && open.length === 0 && !draft && <p className="sr-muted sr-pad">{text("noComments")}</p>}
      {resolved.length > 0 && (
        <>
          <button type="button" className="sr-link" onClick={() => setShowResolved((value) => !value)}>
            {showResolved ? text("hideResolved") : text("showResolved", { count: String(resolved.length) })}
          </button>
          {showResolved && <ul className="sr-threads">{resolved.map(card)}</ul>}
        </>
      )}
    </aside>,
    document.body,
  );
}
