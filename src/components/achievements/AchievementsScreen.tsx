// Achievements, a full page of the content frame like Automations and
// Remote sessions (activeView "achievements"; store action showAchievements,
// from the account menu, the person panel's Achievements tab and the
// `#achievements/<category>` address). One column since 2026-10-28: the
// header (the way back, the page's title, the settings gear in the top-right
// corner), then AchievementsPage: the progress card, the recent unlocks, the
// toolbar (search, the category filter with each category's unlocked count,
// reward, status) and the grid. The categories are a filter of the toolbar,
// not a left column, so the cards take the page's whole width. The
// feature-wide settings open from the gear (AchievementSettingsPage, still
// `#achievements/settings`).
import { useEffect, useRef, useState } from "react";
import { Settings } from "lucide-react";
import { isBackShortcut } from "@/lib/back-shortcut";
import { t } from "@/lib/i18n";
import { CATEGORY_MODAL } from "../category-modal";
import { BackButton } from "../Breadcrumb";
import { useStore, type AchievementsCategory } from "@/state/store";
import { WindowDragStrip, useCaptionChrome } from "../DesktopCapabilities";
import { cn } from "@/lib/cn";
import { AchievementSettingsPage, AchievementsPage } from "./AchievementsPage";
import type { AchievementsNavCategory } from "./achievement-filters";

/** What the page shows: a category, or the settings (the header's gear). */
export type AchievementsScreenCategory = AchievementsCategory;
export { ACHIEVEMENTS_SCREEN_CATEGORIES, achievementCategoryCounts, type AchievementCategoryCounts, type AchievementsNavCategory } from "./achievement-filters";

export function AchievementsScreen({ initialCategory }: { initialCategory?: AchievementsScreenCategory }) {
  const { state, dispatch } = useStore();
  const { dragProps, controlsShiftStyle } = useCaptionChrome();
  const focus = state.achievementsFocus;
  const start = initialCategory ?? focus.category;
  const [category, setCategory] = useState<AchievementsNavCategory>(start === "settings" ? "all" : start);
  const [settingsOpen, setSettingsOpen] = useState(start === "settings");
  const mainRef = useRef<HTMLElement>(null);

  // A link to another category (or to the settings) while the page shows re-selects it.
  const seen = useRef(focus.nonce);
  useEffect(() => {
    if (seen.current === focus.nonce) return;
    seen.current = focus.nonce;
    if (focus.category === "settings") setSettingsOpen(true);
    else { setCategory(focus.category); setSettingsOpen(false); }
  }, [focus]);

  // The page takes focus so Escape and Cmd/Ctrl+[ work at once; Tab then
  // reaches the way back, the gear and the toolbar.
  useEffect(() => { mainRef.current?.focus({ preventScroll: true }); }, []);

  const back = () => dispatch({ type: "showChat" });

  return (
    <main
      ref={mainRef}
      tabIndex={-1}
      data-achievements-screen=""
      className="relative flex h-full min-w-0 flex-1 flex-col bg-app outline-none"
      onKeyDown={(event) => {
        // Escape (unless a popover inside already took it) and Cmd/Ctrl+[ go back.
        if (event.defaultPrevented) return;
        if (event.key === "Escape" || isBackShortcut(event)) { event.preventDefault(); back(); }
      }}
    >
      <WindowDragStrip />
      <div className="min-h-0 flex-1 overflow-y-auto" data-achievements-pane="">
        <div className="mx-auto flex w-full max-w-[1120px] flex-col px-4 pb-10 sm:px-8">
          {/* The page's header: the way back, the title, the settings gear */}
          <header {...dragProps} data-achievements-header="" className={cn("flex items-center gap-1.5 pb-4 pt-4 sm:pt-6", dragProps.style && "pt-9 sm:pt-9")}>
            <span className="-ml-1.5 flex"><BackButton onBack={back} data={{ "data-achievements-back": "" }} /></span>
            <h1 className={cn(CATEGORY_MODAL.title, "min-w-0 flex-1 truncate")}>{t("achievements.menu")}</h1>
            <button
              type="button"
              data-achievements-settings-button=""
              onClick={() => setSettingsOpen((open) => !open)}
              aria-label={t("achievements.settings.title")}
              aria-pressed={settingsOpen}
              title={t("achievements.settings.title")}
              style={controlsShiftStyle}
              className={cn(
                "window-no-drag -mr-1.5 flex size-8 shrink-0 items-center justify-center rounded-full text-ink-tertiary hover:bg-ink/10 hover:text-ink-secondary",
                settingsOpen && "bg-selected text-ink",
              )}
            >
              <Settings size={17} strokeWidth={1.5} aria-hidden="true" />
            </button>
          </header>
          {settingsOpen ? (
            // Settings' reading width; the group's own title names it
            <div className="w-full max-w-[720px]"><AchievementSettingsPage /></div>
          ) : (
            <AchievementsPage category={category} onCategory={setCategory} />
          )}
        </div>
      </div>
    </main>
  );
}
