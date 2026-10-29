// The wrapper's side of a page's shared state (#1544, shared/page-state.ts):
// the page's script asks for the state and sets keys through
// window.sagax.page (STATE_BRIDGE_SOURCE in its frame); this reads the store
// from the server for every reader and writes it with the reader's own
// session when they may (signed in, allowed to annotate). Only messages from
// the page's own frame are heard. The state is read again when the live
// stream says it changed, and every 20 s while the page is in view.
import { parseStateAnswer, parseStateSet, STATE_ASK_MESSAGE, STATE_MESSAGE, STATE_PREFIX, STATE_RESULT_MESSAGE, type PageStateView } from "../../shared/page-state";
import type { ReaderBoot } from "../../shared/page-reader";
import { readerApi, ReaderApiError } from "./api";

/** The reading link's token, from the wrapper's own address. Pure. */
export function viewToken(pathname: string): string | null {
  const match = /^\/pages\/view\/([^/]+)$/.exec(pathname);
  return match ? match[1]! : null;
}

export const STATE_LIVE_EVENT = "sagax-live-state";
const POLL_MS = 20_000;

export function watchPageState(frame: HTMLIFrameElement | null, boot: ReaderBoot | null): () => void {
  const token = viewToken(location.pathname);
  if (!frame || !token) return () => undefined;
  const canWrite = Boolean(boot?.can.annotate && boot.pageId);
  let entries: Record<string, PageStateView> | null = null;
  // the page may have asked before this script started: tell it anyway, and
  // again whenever its frame loads
  let asked = true;
  const send = (message: Record<string, unknown>) => frame.contentWindow?.postMessage({ v: 1, ...message }, "*");
  const share = () => {
    if (entries && asked) send({ type: STATE_MESSAGE, entries, canWrite });
  };
  const load = async () => {
    try {
      const next = parseStateAnswer(await readerApi<unknown>(`${STATE_PREFIX}${token}`));
      if (next) {
        entries = next;
        share();
      }
    } catch { /* the page keeps what it had */ }
  };
  const onMessage = (event: MessageEvent) => {
    if (event.source !== frame.contentWindow || !event.data || typeof event.data !== "object") return;
    if ((event.data as { type?: unknown }).type === STATE_ASK_MESSAGE) {
      asked = true;
      if (entries) share();
      else void load();
      return;
    }
    const set = parseStateSet(event.data);
    if (!set) return;
    const answer = (ok: boolean, error?: string) => send({ type: STATE_RESULT_MESSAGE, id: set.id, ok, ...(error ? { error } : {}) });
    if (!canWrite || !boot?.pageId) {
      answer(false, boot?.lang === "fr" ? "Connectez-vous pour modifier cette page." : "Sign in to change this page.");
      return;
    }
    void readerApi<unknown>(`/api/pages/${encodeURIComponent(boot.pageId)}/state`, { method: "PUT", body: { key: set.key, value: set.value } }).then((body) => {
      const next = parseStateAnswer(body);
      if (next) entries = next;
      answer(true);
      share();
    }, (cause: unknown) => answer(false, cause instanceof ReaderApiError ? cause.message : String(cause)));
  };
  window.addEventListener("message", onMessage);
  window.addEventListener(STATE_LIVE_EVENT, load);
  frame.addEventListener("load", share);
  void load();
  const timer = setInterval(() => { if (asked && document.visibilityState === "visible") void load(); }, POLL_MS);
  return () => {
    window.removeEventListener("message", onMessage);
    window.removeEventListener(STATE_LIVE_EVENT, load);
    frame.removeEventListener("load", share);
    clearInterval(timer);
  };
}
