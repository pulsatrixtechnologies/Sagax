// Achievements, a full page of the content frame like Automations and
// Remote sessions (activeView "achievements"; store action showAchievements,
// from the account menu, the person panel's Achievements tab and the
// `#achievements/<category>` address). A header with the way back and the
// title, then a left column and a content pane. The left column lists the
// categories, All first and Settings (the feature-wide settings, on their
// own) last, each with how many of its achievements are unlocked; the pane
// is AchievementsPage for the chosen one.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Crown, Flame, GraduationCap, Lock, Mic, Rocket, ArrowLeft, Settings, Sparkles, Trophy, Users, Zap, Gauge, type LucideIcon } from "lucide-react";
import { ACHIEVEMENTS } from "../../../shared/achievements-catalog";
import { ACHIEVEMENT_CATEGORIES } from "../../../shared/achievements";
import { useAchievements } from "@/lib/achievements";
import { t } from "@/lib/i18n";
import { categoryNavItemClass, nextCategory } from "../category-modal";
import { useStore, type AchievementsCategory } from "@/state/store";
import { WindowDragStrip, useCaptionChrome } from "../DesktopCapabilities";
import { cn } from "@/lib/cn";
import { AchievementSettingsPage, AchievementsPage, achievementCategoryLabel } from "./AchievementsPage";

export type AchievementsScreenCategory = AchievementsCategory;

export const ACHIEVEMENTS_SCREEN_CATEGORIES: readonly AchievementsScreenCategory[] = ["all", ...ACHIEVEMENT_CATEGORIES, "settings"];

const CATEGORY_ICON: Record<AchievementsScreenCategory, LucideIcon> = {
  all: Trophy,
  onboarding: Rocket,
  productivity: Zap,
  power: Gauge,
  voice: Mic,
  claude: Sparkles,
  collaboration: Users,
  streaks: Flame,
  mastery: GraduationCap,
  tiers: Crown,
  secrets: Lock,
  settings: Settings,
};

/** Unlocked and total per category, All included. Secrets count like the
 * others: their cards are on the page already, masked. */
export function achievementCategoryCounts(unlocked: ReadonlySet<string>): Record<AchievementsScreenCategory, { unlocked: number; total: number }> {
  const counts = Object.fromEntries(ACHIEVEMENTS_SCREEN_CATEGORIES.map((id) => [id, { unlocked: 0, total: 0 }])) as Record<AchievementsScreenCategory, { unlocked: number; total: number }>;
  for (const item of ACHIEVEMENTS) {
    const got = unlocked.has(item.id) ? 1 : 0;
    counts.all.total += 1;
    counts.all.unlocked += got;
    counts[item.category].total += 1;
    counts[item.category].unlocked += got;
  }
  return counts;
}

export function AchievementsScreen({ initialCategory }: { initialCategory?: AchievementsScreenCategory }) {
  const { state, dispatch } = useStore();
  const { dragProps } = useCaptionChrome();
  const { snapshot } = useAchievements();
  const focus = state.achievementsFocus;
  const [category, setCategory] = useState<AchievementsScreenCategory>(initialCategory ?? focus.category);
  const navRef = useRef<HTMLElement>(null);

  // A link to another category while the page shows re-selects it.
  const seen = useRef(focus.nonce);
  useEffect(() => {
    if (seen.current === focus.nonce) return;
    seen.current = focus.nonce;
    setCategory(focus.category);
  }, [focus]);

  // Opened from the keyboard, the arrows work at once: focus lands on the
  // current category, as the modal it replaces did.
  useEffect(() => {
    navRef.current?.querySelector<HTMLElement>('[aria-current="page"]')?.focus({ preventScroll: true });
  }, []);

  const counts = useMemo(() => {
    const unlocked = new Set((snapshot?.items ?? []).filter((item) => item.unlockedAt).map((item) => item.id));
    return achievementCategoryCounts(unlocked);
  }, [snapshot]);

  const back = () => dispatch({ type: "showChat" });

  // Up and Down (Home, End) walk the categories and show each one.
  const onNavKey = (event: ReactKeyboardEvent<HTMLElement>) => {
    const id = nextCategory(ACHIEVEMENTS_SCREEN_CATEGORIES, category, event.key);
    if (id === null) return;
    event.preventDefault();
    setCategory(id);
    navRef.current?.querySelector<HTMLElement>(`[data-achievement-category="${id}"]`)?.focus();
  };

  return (
    <main
      data-achievements-screen=""
      className="relative flex h-full min-w-0 flex-1 flex-col bg-app outline-none"
      onKeyDown={(event) => {
        // Escape goes back, unless a popover inside already took it.
        if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); back(); }
      }}
    >
      <WindowDragStrip />
      <header {...dragProps} className={cn("flex shrink-0 items-center gap-3 border-b border-hairline/50 px-5 py-3", dragProps.style && "pt-4")}>
        <button
          type="button"
          data-achievements-back=""
          onClick={back}
          aria-label={t("breadcrumb.back")}
          title={t("breadcrumb.back")}
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-hover hover:text-ink"
        >
          <ArrowLeft size={18} aria-hidden="true" />
        </button>
        <Trophy size={18} className="text-ink-secondary" aria-hidden="true" />
        <h1 className="text-[15px] font-medium text-ink">{t("achievements.menu")}</h1>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav
          ref={navRef}
          data-achievements-nav=""
          aria-label={t("achievements.categories")}
          onKeyDown={onNavKey}
          className="hidden min-h-0 w-[198px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-hairline-weak bg-panel px-3 py-4 sm:flex"
        >
          {ACHIEVEMENTS_SCREEN_CATEGORIES.map((id) => {
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
                {snapshot && id !== "settings" && (
                  <span className="shrink-0 text-[11.5px] tabular-nums text-ink-secondary" data-achievement-category-count="">
                    {count.unlocked}/{count.total}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="shrink-0 px-4 pb-1 pt-3 sm:hidden">
            <select
              aria-label={t("achievements.categories")}
              value={category}
              onChange={(event) => setCategory(event.target.value as AchievementsScreenCategory)}
              className="w-full min-w-0 rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink focus:border-border-strong focus:outline-none"
            >
              {ACHIEVEMENTS_SCREEN_CATEGORIES.map((id) => (
                <option key={id} value={id}>
                  {achievementCategoryLabel(id)}{snapshot && id !== "settings" ? ` (${counts[id].unlocked}/${counts[id].total})` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-1 flex-col overflow-y-auto" data-achievements-pane="">
            <h2 className="hidden px-8 pb-1 pt-6 text-[17px] font-semibold leading-6 tracking-[-0.008em] text-ink sm:block">
              {achievementCategoryLabel(category)}
            </h2>
            <div className="px-4 pb-6 pt-4 sm:px-8">
              {category === "settings" ? <AchievementSettingsPage /> : <AchievementsPage category={category} />}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
