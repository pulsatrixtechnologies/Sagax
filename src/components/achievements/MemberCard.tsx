// The member card: a quiet profile blade (avatar, name, chosen title, points,
// then the achievement list). Your sidebar row opens it. A colleague's row
// opens the same blade from the public card, which only has unlocked ids.
// The list scrolls inside the card. It does not live in the sidebar column.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Trophy } from "lucide-react";
import { ACHIEVEMENTS, achievementById } from "../../../shared/achievements-catalog";
import type { AchievementItemState, AchievementSnapshot, PublicAchievementCard } from "../../../shared/achievements";
import { localized } from "@/lib/achievements";
import { t } from "@/lib/i18n";
import { PersonAvatar } from "../MessageAuthor";
import { formatPoints } from "./AchievementsPage";
import { PointsPill } from "./Gamertag";
import { achievementIcon } from "./icons";
import "./achievements.css";

export interface MemberCardRow {
  id: string;
  name: string;
  icon: string;
  points: number;
  unlocked: boolean;
  current?: number;
  target?: number;
}

/** Your list: locked secrets stay out until they unlock. Locked rows keep progress. */
export function memberCardRows(snapshot: Pick<AchievementSnapshot, "items">): MemberCardRow[] {
  const states = new Map(snapshot.items.map((item) => [item.id, item]));
  return ACHIEVEMENTS.flatMap((item) => {
    const state = states.get(item.id);
    const unlocked = Boolean(state?.unlockedAt);
    if (item.hidden && !unlocked) return [];
    return [rowFrom(item.id, item.name, item.icon, item.points, unlocked, state)];
  });
}

/** A colleague's list: only the ids their public card carried. */
export function publicMemberRows(unlocked: readonly { id: string; points: number }[]): MemberCardRow[] {
  const byId = new Map(unlocked.map((item) => [item.id, item]));
  return ACHIEVEMENTS.flatMap((item) => {
    const entry = byId.get(item.id);
    if (!entry) return [];
    const known = achievementById(item.id);
    if (!known) return [];
    return [rowFrom(known.id, known.name, known.icon, entry.points, true)];
  });
}

function rowFrom(
  id: string,
  name: { en: string; fr: string },
  icon: string,
  points: number,
  unlocked: boolean,
  state?: AchievementItemState,
): MemberCardRow {
  return {
    id,
    name: localized(name),
    icon,
    points,
    unlocked,
    ...(!unlocked && state ? { current: state.current, target: state.target } : {}),
  };
}

/** The chosen title in the person's language, or null when they have none. */
export function achievementTitleName(titleId: string | undefined): string | null {
  if (!titleId) return null;
  for (const item of ACHIEVEMENTS) {
    for (const reward of item.rewards) {
      if (reward.kind === "title" && reward.id === titleId) return localized(reward.name);
    }
  }
  return null;
}

export function MemberTitleButton({ title, onOpen, footer = false }: { title: string; onOpen: () => void; footer?: boolean }) {
  return (
    <button
      type="button"
      data-member-title=""
      className={`min-w-0 truncate rounded-md px-1 text-left text-sidebar-ink-secondary hover:bg-sidebar-hover hover:text-sidebar-ink ${footer ? "text-[13px] leading-[18px]" : "text-[11px] leading-4"}`}
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
    >
      {title}
    </button>
  );
}

