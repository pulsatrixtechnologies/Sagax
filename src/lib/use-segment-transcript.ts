// One earlier topic of the single stream, drawn above the live one
// (src/lib/single-stream.ts). Like a side thread (use-side-transcript.ts) it
// keeps its own copy of the thread outside the store, which holds the
// selected thread only: the newest page from `GET /api/threads/:id/messages`,
// older pages on demand (and, for a message a link or a search hit names,
// as many as it takes to reach it), then the live frames of that thread, so
// a late answer there shows where it belongs. Loading from the newest page
// keeps the topic whole down to the next divider.
import { useCallback, useEffect, useRef, useState } from "react";
import { api, MESSAGE_PAGE_SIZE, type Message } from "@/state/store";
import { listenLiveFrames } from "@/lib/live-events";
import { applySideFrame, applySidePage, EMPTY_SIDE_TRANSCRIPT, type SideTranscript } from "@/lib/side-thread";

type Page = { messages?: Message[]; activeLeafId?: string | null; hasMore?: boolean };

/** Pages read back to reach a linked message, at most (200 messages each). */
export const SEGMENT_REACH_PAGES = 10;

/** Older messages in front of the ones already held, without duplicates. */
export function prependOlder(transcript: SideTranscript, older: readonly Message[]): SideTranscript {
  const known = new Set(transcript.messages.map((message) => message.id));
  return { ...transcript, messages: [...older.filter((message) => !known.has(message.id)), ...transcript.messages] };
}

/** Whether the transcript holds the message a link names (or none is named). */
export function holdsMessage(transcript: SideTranscript, messageId: string | undefined): boolean {
  return !messageId || transcript.messages.some((message) => message.id === messageId);
}

export function useSegmentTranscript(threadId: string, aroundId?: string): SideTranscript & { hasMore: boolean; failed: boolean; reached: boolean; loadOlder: () => void } {
  const [transcript, setTranscript] = useState<SideTranscript>(EMPTY_SIDE_TRANSCRIPT);
  const [hasMore, setHasMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reaching, setReaching] = useState(false);
  const loadingOlder = useRef(false);
  const live = useRef({ threadId, cancelled: false });
  const fetchOlder = useCallback(async (before: string): Promise<Page | undefined> => {
    const at = live.current;
    const page = await api<Page>(`/api/threads/${encodeURIComponent(threadId)}/messages?before=${encodeURIComponent(before)}&limit=${MESSAGE_PAGE_SIZE}`);
    return at.cancelled ? undefined : page;
  }, [threadId]);
  useEffect(() => {
    const at = { threadId, cancelled: false };
    live.current = at;
    const id = encodeURIComponent(threadId);
    // The newest page, then older ones until the linked message is in.
    const load = async (fresh: boolean) => {
      try {
        const page = await api<Page>(`/api/threads/${id}/messages?limit=${MESSAGE_PAGE_SIZE}`);
        if (at.cancelled) return;
        let next = applySidePage(EMPTY_SIDE_TRANSCRIPT, page);
        let more = Boolean(page.hasMore);
        if (aroundId && !holdsMessage(next, aroundId) && more) {
          setReaching(true);
          for (let pages = 0; pages < SEGMENT_REACH_PAGES && more && !holdsMessage(next, aroundId); pages++) {
            const before = next.messages[0]?.id;
            if (!before) break;
            const older = await fetchOlder(before);
            if (!older) return;
            next = prependOlder(next, older.messages ?? []);
            more = Boolean(older.hasMore);
          }
          setReaching(false);
        }
        setFailed(false);
        setHasMore(more);
        // A reload after missed frames replaces what was held: older pages
        // read before would otherwise land under the newest ones. The first
        // load keeps the live frames that came in while it ran.
        const loaded = next;
        setTranscript((current) => fresh ? loaded : applySidePage(current, loaded));
      } catch {
        if (!at.cancelled) {
          setReaching(false);
          setFailed(true);
        }
      }
    };
    setTranscript(EMPTY_SIDE_TRANSCRIPT);
    setHasMore(false);
    setFailed(false);
    void load(false);
    const stop = listenLiveFrames({
      onFrame: (frame) => {
        if (!("threadId" in frame) || frame.threadId !== threadId) return;
        setTranscript((current) => applySideFrame(current, frame as Parameters<typeof applySideFrame>[1], threadId));
      },
      onMissedFrames: () => void load(true),
    });
    return () => {
      at.cancelled = true;
      stop();
    };
  }, [threadId, aroundId, fetchOlder]);
  const loadOlder = useCallback(() => {
    const before = transcript.messages[0]?.id;
    if (!before || loadingOlder.current) return;
    loadingOlder.current = true;
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
        loadingOlder.current = false;
      });
  }, [fetchOlder, transcript.messages]);
  return { ...transcript, hasMore, failed, reached: transcript.loaded && !reaching, loadOlder };
}

