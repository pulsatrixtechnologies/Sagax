// Achievements, a full page of the content frame like Automations and
// Remote sessions (activeView "achievements"; store action showAchievements,
// from the account menu, the person panel's Achievements tab and the
// `#achievements/<category>` address). Drawn with the Settings window's
// shell (src/components/category-modal.ts, 2026-10-28): the left column
// opens on the way back and the page's title, then the categories, All
// first, each with how many of its achievements are unlocked; the pane has
// the category's heading and AchievementsPage. The feature-wide settings are
// not a category: the gear in the top-right corner opens them in the pane
// (AchievementSettingsPage, still `#achievements/settings`).
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Crown, Flame, GraduationCap, Lock, Mic, Rocket, Settings, Sparkles, Trophy, Users, Zap, Gauge, type LucideIcon } from "lucide-react";
import { ACHIEVEMENTS } from "../../../shared/achievements-catalog";
import { ACHIEVEMENT_CATEGORIES, type AchievementCategory } from "../../../shared/achievements";
import { useAchievements } from "@/lib/achievements";
import { isBackShortcut } from "@/lib/back-shortcut";
import { lastInputWasPointer, trackInputModality } from "@/lib/input-modality";
import { t } from "@/lib/i18n";
import { CATEGORY_MODAL, categoryNavItemClass, nextCategory } from "../category-modal";
import { BackButton } from "../Breadcrumb";
import { useStore, type AchievementsCategory } from "@/state/store";
import { WindowDragStrip, useCaptionChrome } from "../DesktopCapabilities";
import { cn } from "@/lib/cn";
import { AchievementSettingsPage, AchievementsPage, achievementCategoryLabel } from "./AchievementsPage";

/** What the pane shows: a category, or the settings (the header's gear). */
export type AchievementsScreenCategory = AchievementsCategory;
/** An entry of the left column: All and the categories, not the settings. */
export type AchievementsNavCategory = AchievementCategory | "all";

export const ACHIEVEMENTS_SCREEN_CATEGORIES: readonly AchievementsNavCategory[] = ["all", ...ACHIEVEMENT_CATEGORIES];

const CATEGORY_ICON: Record<AchievementsNavCategory, LucideIcon> = {
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
};

/** Unlocked and total per category, All included. Secrets count like the
 * others: their cards are on the page already, masked. */
