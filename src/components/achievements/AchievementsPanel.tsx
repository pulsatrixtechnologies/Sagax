// The Achievements tab of a person's right panel (PersonPanel.tsx), drawn for
// a narrow column (about 400 px, 2026-10-26): no second avatar and name (the
// panel's header already shows them), a compact summary (level, title,
// points, a bar to the next level), the last few unlocks as small tiles,
// then every achievement as a grid of icons grouped by category. An
// unlocked tile is in colour, a locked one greyed. Hover names it with its
// points; a click opens a small popover with its description, points, and
// the date it unlocked or what unlocks it. "View all" opens the full
// achievements page, on your own panel only (it shows your own record).
//
// Same rendering for your own panel and a colleague's: both read the public
// card (GET /api/achievements/public), so what a person hid ("Show my
// points", "Show my title") stays hidden here too. Locked tiles come from
// the catalog, never from the person's record: a locked secret stays out.
import { useEffect, useMemo, useRef, useState } from "react";
import { Lock, Trophy, X } from "lucide-react";
import { ACHIEVEMENTS } from "../../../shared/achievements-catalog";
import { levelFor, type AchievementCategory, type AchievementDefinition, type PublicAchievementCard } from "../../../shared/achievements";
import { localized } from "@/lib/achievements";
import { activeLocale, t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { achievementIcon } from "./icons";
import { CATEGORY_LABEL, formatPoints } from "./AchievementsPage";
import "./achievements.css";

/** How many recent unlocks the panel shows. */
export const PANEL_RECENT = 4;

export interface PanelTile {
  item: AchievementDefinition;
  unlocked: boolean;
  /** When it unlocked (ms), for an unlocked tile. */
  unlockedAt?: number;
  /** The points it gave (the card's value), else the catalog's. */
  points: number;
}

export interface PanelCategory {
  category: AchievementCategory;
  tiles: PanelTile[];
  unlocked: number;
}

/**
 * Every achievement the panel may draw, by category in catalog order: the
 * card's unlocked ones in colour, the others locked. A secret that is not
 * unlocked stays out, and a category left empty is dropped.
 */
export function panelCategories(card: Pick<PublicAchievementCard, "unlocked">): PanelCategory[] {
  const unlocked = new Map(card.unlocked.map((entry) => [entry.id, entry]));
  const byCategory = new Map<AchievementCategory, PanelCategory>();
  for (const item of ACHIEVEMENTS) {
    const entry = unlocked.get(item.id);
    if (!entry && item.hidden) continue;
    const group = byCategory.get(item.category) ?? { category: item.category, tiles: [], unlocked: 0 };
    group.tiles.push(entry ? { item, unlocked: true, unlockedAt: entry.unlockedAt, points: entry.points } : { item, unlocked: false, points: item.points });
    if (entry) group.unlocked += 1;
    byCategory.set(item.category, group);
  }
  return [...byCategory.values()].filter((group) => group.tiles.length > 0);
}

/** The last unlocks, newest first. */
export function panelRecent(card: Pick<PublicAchievementCard, "unlocked">, limit = PANEL_RECENT): PanelTile[] {
  const known = new Map(ACHIEVEMENTS.map((item) => [item.id, item]));
  return [...card.unlocked]
    .filter((entry) => known.has(entry.id))
    .sort((a, b) => b.unlockedAt - a.unlockedAt)
    .slice(0, limit)
    .map((entry) => ({ item: known.get(entry.id)!, unlocked: true, unlockedAt: entry.unlockedAt, points: entry.points }));
}

export function shortDate(at: number, locale = activeLocale()): string {
  const date = new Date(at);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  try {
    return date.toLocaleDateString(locale, sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function tileLabel(tile: PanelTile): string {
  const name = localized(tile.item.name);
  const points = t("achievements.panel.points", { points: formatPoints(tile.points) });
  return tile.unlocked ? `${name} · ${points}` : `${name} · ${points} · ${t("achievements.locked")}`;
}

interface OpenTile {
  id: string;
  top: number;
  arrow: number;
}

function TileDetail({ tile, at, onClose }: { tile: PanelTile; at: OpenTile; onClose: () => void }) {
  const Icon = achievementIcon(tile.item.icon);
  return (
    <div
      role="dialog"
      id={`achievement-detail-${tile.item.id}`}
      aria-label={localized(tile.item.name)}
      data-achievement-detail={tile.item.id}
      className="achievement-panel-popover"
      style={{ top: at.top, ["--arrow-x" as string]: `${at.arrow}px` }}
    >
      <div className="flex items-start gap-2.5">
        <span className="achievement-panel-tile-icon" data-unlocked={tile.unlocked ? "" : undefined} aria-hidden="true">
          {tile.unlocked ? <Icon size={16} strokeWidth={2.2} /> : <Lock size={14} strokeWidth={2.2} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium leading-[18px] text-ink">{localized(tile.item.name)}</div>
          <div className="text-[11.5px] leading-4 tabular-nums text-ink-secondary">
            {t("achievements.panel.points", { points: formatPoints(tile.points) })}
            {" · "}
            {tile.unlocked && tile.unlockedAt
              ? t("achievements.panel.unlockedOn", { date: shortDate(tile.unlockedAt) })
              : t("achievements.locked")}
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label={t("common.close")} title={t("common.close")} className="ui-icon-button -mr-1 -mt-1 shrink-0">
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      <p className="mt-2 text-[12.5px] leading-[18px] text-ink-secondary">
        {!tile.unlocked && <span className="font-medium text-ink">{t("achievements.panel.toUnlock")} </span>}
        {localized(tile.item.description)}
      </p>
    </div>
  );
}

function TileGrid({ tiles, open, onToggle, onClose }: { tiles: PanelTile[]; open: OpenTile | null; onToggle: (id: string, button: HTMLButtonElement) => void; onClose: () => void }) {
  const openTile = open ? tiles.find((tile) => tile.item.id === open.id) : undefined;
  return (
    <div className="relative">
      <ul className="achievement-panel-grid">
        {tiles.map((tile) => {
          const Icon = achievementIcon(tile.item.icon);
          const label = tileLabel(tile);
          const expanded = open?.id === tile.item.id;
          return (
            <li key={tile.item.id}>
              <button
                type="button"
                className="achievement-panel-tile"
                data-achievement={tile.item.id}
                data-unlocked={tile.unlocked ? "" : undefined}
                data-locked={tile.unlocked ? undefined : ""}
                aria-label={label}
                title={label}
                aria-expanded={expanded}
                aria-controls={expanded ? `achievement-detail-${tile.item.id}` : undefined}
                onClick={(event) => onToggle(tile.item.id, event.currentTarget)}
              >
                <span className="achievement-panel-tile-icon" data-unlocked={tile.unlocked ? "" : undefined} aria-hidden="true">
                  <Icon size={17} strokeWidth={2.2} />
                </span>
                <span className="achievement-panel-tile-points">{formatPoints(tile.points)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {openTile && open && <TileDetail tile={openTile} at={open} onClose={onClose} />}
    </div>
  );
}

export function AchievementsPanel({
  card,
  title,
  onOpenPage,
  emptyText,
}: {
  card: PublicAchievementCard;
  /** Shown in place of the recent unlocks when there is none. */
  emptyText?: string;
  /** The chosen title, in the viewer's language, or null. */
  title: string | null;
  /** Your own panel only: the full achievements page. */
  onOpenPage?: () => void;
}) {
  const categories = useMemo(() => panelCategories(card), [card]);
  const recent = useMemo(() => panelRecent(card), [card]);
  const total = categories.reduce((sum, group) => sum + group.tiles.length, 0);
  const unlockedCount = categories.reduce((sum, group) => sum + group.unlocked, 0);
  const [open, setOpen] = useState<OpenTile | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest("[data-achievement-detail]") && !target?.closest(".achievement-panel-tile")) setOpen(null);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const toggle = (id: string, button: HTMLButtonElement) => {
    if (open?.id === id) { setOpen(null); return; }
    const cell = button.parentElement;
    const top = (cell?.offsetTop ?? 0) + button.offsetHeight + 6;
    const arrow = (cell?.offsetLeft ?? 0) + button.offsetWidth / 2;
    setOpen({ id, top, arrow });
  };

  const scored = card.points !== undefined;
  const level = scored ? levelFor(card.points!) : null;
  const span = level ? level.to - level.from : 0;
  const into = level ? card.points! - level.from : 0;

  return (
    <div
      ref={root}
      className="flex flex-col gap-5"
      data-achievements-panel=""
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          const id = open.id;
          setOpen(null);
          root.current?.querySelector<HTMLElement>(`.achievement-panel-tile[data-achievement="${id}"]`)?.focus();
        }
      }}
    >
      <section className="rounded-xl border-[0.5px] border-border bg-elevated px-3.5 py-3" data-achievements-summary="">
        <div className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[radial-gradient(circle_at_35%_30%,#fff,#e0a82e_72%)] text-[#1b1406]" aria-hidden="true">
            <Trophy size={19} strokeWidth={2.2} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              {level && <span className="text-[14px] font-medium leading-5 text-ink" data-member-level="">{t("achievements.level", { level: level.level })}</span>}
              {title && <span className="truncate text-[12.5px] leading-5 text-ink-secondary" data-member-title="">{title}</span>}
            </div>
            <div className="text-[12px] leading-4 text-ink-secondary">{t("achievements.unlockedCount", { count: unlockedCount, total })}</div>
          </div>
        </div>
        {level && (
          <div className="mt-2.5" data-member-points="">
            <div
              className="achievement-progress"
              style={{ ["--tier" as string]: "#e0a82e" }}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={span}
              aria-valuenow={into}
              aria-label={t("achievements.nextLevel")}
            >
              <span style={{ width: `${span > 0 ? Math.min(100, Math.round((into / span) * 100)) : 0}%` }} />
            </div>
            <div className="mt-1 flex items-center justify-between gap-2 text-[11.5px] leading-4 tabular-nums text-ink-secondary">
              <span><span className="text-ink">{formatPoints(card.points!)}</span> / {t("achievements.panel.points", { points: formatPoints(level.to) })}</span>
              <span>{t("achievements.level", { level: level.level + 1 })}</span>
            </div>
          </div>
        )}
      </section>

      {recent.length === 0 && emptyText && <p className="px-0.5 text-[12.5px] text-ink-secondary" data-achievements-empty="">{emptyText}</p>}
      {recent.length > 0 && (
        <section className="flex flex-col gap-2" data-achievements-recent="">
          <h3 className="px-0.5 text-[12px] font-normal leading-4 text-ink-secondary">{t("achievements.recent")}</h3>
          <ul className="grid grid-cols-2 gap-1.5">
            {recent.map((tile) => {
              const Icon = achievementIcon(tile.item.icon);
              return (
                <li key={tile.item.id} data-recent-achievement={tile.item.id} title={tileLabel(tile)} className="flex min-w-0 items-center gap-2 rounded-lg border-[0.5px] border-border bg-elevated px-2 py-1.5">
                  <span className="achievement-panel-tile-icon" data-unlocked="" aria-hidden="true">
                    <Icon size={15} strokeWidth={2.2} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[12.5px] leading-4 text-ink">{localized(tile.item.name)}</span>
                    {tile.unlockedAt ? <span className="block text-[11px] leading-[14px] tabular-nums text-ink-tertiary">{shortDate(tile.unlockedAt)}</span> : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-3" data-achievements-all="">
        <div className="flex items-center justify-between gap-2 px-0.5">
          <h3 className="text-[12px] font-normal leading-4 text-ink-secondary">{t("achievements.panel.all")}</h3>
          {onOpenPage && (
            <button type="button" data-achievements-open="" onClick={onOpenPage} className="text-[12px] leading-4 text-accent hover:underline">
              {t("achievements.panel.viewAll")}
            </button>
          )}
        </div>
        {categories.map((group) => (
          <div key={group.category} className="flex flex-col gap-1.5" data-achievement-category={group.category}>
            <div className="flex items-baseline justify-between gap-2 px-0.5 text-[11.5px] leading-4">
              <span className="font-medium text-ink">{t(CATEGORY_LABEL[group.category])}</span>
              <span className={cn("tabular-nums", group.unlocked === group.tiles.length ? "text-ink-secondary" : "text-ink-tertiary")}>{group.unlocked}/{group.tiles.length}</span>
            </div>
            <TileGrid
              tiles={group.tiles}
              open={open && group.tiles.some((tile) => tile.item.id === open.id) ? open : null}
              onToggle={toggle}
              onClose={() => setOpen(null)}
            />
          </div>
        ))}
      </section>
    </div>
  );
}
