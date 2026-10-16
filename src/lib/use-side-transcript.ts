// A thread's own copy of its messages, outside the store (which keeps the
// selected thread's only): the newest page (`GET /api/threads/:id/messages`,
// the route scrollback reads), then the live stream's frames for that
// thread. Used by the side thread column (SideThreadPanel) and by a task
// window's live conversation (ActivityConversation).
import { useEffect, useState } from "react";
import { api, MESSAGE_PAGE_SIZE, type Message } from "@/state/store";
import { listenLiveFrames } from "@/lib/live-events";
import { applySideFrame, applySidePage, EMPTY_SIDE_TRANSCRIPT, type SideTranscript } from "@/lib/side-thread";

/** The thread's messages: the newest page, then the live stream. A frame
 * the stream could not replay reloads the page. */
export function useSideTranscript(threadId: string): SideTranscript & { failed: boolean } {
  const [transcript, setTranscript] = useState<SideTranscript>(EMPTY_SIDE_TRANSCRIPT);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      api<{ messages?: Message[]; activeLeafId?: string | null }>(`/api/threads/${encodeURIComponent(threadId)}/messages?limit=${MESSAGE_PAGE_SIZE}`)
        .then((page) => {
          if (cancelled) return;
          setFailed(false);
          setTranscript((current) => applySidePage(current, page));
        })
        .catch(() => {
          if (!cancelled) setFailed(true);
        });
    };
    setTranscript(EMPTY_SIDE_TRANSCRIPT);
    load();
    const stop = listenLiveFrames({
      onFrame: (frame) => {
        if (!("threadId" in frame) || frame.threadId !== threadId) return;
        setTranscript((current) => applySideFrame(current, frame as Parameters<typeof applySideFrame>[1], threadId));
      },
      onMissedFrames: load,
    });
    return () => {
      cancelled = true;
      stop();
    };
  }, [threadId]);
  return { ...transcript, failed };
}