export function achievementCategoryCounts(unlocked: ReadonlySet<string>): Record<AchievementsNavCategory, { unlocked: number; total: number }> {
  const counts = Object.fromEntries(ACHIEVEMENTS_SCREEN_CATEGORIES.map((id) => [id, { unlocked: 0, total: 0 }])) as Record<AchievementsNavCategory, { unlocked: number; total: number }>;
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
  const { dragProps, controlsShiftStyle } = useCaptionChrome();
  const { snapshot } = useAchievements();
  const focus = state.achievementsFocus;
  const [category, setCategory] = useState<AchievementsScreenCategory>(initialCategory ?? focus.category);
  const navRef = useRef<HTMLElement>(null);
  const settingsOpen = category === "settings";

  // A link to another category while the page shows re-selects it.
  const seen = useRef(focus.nonce);
  useEffect(() => {
    if (seen.current === focus.nonce) return;
    seen.current = focus.nonce;
    setCategory(focus.category);
  }, [focus]);

  // Opened from the keyboard, the arrows work at once: focus lands on the
  // current category, as the modal it replaces did. Opened with a click (the
  // account menu), the entry takes focus without the keyboard ring, which
  // Chromium would otherwise draw around a programmatic focus after a menu;
  // Tab or an arrow key brings the ring back (src/lib/input-modality.ts).
  trackInputModality();
  useEffect(() => {
    const current = navRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!current) return;
    if (lastInputWasPointer()) current.dataset.pointerFocus = "";
    current.focus({ preventScroll: true });
  }, []);

  const counts = useMemo(() => {
    const unlocked = new Set((snapshot?.items ?? []).filter((item) => item.unlockedAt).map((item) => item.id));
    return achievementCategoryCounts(unlocked);
  }, [snapshot]);

  const back = () => dispatch({ type: "showChat" });

  // Up and Down (Home, End) walk the categories and show each one; from the
  // settings, they start at All.
  const onNavKey = (event: ReactKeyboardEvent<HTMLElement>) => {
    const id = nextCategory(ACHIEVEMENTS_SCREEN_CATEGORIES, settingsOpen ? "all" : category, event.key);
    if (id === null) return;
    event.preventDefault();
    setCategory(id);
    navRef.current?.querySelector<HTMLElement>(`[data-achievement-category="${id}"]`)?.focus();
  };

  return (
    <main
      data-achievements-screen=""
      className="relative flex h-full min-w-0 flex-1 bg-app outline-none"
      onKeyDown={(event) => {
        // Escape (unless a popover inside already took it) and Cmd/Ctrl+[ go back.
        if (event.defaultPrevented) return;
        if (event.key === "Escape" || isBackShortcut(event)) { event.preventDefault(); back(); }
      }}
    >
      <WindowDragStrip />
      <nav
        ref={navRef}
        data-achievements-nav=""
        aria-label={t("achievements.categories")}
        onKeyDown={onNavKey}
        className={cn(CATEGORY_MODAL.nav, dragProps.style && "pt-8")}
      >
        {/* Settings' rail title, with the page's way back before it */}
        <header {...dragProps} data-achievements-header="" className={cn(CATEGORY_MODAL.navTitle, "-ml-1 flex items-center gap-1 pl-0")}>
          <BackButton onBack={back} data={{ "data-achievements-back": "" }} />
          <h1 className="min-w-0 truncate text-[13px] font-semibold text-ink">{t("achievements.menu")}</h1>
        </header>
        {ACHIEVEMENTS_SCREEN_CATEGORIES.map((id) => {
          const Icon = CATEGORY_ICON[id];
          const count = counts[id];
          return (
            <button
              key={id}
              type="button"
              data-achievement-category={id}
              onClick={() => setCategory(id)}
              onBlur={(event) => { delete event.currentTarget.dataset.pointerFocus; }}
              aria-current={category === id ? "page" : undefined}
              className={categoryNavItemClass(category === id)}
            >
              {/* Settings' nav item: 15 px icon with the thinner stroke */}
              <Icon size={15} strokeWidth={1.5} className="shrink-0" aria-hidden="true" />
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
        {/* The page's settings, in the corner where Settings has its close button */}
        <button
          type="button"
          data-achievements-settings-button=""
          onClick={() => setCategory(settingsOpen ? "all" : "settings")}
          aria-label={t("achievements.settings.title")}
          aria-pressed={settingsOpen}
          title={t("achievements.settings.title")}
          style={controlsShiftStyle}
          className={cn(CATEGORY_MODAL.corner, "window-no-drag", settingsOpen && "bg-selected text-ink")}
        >
          <Settings size={17} strokeWidth={1.5} aria-hidden="true" />
        </button>
        <div className={cn(CATEGORY_MODAL.mobileBar, "flex items-center gap-1.5")}>
          <BackButton onBack={back} />
          <select
            aria-label={t("achievements.categories")}
            value={category}
            onChange={(event) => setCategory(event.target.value as AchievementsScreenCategory)}
            className={CATEGORY_MODAL.mobileSelect}
          >
            {ACHIEVEMENTS_SCREEN_CATEGORIES.map((id) => (
              <option key={id} value={id}>
                {achievementCategoryLabel(id)}{snapshot ? ` (${counts[id].unlocked}/${counts[id].total})` : ""}
              </option>
            ))}
            {/* shown while the gear's settings are open, never offered */}
            <option value="settings" hidden disabled>{achievementCategoryLabel("settings")}</option>
          </select>
        </div>
        <div className={CATEGORY_MODAL.pane} data-achievements-pane="">
          <h2 className={CATEGORY_MODAL.heading}>{achievementCategoryLabel(category)}</h2>
          <div className={CATEGORY_MODAL.body}>
            {settingsOpen ? <AchievementSettingsPage /> : <AchievementsPage category={category} />}
          </div>
        </div>
      </div>
    </main>
  );
}
