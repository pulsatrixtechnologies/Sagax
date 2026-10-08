// Achievements, in their own modal beside Settings (same shell: a left
// column and a content pane, the close button top right). The left column
// lists the categories, All first, each with how many of its achievements
// are unlocked; the pane is AchievementsPage for the chosen one. Opened from
// the account menu (store action toggleAchievements).
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Crown, Flame, Lock, Mic, Rocket, Trophy, Users, X, Zap, Gauge, type LucideIcon } from "lucide-react";
import { ACHIEVEMENTS } from "../../../shared/achievements-catalog";
import { ACHIEVEMENT_CATEGORIES, type AchievementCategory } from "../../../shared/achievements";
import { useAchievements } from "@/lib/achievements";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { useStore } from "@/state/store";
import { useRetroSkin } from "../RetroChromeHost";
import { shortcutLabel } from "../ShortcutHint";
import { AchievementsPage, achievementCategoryLabel } from "./AchievementsPage";

export type AchievementsModalCategory = AchievementCategory | "all";

export const ACHIEVEMENTS_MODAL_CATEGORIES: readonly AchievementsModalCategory[] = ["all", ...ACHIEVEMENT_CATEGORIES];

const CATEGORY_ICON: Record<AchievementsModalCategory, LucideIcon> = {
  all: Trophy,
  onboarding: Rocket,
  productivity: Zap,
  power: Gauge,
  voice: Mic,
  collaboration: Users,
  streaks: Flame,
  mastery: Crown,
  secrets: Lock,
};

/** Unlocked and total per category, All included. Secrets count like the
 * others: their cards are on the page already, masked. */
export function achievementCategoryCounts(unlocked: ReadonlySet<string>): Record<AchievementsModalCategory, { unlocked: number; total: number }> {
  const counts = Object.fromEntries(ACHIEVEMENTS_MODAL_CATEGORIES.map((id) => [id, { unlocked: 0, total: 0 }])) as Record<AchievementsModalCategory, { unlocked: number; total: number }>;
  for (const item of ACHIEVEMENTS) {
    const got = unlocked.has(item.id) ? 1 : 0;
    counts.all.total += 1;
    counts.all.unlocked += got;
    counts[item.category].total += 1;
    counts[item.category].unlocked += got;
  }
  return counts;
}

export function AchievementsModal({ initialCategory = "all" }: { initialCategory?: AchievementsModalCategory }) {
  const { dispatch } = useStore();
  const retroSkin = useRetroSkin();
  const { snapshot } = useAchievements();
  const [category, setCategory] = useState<AchievementsModalCategory>(initialCategory);
  const dialogRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);

  const counts = useMemo(() => {
    const unlocked = new Set((snapshot?.items ?? []).filter((item) => item.unlockedAt).map((item) => item.id));
    return achievementCategoryCounts(unlocked);
  }, [snapshot]);

  // Same keyboard as Settings: focus moves in, Escape closes, Tab stays in
  // the dialog, and focus goes back where it was on close.
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const current = dialog?.querySelector<HTMLElement>('[data-achievements-nav] [aria-current="page"]');
    if (current?.checkVisibility()) current.focus();
    else dialog?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        dispatch({ type: "toggleAchievements", open: false });
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.checkVisibility());
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previousFocus?.focus();
    };
  }, [dispatch]);

  const close = () => dispatch({ type: "toggleAchievements", open: false });

  // Up and Down (Home, End) walk the categories and show each one.
  const onNavKey = (event: ReactKeyboardEvent<HTMLElement>) => {
    const index = ACHIEVEMENTS_MODAL_CATEGORIES.indexOf(category);
    const next =
      event.key === "ArrowDown" ? Math.min(index + 1, ACHIEVEMENTS_MODAL_CATEGORIES.length - 1)
        : event.key === "ArrowUp" ? Math.max(index - 1, 0)
          : event.key === "Home" ? 0
            : event.key === "End" ? ACHIEVEMENTS_MODAL_CATEGORIES.length - 1
              : -1;
    if (next < 0) return;
    event.preventDefault();
    const id = ACHIEVEMENTS_MODAL_CATEGORIES[next];
    setCategory(id);
    navRef.current?.querySelector<HTMLElement>(`[data-achievement-category="${id}"]`)?.focus();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-6"
      onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="achievements-modal-title"
        tabIndex={-1}
        data-achievements-modal=""
        className="flex h-[min(700px,calc(100dvh-96px))] w-[min(900px,calc(100vw-40px))] overflow-hidden rounded-[14px] border border-border bg-app outline-none"
      >
        <span id="achievements-modal-title" className="sr-only">{t("achievements.menu")}</span>
        <nav
          ref={navRef}
          data-achievements-nav=""
          aria-label={t("achievements.categories")}
          onKeyDown={onNavKey}
          className="hidden min-h-0 w-[198px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-hairline-weak bg-panel px-3 py-4 sm:flex"
        >
          <div className="shrink-0 px-2 py-2 text-[13px] font-semibold text-ink">{t("achievements.menu")}</div>
          {ACHIEVEMENTS_MODAL_CATEGORIES.map((id) => {
            const Icon = CATEGORY_ICON[id];
            const count = counts[id];
            return (
              <button
                key={id}
                type="button"
                data-achievement-category={id}
                onClick={() => setCategory(id)}
                aria-current={category === id ? "page" : undefined}
                className={cn(
                  "flex items-center gap-[9px] rounded-lg px-[9px] py-[7px] text-left text-[13px] leading-[18px] text-ink transition-colors motion-reduce:transition-none",
                  category === id ? "bg-selected" : "hover:bg-hover",
                )}
              >
                <Icon size={15} className="shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{achievementCategoryLabel(id)}</span>
                {snapshot && (
                  <span className="shrink-0 text-[11.5px] tabular-nums text-ink-secondary" data-achievement-category-count="">
                    {count.unlocked}/{count.total}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <button
            type="button"
            onClick={close}
            aria-label={t("common.close")}
            title={`${t("common.close")} (${shortcutLabel("close-panel")})`}
            className="absolute right-2.5 top-2.5 z-10 flex size-8 items-center justify-center rounded-full text-ink-tertiary hover:bg-ink/10 hover:text-ink-secondary"
          >
            <X size={18} />
          </button>
          <div className="shrink-0 px-4 pb-1 pr-12 pt-3 sm:hidden">
            <select
              aria-label={t("achievements.categories")}
              value={category}
              onChange={(event) => setCategory(event.target.value as AchievementsModalCategory)}
              className="w-full min-w-0 rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink focus:border-border-strong focus:outline-none"
            >
              {ACHIEVEMENTS_MODAL_CATEGORIES.map((id) => (
                <option key={id} value={id}>
                  {achievementCategoryLabel(id)}{snapshot ? ` (${counts[id].unlocked}/${counts[id].total})` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-1 flex-col overflow-y-auto" data-achievements-pane="">
            <h2 className="hidden px-8 pb-1 pt-6 text-[17px] font-semibold leading-6 tracking-[-0.008em] text-ink sm:block">
              {achievementCategoryLabel(category)}
            </h2>
            <div className="px-4 pb-6 pt-4 sm:px-8">
              <AchievementsPage category={category} />
            </div>
          </div>
          {/* Hibou 98 only: the era's dialog footer, as in Settings. */}
          {retroSkin && (
            <div className="r98-dialog-footer">
              <button type="button" className="r98-dialog-ok" onClick={close}>
                {t("retro.button.ok")}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
