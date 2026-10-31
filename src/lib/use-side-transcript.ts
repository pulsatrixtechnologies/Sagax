// A thread's own copy of its messages, outside the store (which keeps the
// selected thread's only): the newest page (`GET /api/threads/:id/messages`,
// the route scrollback reads), older pages on demand (`?before=`), then the
// live stream's frames for that thread. Used by the side thread column
// (SideThreadPanel), split-view sections (SplitWorkspace), and by a task
// window's live conversation (ActivityConversation).
import { useCallback, useEffect, useRef, useState } from "react";
import { api, MESSAGE_PAGE_SIZE, type Message } from "@/state/store";
import { listenLiveFrames } from "@/lib/live-events";
import { applySideFrame, applySidePage, EMPTY_SIDE_TRANSCRIPT, prependOlder, type SideTranscript } from "@/lib/side-thread";

type Page = { messages?: Message[]; activeLeafId?: string | null; hasMore?: boolean };

/** The thread's messages: the newest page, older pages on scroll-up, then the
 * live stream. A frame the stream could not replay reloads the newest page. */
export function useSideTranscript(threadId: string): SideTranscript & {
  hasMore: boolean;
  failed: boolean;
  loadingOlder: boolean;
  loadOlder: () => void;
} {
  const [transcript, setTranscript] = useState<SideTranscript>(EMPTY_SIDE_TRANSCRIPT);
  const [hasMore, setHasMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const loadingOlderRef = useRef(false);
  const live = useRef({ threadId, cancelled: false });

  const fetchOlder = useCallback(async (before: string): Promise<Page | undefined> => {
    const at = live.current;
    const page = await api<Page>(`/api/threads/${encodeURIComponent(threadId)}/messages?before=${encodeURIComponent(before)}&limit=${MESSAGE_PAGE_SIZE}`);
    return at.cancelled ? undefined : page;
  }, [threadId]);

  useEffect(() => {
    const at = { threadId, cancelled: false };
    live.current = at;
    const load = (fresh: boolean) => {
      api<Page>(`/api/threads/${encodeURIComponent(threadId)}/messages?limit=${MESSAGE_PAGE_SIZE}`)
        .then((page) => {
          if (at.cancelled) return;
          setFailed(false);
          setHasMore(Boolean(page.hasMore));
          // A reload after missed frames replaces what was held: older pages
          // read before would otherwise land under the newest ones. The first
          // load keeps the live frames that came in while it ran.
          const loaded = applySidePage(EMPTY_SIDE_TRANSCRIPT, page);
          setTranscript((current) => (fresh ? loaded : applySidePage(current, loaded)));
        })
        .catch(() => {
          if (!at.cancelled) setFailed(true);
        });
    };
    setTranscript(EMPTY_SIDE_TRANSCRIPT);
    setHasMore(false);
    setFailed(false);
    setLoadingOlder(false);
    loadingOlderRef.current = false;
    load(false);
    const stop = listenLiveFrames({
      onFrame: (frame) => {
        if (!("threadId" in frame) || frame.threadId !== threadId) return;
        setTranscript((current) => applySideFrame(current, frame as Parameters<typeof applySideFrame>[1], threadId));
      },
      onMissedFrames: () => load(true),
    });
    return () => {
      at.cancelled = true;
      stop();
    };
  }, [threadId]);

  const loadOlder = useCallback(() => {
    const before = transcript.messages[0]?.id;
    if (!before || loadingOlderRef.current || !hasMore) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    const at = live.current;
    fetchOlder(before)
      .then((page) => {
        if (!page) return;
        setHasMore(Boolean(page.hasMore));
        setTranscript((current) => prependOlder(current, page.messages ?? []));
      })
      .catch(() => {
        if (!at.cancelled) setFailed(true);
      })
      .finally(() => {
        loadingOlderRef.current = false;
        if (!at.cancelled) setLoadingOlder(false);
      });
  }, [fetchOlder, hasMore, transcript.messages]);

  return { ...transcript, hasMore, failed, loadingOlder, loadOlder };
}
