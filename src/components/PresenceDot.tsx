// A person's presence on their avatar (organization server): green online,
// amber away, grey offline, with "Offline, last seen 2 h ago" as its tooltip
// and accessible name (src/lib/presence.ts). Nothing where presence does not
// exist (a solo server, before the first answer).
import { useEffect, useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import { presenceLabel, usePresence, type PresenceEntry } from "@/lib/presence";
import { StatusDot, type StatusDotTone } from "./StatusDot";

const TONE: Record<PresenceEntry["state"], StatusDotTone> = { online: "success", away: "warning", offline: "offline" };

/** The tooltip's "2 h ago" moves on by itself, once a minute. */
function useMinuteClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

export function presenceDotSize(avatarSize: number): string {
  return avatarSize >= 40 ? "size-3" : avatarSize >= 28 ? "size-2.5" : "size-2";
}

/** The dot alone. `className` places it (an avatar's corner, or inline). */
export function PresenceDot({ principalId, className, ringClassName, sizeClassName }: {
  principalId: string | null | undefined;
  className?: string;
  ringClassName?: string;
  sizeClassName?: string;
}) {
  const entry = usePresence(principalId);
  const now = useMinuteClock(entry?.state === "offline" && entry.lastSeenAt !== null);
  if (!entry || !principalId) return null;
  return (
    <StatusDot
      tone={TONE[entry.state]}
      label={presenceLabel(entry, now)}
      role="img"
      data={{ "data-presence": entry.state, "data-presence-person": principalId }}
      className={className}
      ringClassName={ringClassName}
      sizeClassName={sizeClassName}
    />
  );
}

/** An avatar with the dot on its bottom-right corner. */
export function WithPresence({ principalId, avatarSize, ringClassName = "border-card", children, className }: {
  principalId: string | null | undefined;
  avatarSize: number;
  ringClassName?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      {children}
      <PresenceDot
        principalId={principalId}
        className="absolute -bottom-0.5 -right-0.5"
        ringClassName={ringClassName}
        sizeClassName={presenceDotSize(avatarSize)}
      />
    </span>
  );
}