function MemberCardList({ rows }: { rows: readonly MemberCardRow[] }) {
  return (
    <ul className="member-card-list" aria-label={t("achievements.menu")}>
      {rows.map((row) => {
        const Icon = achievementIcon(row.icon);
        const progress = !row.unlocked && row.target !== undefined && row.target > 1 ? `${row.current ?? 0}/${row.target}` : null;
        return (
          <li
            key={row.id}
            className="member-card-row"
            data-achievement={row.id}
            data-unlocked={row.unlocked ? "" : undefined}
            data-locked={row.unlocked ? undefined : ""}
          >
            <span className="member-card-icon" aria-hidden="true">
              <Icon size={15} strokeWidth={2.2} />
            </span>
            <span className="member-card-name">{row.name}</span>
            {progress && <span className="member-card-progress">{progress}</span>}
            <span className="member-card-points">{row.points}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function MemberCard({
  name,
  initials,
  avatarUrl,
  title,
  pointsText,
  level,
  rows,
  onOpenPage,
  variant = "blade",
}: {
  name: string;
  initials: string;
  avatarUrl?: string;
  title?: string | null;
  pointsText: string | null;
  level?: number;
  rows: readonly MemberCardRow[];
  /** Your card only: the existing achievements page. */
  onOpenPage?: () => void;
  /** blade: the popover. panel: title, points and the list under a person's name. */
  variant?: "blade" | "panel";
}) {
  return (
    <div className={variant === "panel" ? "member-card member-card-panel" : "member-card"} data-member-card="" data-member-variant={variant}>
      {variant === "blade" ? (
        <div className="member-card-head">
          <PersonAvatar avatarUrl={avatarUrl} initials={initials} size={40} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-medium leading-5 text-ink">{name}</div>
            {title ? <div className="truncate text-[12px] leading-4 text-ink-secondary">{title}</div> : null}
            {pointsText ? (
              <div className="mt-0.5 flex items-center gap-1.5 text-[12px] leading-4 text-ink-secondary">
                <Trophy size={12} strokeWidth={2.4} className="shrink-0 text-[#e0a82e]" aria-hidden="true" />
                <span className="tabular-nums text-ink">{pointsText}</span>
                <span>{t("achievements.pointsUnit")}</span>
                {level !== undefined && <span className="text-ink-tertiary">{t("achievements.level", { level })}</span>}
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        (title || pointsText) ? (
          <div className="mb-1 flex min-w-0 items-center gap-1">
            {title ? <span className="min-w-0 truncate text-[12px] leading-4 text-ink-secondary">{title}</span> : null}
            {pointsText ? (
              <span className="achievement-gamertag pointer-events-none">
                <Trophy size={11} strokeWidth={2.4} aria-hidden="true" />
                <span>{pointsText}</span>
              </span>
            ) : null}
          </div>
        ) : null
      )}
      <MemberCardList rows={rows} />
      {onOpenPage && (
        <button type="button" data-achievements-open="" className="member-card-open" onClick={onOpenPage}>
          {t("achievements.card.view")}
        </button>
      )}
    </div>
  );
}

function useAnchoredDismiss(
  open: boolean,
  anchorRef: { readonly current: HTMLElement | null },
  cardRef: { readonly current: HTMLElement | null },
  close: () => void,
) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      event.preventDefault();
      closeRef.current();
    };
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (anchorRef.current?.contains(target) || cardRef.current?.contains(target))) return;
      closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [open, anchorRef, cardRef]);
}

/** The blade, fixed to the sidebar row so the scrolling list does not clip it. */
export function AnchoredMemberCard({
  open,
  anchorRef,
  onClose,
  ...card
}: {
  open: boolean;
  anchorRef: { readonly current: HTMLElement | null };
  onClose: () => void;
} & Parameters<typeof MemberCard>[0]) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ top?: number; bottom?: number; left: number } | null>(null);
  useAnchoredDismiss(open, anchorRef, cardRef, onClose);
  useLayoutEffect(() => {
    if (!open) return;
    const placeCard = () => {
      const anchor = anchorRef.current?.getBoundingClientRect();
      if (!anchor || typeof window === "undefined") return;
      const width = 300;
      const left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8));
      const spaceBelow = window.innerHeight - anchor.bottom;
      const next: { top?: number; bottom?: number; left: number } = spaceBelow < 220 && anchor.top > spaceBelow
        ? { bottom: window.innerHeight - anchor.top + 6, left }
        : { top: anchor.bottom + 6, left };
      setPlace((prev) => (prev && prev.top === next.top && prev.bottom === next.bottom && prev.left === next.left ? prev : next));
    };
    placeCard();
    window.addEventListener("resize", placeCard);
    window.addEventListener("scroll", placeCard, { capture: true, passive: true });
    return () => {
      window.removeEventListener("resize", placeCard);
      window.removeEventListener("scroll", placeCard, { capture: true });
    };
  }, [open, anchorRef]);
  if (!open || !place || typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={cardRef}
      role="dialog"
      aria-label={t("achievements.menu")}
      data-member-card-popover=""
      style={{ position: "fixed", zIndex: 60, left: place.left, top: place.top, bottom: place.bottom }}
    >
      <MemberCard {...card} />
    </div>,
    document.body,
  );
}

/** Title and points on one line. Either one opens the card. Nothing, when both are absent. */
export function MemberAchievementLine({
  title,
  pointsText,
  label,
  card,
}: {
  title: string | null;
  pointsText: string | null;
  label: string;
  card: Parameters<typeof MemberCard>[0];
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const toggle = () => setOpen((value) => !value);
  if (!title && !pointsText) return null;
  return (
    <>
      <div ref={anchorRef} className="flex min-w-0 items-center gap-1" data-member-line="">
        {title ? <MemberTitleButton title={title} onOpen={toggle} /> : null}
        {pointsText ? <PointsPill text={pointsText} label={label} onOpen={toggle} /> : null}
      </div>
      <AnchoredMemberCard open={open} anchorRef={anchorRef} onClose={() => setOpen(false)} {...card} />
    </>
  );
}

/** A colleague's second line. The caller already knows the card is public. */
export function ColleagueAchievementLine({
  card,
  name,
  initials,
  avatarUrl,
}: {
  card: PublicAchievementCard;
  name: string;
  initials: string;
  avatarUrl?: string;
}) {
  const title = achievementTitleName(card.title);
  const pointsText = formatPoints(card.points);
  return (
    <MemberAchievementLine
      title={title}
      pointsText={pointsText}
      label={t("achievements.colleaguePoints", { points: pointsText })}
      card={{
        name,
        initials,
        avatarUrl,
        title,
        pointsText,
        level: card.level,
        rows: publicMemberRows(card.unlocked),
      }}
    />
  );
}
