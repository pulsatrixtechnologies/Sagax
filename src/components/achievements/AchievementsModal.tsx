// Achievements, in their own modal beside Settings (same shell: a left
// column and a content pane, the close button top right). The left column
// lists the categories, All first, each with how many of its achievements
// are unlocked; the pane is AchievementsPage for the chosen one. Opened from
// the account menu (store action toggleAchievements).
import { useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Crown, Flame, GraduationCap, Lock, Mic, Rocket, Trophy, Users, X, Zap, Gauge, type LucideIcon } from "lucide-react";
import { ACHIEVEMENTS } from "../../../shared/achievements-catalog";
import { ACHIEVEMENT_CATEGORIES, type AchievementCategory } from "../../../shared/achievements";
import { useAchievements } from "@/lib/achievements";
import { t } from "@/lib/i18n";
import { CATEGORY_MODAL, categoryNavItemClass, nextCategory, useCategoryModalKeyboard } from "../category-modal";
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
  mastery: GraduationCap,
  tiers: Crown,
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

  const close = () => dispatch({ type: "toggleAchievements", open: false });
  useCategoryModalKeyboard(dialogRef, '[data-achievements-nav] [aria-current="page"]', close);

  // Up and Down (Home, End) walk the categories and show each one.
  const onNavKey = (event: ReactKeyboardEvent<HTMLElement>) => {
    const id = nextCategory(ACHIEVEMENTS_MODAL_CATEGORIES, category, event.key);
    if (id === null) return;
    event.preventDefault();
    setCategory(id);
    navRef.current?.querySelector<HTMLElement>(`[data-achievement-category="${id}"]`)?.focus();
  };

  return (
    <div
      className={CATEGORY_MODAL.backdrop}
      onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="achievements-modal-title"
        tabIndex={-1}
        data-achievements-modal=""
        className={CATEGORY_MODAL.frame}
      >
        <span id="achievements-modal-title" className="sr-only">{t("achievements.menu")}</span>
        <nav
          ref={navRef}
          data-achievements-nav=""
          aria-label={t("achievements.categories")}
          onKeyDown={onNavKey}
          className={CATEGORY_MODAL.nav}
        >
          <div className={CATEGORY_MODAL.navTitle}>{t("achievements.menu")}</div>
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
                className={categoryNavItemClass(category === id)}
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

        <div className={CATEGORY_MODAL.content}>
          <button
            type="button"
            onClick={close}
            aria-label={t("common.close")}
            title={`${t("common.close")} (${shortcutLabel("close-panel")})`}
            className={CATEGORY_MODAL.close}
          >
            <X size={18} />
          </button>
          <div className={CATEGORY_MODAL.mobileBar}>
            <select
              aria-label={t("achievements.categories")}
              value={category}
              onChange={(event) => setCategory(event.target.value as AchievementsModalCategory)}
              className={CATEGORY_MODAL.mobileSelect}
            >
              {ACHIEVEMENTS_MODAL_CATEGORIES.map((id) => (
                <option key={id} value={id}>
                  {achievementCategoryLabel(id)}{snapshot ? ` (${counts[id].unlocked}/${counts[id].total})` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className={CATEGORY_MODAL.pane} data-achievements-pane="">
            <h2 className={CATEGORY_MODAL.heading}>
              {achievementCategoryLabel(category)}
            </h2>
            <div className={CATEGORY_MODAL.body}>
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
