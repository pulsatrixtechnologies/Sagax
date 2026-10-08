// Seen-by receipts under a message (src/lib/read-receipts.ts): a row of tiny
// overlapping avatars in a room or a conversation between people, a quiet
// caption in a 1:1 with a bot. Never the viewer's own avatar.
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { seenTooltip } from "@/lib/read-receipts";

export const SEEN_AVATAR_SIZE = 16;

export interface SeenFace {
  participantId: string;
  name: string;
  at: number;
  /** The 16px avatar: a bot's look, a person's picture or initials. */
  avatar: ReactNode;
}

/** The readers of one message, oldest first, stacked. `end` sits the row on
 * the viewer's side (under their own line). */
export function SeenByRow({ faces, end, time }: { faces: readonly SeenFace[]; end: boolean; time: (at: number) => string }) {
  if (!faces.length) return null;
  const tooltip = seenTooltip(faces, time);
  return (
    <div
      data-testid="seen-by"
      className={cn("-mt-1 flex w-full px-1.5", end ? "justify-end" : "justify-start")}
    >
      <div role="img" aria-label={tooltip} title={tooltip} className="flex items-center">
        {faces.map((face, index) => (
          <span
            key={face.participantId}
            data-seen-by={face.participantId}
            className={cn("inline-flex shrink-0 overflow-hidden rounded-full ring-2 ring-app", index > 0 && "-ms-1")}
            style={{ width: SEEN_AVATAR_SIZE, height: SEEN_AVATAR_SIZE, zIndex: faces.length - index }}
          >
            {face.avatar}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Under the last message the bot of a 1:1 consumed: "Seen" or "Seen at 14:03". */
export function SeenCaption({ text, title }: { text: string; title?: string }) {
  return (
    <div data-testid="seen-caption" className="-mt-1 flex w-full justify-end px-1.5 text-[11px] leading-4 text-ink-tertiary" title={title}>
      {text}
    </div>
  );
}
