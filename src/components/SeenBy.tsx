// Seen-by receipts under a message (src/lib/read-receipts.ts): the muted
// label "Seen by", then the readers' tiny overlapping avatars (five at most,
// then "+N"). Each avatar takes the keyboard focus and shows, on hover or
// focus, who it is and when they read it ("Zachary Sellam · 2:46 PM"); the
// same words are its aria-label. Never the viewer's own avatar.
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { seenFaceLabel, seenTooltip } from "@/lib/read-receipts";

export const SEEN_AVATAR_SIZE = 16;
/** Avatars drawn before the rest fold into "+N". */
export const SEEN_MAX_FACES = 5;

export interface SeenFace {
  participantId: string;
  name: string;
  at: number;
  /** The 16px avatar: a bot's look, a person's picture or initials. */
  avatar: ReactNode;
}

/** One hover or focus tooltip above a seen-by item. Decorative: the item
 * carries the same words as its aria-label. */
function SeenTip({ text }: { text: string }) {
  return (
    <span
      aria-hidden="true"
      data-seen-tip
      className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1 -translate-x-1/2 whitespace-nowrap rounded-md border-[0.5px] border-border bg-elevated px-2 py-1 text-[11px] leading-4 text-ink opacity-0 shadow-sm transition-opacity group-hover/seen:opacity-100 group-focus-visible/seen:opacity-100"
    >
      {text}
    </span>
  );
}

/** The readers of one message, oldest first, stacked after "Seen by". `end`
 * sits the row on the viewer's side (under their own line). */
export function SeenByRow({ faces, end, time }: { faces: readonly SeenFace[]; end: boolean; time: (at: number) => string }) {
  if (!faces.length) return null;
  const shown = faces.slice(0, SEEN_MAX_FACES);
  const rest = faces.slice(SEEN_MAX_FACES);
  return (
    <div
      data-testid="seen-by"
      className={cn("-mt-1 flex w-full px-1.5", end ? "justify-end" : "justify-start")}
    >
      <div role="group" aria-label={seenTooltip(faces, time)} className="flex items-center gap-1.5">
        <span data-seen-label className="text-[11px] leading-4 text-ink-tertiary">{t("seen.label")}</span>
        <span className="flex items-center">
          {shown.map((face, index) => {
            const label = seenFaceLabel(face.name, time(face.at));
            return (
              <span
                key={face.participantId}
                data-seen-by={face.participantId}
                role="img"
                tabIndex={0}
                aria-label={label}
                className={cn(
                  "group/seen relative inline-flex shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent",
                  index > 0 && "-ms-1",
                )}
                style={{ width: SEEN_AVATAR_SIZE, height: SEEN_AVATAR_SIZE, zIndex: shown.length - index }}
              >
                <span className="inline-flex size-full overflow-hidden rounded-full ring-2 ring-app">{face.avatar}</span>
                <SeenTip text={label} />
              </span>
            );
          })}
          {rest.length > 0 && (() => {
            const label = rest.map((face) => seenFaceLabel(face.name, time(face.at))).join(", ");
            return (
              <span
                data-seen-more
                role="img"
                tabIndex={0}
                aria-label={label}
                className="group/seen relative ms-1 inline-flex h-4 shrink-0 items-center rounded-full bg-raised px-1 text-[10px] font-medium tabular-nums leading-4 text-ink-secondary outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                +{rest.length}
                <SeenTip text={label} />
              </span>
            );
          })()}
        </span>
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
