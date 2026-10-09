// Per-bot settings as a right sidebar with fold-out (accordion) categories —
// same shell pattern as InspectorPanel. Every section lives under
// bot-settings/; their bodies and reads (overview, system-prompt, history)
// are useBotSectionContent, shared with the persona editor. This dialog owns
// which tab and which accordion row is expanded.
import { useCallback, useEffect, useRef, useState } from "react";
import { DockedPanelResizeHandle, useDockedPanelWidth } from "./DockedPanelResize";
import { Bug, ChevronDown, ChevronLeft, MoreHorizontal, PanelRight, Search } from "lucide-react";

import { openBotCatalog, useStore, visibleMessages, type Bot } from "@/state/store";
import { requestPrimaryBot } from "@/lib/bot-quick-actions";
import { BotContextMenu, type MenuState } from "./Sidebar";
import { CIRCLE_BUTTON } from "@/lib/circle-button";
import { reportAchievement } from "@/lib/achievements";
import { ExportTranscriptMenu } from "./ExportTranscriptMenu";
import { cn } from "@/lib/cn";
import { useAdvancedMode } from "@/lib/interface-mode";
import { simpleHidesBotSection, simpleHidesPanelTab } from "@/lib/interface-visibility";
import { useShowInspectorButton } from "@/lib/inspector-preferences";
import { BOT_SECTIONS } from "./bot-settings/sections";
import { LibraryTab } from "./bot-settings/LibraryTab";
import { MemorySection } from "./bot-settings/MemorySection";
import { RoutinesSection } from "./bot-settings/RoutinesSection";
import { isMoreSection, PANEL_TABS, tabForSection, type PanelTab } from "./bot-settings/panel-tabs";
import { ActivitySection } from "./bot-settings/ActivitySection";
import { InlineEditableText } from "./bot-settings/InlineEditableText";
import { PackageProvenance } from "./bot-settings/PackageProvenance";
import { BOT_PROFILE_LIMITS } from "../../shared/bot-profile";
import { ComputerPanel } from "./ComputerPanel";
import { BotProfileAvatarCard } from "./BotProfileAvatarCard";
import { useCaptionChrome, useMacInsetChrome } from "./DesktopCapabilities";
import { t } from "@/lib/i18n";
import { canEditBotField } from "@/lib/bot-capabilities";
import { viewerBotsReadOnly } from "@/lib/viewer";
import { botSectionLock, useBotSectionAvailability, useBotSectionContent } from "./bot-settings/useBotSectionContent";

const sectionLabel = (entry: (typeof BOT_SECTIONS)[number]) => (entry.labelKey ? t(entry.labelKey) : entry.label);

function sectionMatches(entry: (typeof BOT_SECTIONS)[number], query: string): boolean {
  if (!query) return true;
  return [entry.label, sectionLabel(entry), ...entry.keywords].some((part) => part.toLowerCase().includes(query));
}

export function BotSettingsDialog({ bot, onOpenVmWorkspace }: {
  bot: Bot;
  onOpenVmWorkspace?: (botId: string) => void;
  /** Accepted for upstream callers; this panel is a resizable column. */
  overlay?: boolean;
}) {
  const showInspector = useShowInspectorButton();
  const advanced = useAdvancedMode();
  const { state, dispatch } = useStore();
  const { padClass } = useCaptionChrome();
  const { macInset, browser } = useMacInsetChrome();
  const section = state.botSettingsSection;
  const dialogRef = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState("");
  // Keep expansion in the store too: header deep links can arrive while
  // this panel is already mounted, including after collapsing the same row.
  const collapsed = !state.botSettingsExpandAccordion;
  // A deep link to a section lands on the tab that holds it.
  const [pickedTab, setPickedTab] = useState<Exclude<PanelTab, "computer">>(
    collapsed ? "details" : tabForSection(state.botSettingsSection),
  );
  useEffect(() => {
    if (collapsed) return;
    setPickedTab(tabForSection(section));
  }, [collapsed, section]);
  // The Computer tab is the store's computer view, so every existing
  // "open the computer" link still lands on it.
  const panelTabs = PANEL_TABS.filter((id) => advanced || !simpleHidesPanelTab(id));
  // Simple never shows the computer tab. An open computer panel is closed
  // by the shell; until that lands, the tab the person picked stays up.
  const tab: PanelTab = advanced && state.computerOpen ? "computer" : pickedTab;
  // the Library holds the bot's files (an achievement teaches it)
  useEffect(() => {
    if (tab === "library") reportAchievement("files.opened");
  }, [tab]);
  const chooseTab = (next: PanelTab) => {
    if (next === "computer") {
      if (!advanced) return;
      dispatch({ type: "toggleComputer", open: true });
      return;
    }
    if (state.computerOpen || !collapsed) dispatch({ type: "toggleSettings", open: true });
    setPickedTab(next);
  };
  const closePanel = () => {
    dispatch({ type: "toggleSettings", open: false });
    dispatch({ type: "toggleComputer", open: false });
  };
  const dockedPanel = useDockedPanelWidth();
  // The mascot's menu (right click on it, or the "..." button): Edit
  // persona, Rename the bot, Put on the desktop, Make primary bot, Browse Bots.
  const [mascotMenu, setMascotMenu] = useState<MenuState | null>(null);
  const [renameRequest, setRenameRequest] = useState(0);
  const closeMascotMenu = useCallback(() => setMascotMenu(null), []);
  const makePrimary = (target: Bot) => {
    void requestPrimaryBot(target.id)
      .then((primary) => dispatch({ type: "botPatched", bot: primary }))
      .catch((cause: unknown) => dispatch({ type: "error", message: cause instanceof Error ? cause.message : String(cause) }));
  };
  const q = query.trim().toLowerCase();
  const { available, slackUrl } = useBotSectionAvailability(bot.id);
  const sections = BOT_SECTIONS
    .filter((entry) => isMoreSection(entry.id))
    .filter((entry) => available(entry.id))
    // An organization member never sees a section whose fields the server
    // refuses here (the persona editor shows it locked, with the reason).
    .filter((entry) => botSectionLock(state.config, bot, entry.id) === null)
    .filter((entry) => advanced || !simpleHidesBotSection(entry.id));
  const visibleSections = sections.filter((entry) => sectionMatches(entry, q));
  // A deep link into a section Simple hides shows Overview instead. The
  // hidden section's saved values stay.
  const shownSection = !advanced && simpleHidesBotSection(section) ? "overview" : section;
  const { renderSectionBody, dialogs, derived } = useBotSectionContent(bot, {
    section,
    expanded: !collapsed,
    onOpenSection: (target) => {
      if (!advanced && simpleHidesBotSection(target)) return;
      dispatch({ type: "toggleSettings", open: true, section: target });
    },
    returnFocusRef: dialogRef,
    slackUrl,
  });

  useEffect(() => {
    // Search narrows the collapsed row list. Choosing a row (or following
    // an external deep link) clears that filter so it cannot hide the body.
    if (collapsed) return;
    if (q) { setQuery(""); return; }
    dialogRef.current?.querySelector(`[data-bot-settings-section="${section}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [collapsed, section, q]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    dialog?.focus();

    const onKey = (event: KeyboardEvent) => {
      // A dialog opened from inside this one (the routine editor, a skill
      // review, the model picker's popover, a computer warning) owns Escape
      // while it is up: Escape closes only that layer.
      // Only a *visible* nested dialog owns Escape. A hidden or
      // zero-size leftover (display:none, empty hit box) must not trap
      // the settings panel's own dismiss path.
      const nested = dialog?.querySelector<HTMLElement>('[role="dialog"], [role="alertdialog"]');
      if (nested && nested.getClientRects().length > 0) return;
      // BotInstructionsDialog portals to document.body, so it is not in this
      // subtree: a key pressed with focus outside this dialog belongs to
      // whatever holds focus, never to us.
      if (dialog && event.target instanceof Node && !dialog.contains(event.target)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        dispatch({ type: "toggleSettings", open: false });
        dispatch({ type: "toggleComputer", open: false });
      }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previousFocus?.focus();
    };
  }, [dispatch]);

  return (
    <>
      <aside
        ref={dialogRef}
        role="dialog"
        aria-labelledby="bot-settings-title"
        tabIndex={-1}
        style={{ width: dockedPanel.width }}
        className="app-docked-panel animate-panel-in relative flex h-full min-w-0 shrink-0 flex-col border-l-[0.5px] border-hairline-weak bg-app outline-none max-lg:absolute max-lg:inset-0 max-lg:z-40 max-lg:w-auto"
      >
        <DockedPanelResizeHandle label="Resize settings" panel={dockedPanel} />
        {(macInset || browser) && <div className="content-topbar-strip" />}
        {/* Top bar: only the controls, the way Grok Bot's panel opens. On
            Windows it drops below the caption buttons (padClass). */}
        <div className={cn("content-topbar relative flex h-12 shrink-0 items-center justify-between px-3", padClass)}>
          {tab === "more" && !collapsed ? (
            <button
              type="button"
              onClick={() => dispatch({ type: "toggleSettings", open: true })}
              aria-label="Back"
              className={CIRCLE_BUTTON}
            >
              <ChevronLeft size={18} strokeWidth={1.75} />
            </button>
          ) : <span />}
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-mascot-menu-button=""
              aria-label={t("persona.menu.open")}
              title={t("persona.menu.open")}
              aria-haspopup="menu"
              aria-expanded={mascotMenu !== null}
              onClick={(event) => {
                const box = event.currentTarget.getBoundingClientRect();
                setMascotMenu((open) => (open ? null : { botId: bot.id, x: box.left, y: box.bottom + 4 }));
              }}
              className={CIRCLE_BUTTON}
            >
              <MoreHorizontal size={18} strokeWidth={1.75} />
            </button>
            <ExportTranscriptMenu title={bot.name} messages={visibleMessages(bot)} botName={bot.name} />
            {showInspector && advanced && <button
              type="button"
              onClick={() => dispatch({ type: "toggleInspector", open: true })}
              aria-label={t("chat.inspector")}
              title={t("chat.inspectorHint")}
              className={CIRCLE_BUTTON}
            >
              <Bug size={18} strokeWidth={1.75} />
            </button>}
            <button
              type="button"
              onClick={closePanel}
              aria-label="Close"
              title="Close"
              className={CIRCLE_BUTTON}
            >
              <PanelRight size={18} strokeWidth={1.75} />
            </button>
          </div>
        </div>

        <div className="content-card-body flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden [&>*]:shrink-0">
          {viewerBotsReadOnly(state.config) && (
            <p role="note" data-bots-read-only className="mx-4 mb-2 rounded-lg bg-raised/60 px-3 py-2 text-center text-[12.5px] leading-snug text-ink-secondary">{t("bots.readOnly.notice")}</p>
          )}
          {/* Who this is, then the tabs */}
          <div className="flex shrink-0 flex-col items-center px-4 pb-3">
            <BotProfileAvatarCard
              bot={bot}
              activeState={derived.activeState}
              mascotMotion={derived.mascotMotion}
              onPatch={derived.patch}
              onContextMenu={(event) => {
                event.preventDefault();
                setMascotMenu({ botId: bot.id, x: event.clientX, y: event.clientY });
              }}
            />
            {/* Name and label are edited where they show; the name stays
                centered on its own line. The description is not shown here. */}
            <div className="mt-2 flex max-w-full items-center justify-center">
              <InlineEditableText
                id="bot-settings-title"
                value={bot.name}
                required
                maxLength={BOT_PROFILE_LIMITS.name}
                ariaLabel={t("botPanel.name.edit")}
                onSave={canEditBotField(state.config, bot, "name") ? (name) => derived.patch({ name }) : undefined}
                editRequest={renameRequest}
                className="text-[17px] font-medium leading-6 text-ink"
              />
            </div>
            <InlineEditableText
              value={bot.title}
              maxLength={BOT_PROFILE_LIMITS.title}
              placeholder={t("botPanel.label.add")}
              ariaLabel={t("botPanel.label.edit")}
              onSave={canEditBotField(state.config, bot, "title") ? (title) => derived.patch({ title }) : undefined}
              muted
              className="mt-0.5 text-[12.5px] leading-4"
            />
            <div
              role="tablist"
              aria-label={t("botPanel.tabsAria")}
              onKeyDown={(event) => {
                // Arrow keys move between tabs, as in any tab list.
                const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
                if (!step) return;
                event.preventDefault();
                const next = panelTabs[(panelTabs.indexOf(tab) + step + panelTabs.length) % panelTabs.length]!;
                chooseTab(next);
                event.currentTarget.querySelector<HTMLElement>(`[data-panel-tab="${next}"]`)?.focus();
              }}
              className="mt-4 flex max-w-full flex-wrap items-center justify-center gap-0.5"
            >
              {panelTabs.map((id) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  data-panel-tab={id}
                  aria-selected={tab === id}
                  tabIndex={tab === id ? 0 : -1}
                  onClick={() => chooseTab(id)}
                  className={cn(
                    "rounded-md px-1.5 py-1 text-[13px] leading-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                    tab === id ? "bg-elevated-hover text-ink" : "text-ink-secondary hover:text-ink",
                  )}
                >
                  {t(`botPanel.tab.${id}`)}
                </button>
              ))}
            </div>
          </div>

          {tab === "details" && (
            <div className="flex flex-col gap-6 px-4 pb-6 pt-2">
              <ActivitySection bot={bot} />
              <section data-bot-settings-section="routines" className="flex flex-col gap-2">
                <RoutinesSection bot={bot} routines={derived.botRoutines} runs={state.routineRuns} grouped />
              </section>
              <PackageProvenance bot={bot} />
            </div>
          )}

          {tab === "library" && <LibraryTab bot={bot} />}

          {tab === "computer" && (
            <div className="px-4 pt-2">
              <ComputerPanel bot={bot} onOpenVmWorkspace={onOpenVmWorkspace} embedded />
            </div>
          )}

          {tab === "more" && (
            <>
              {collapsed && <div className="mx-4 mb-3 flex shrink-0 items-center gap-2 rounded-lg border border-hairline-weak bg-elevated px-2.5 py-1.5">
                <Search size={14} className="shrink-0 text-ink-secondary" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Escape") return;
                    e.stopPropagation();
                    if (query) setQuery("");
                    else closePanel();
                  }}
                  placeholder="Search"
                  aria-label="Search settings"
                  className="w-full bg-transparent text-[13px] text-ink placeholder:text-ink-secondary focus:outline-none"
                />
              </div>}
              {collapsed && (
                <div className="mx-4 mb-6 overflow-hidden rounded-xl border border-hairline-weak">
                  {visibleSections.map((entry) => {
                    const Icon = entry.icon;
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        data-bot-settings-section={entry.id}
                        onClick={() => dispatch({ type: "toggleSettings", open: true, section: entry.id })}
                        className="flex w-full items-center gap-2.5 border-b border-hairline-weak px-3 py-2.5 text-left text-[13px] text-ink last:border-b-0 hover:bg-hover"
                      >
                        <Icon size={15} className="shrink-0 text-ink-secondary" />
                        <span className="min-w-0 flex-1 truncate">{sectionLabel(entry)}</span>
                        <ChevronDown size={14} className="-rotate-90 text-ink-secondary" />
                      </button>
                    );
                  })}
                  {q && visibleSections.length === 0 && (
                    <div className="px-3 py-3 text-[12.5px] leading-relaxed text-ink-secondary">
                      Nothing matches “{query.trim()}”
                    </div>
                  )}
                </div>
              )}
              {!collapsed && (
                <div className="px-4 pb-6">
                  <h3 className="mb-3 text-[14px] font-medium text-ink">
                    {sectionLabel(sections.find((entry) => entry.id === shownSection) ?? sections[0]!)}
                  </h3>
                  {shownSection !== "memory" && renderSectionBody(shownSection)}
                </div>
              )}
            </>
          )}
          {/* Memory stays mounted so an unsaved draft survives tab and
              section changes; it shows only while it is the open section.
              A member cannot save it, so it is not mounted and does not fetch. */}
          {canEditBotField(state.config, bot, "memoryEnabled") && <div hidden={!(tab === "more" && !collapsed && shownSection === "memory")} className="px-4 pb-6">
            <MemorySection bot={bot} active={tab === "more" && !collapsed && shownSection === "memory"} onToggle={(enabled) => derived.patch({ memoryEnabled: enabled })} />
          </div>}
        </div>
      </aside>
      {dialogs}
      <BotContextMenu
        variant="mascot"
        menu={mascotMenu}
        onClose={closeMascotMenu}
        onEditPersona={(target) => dispatch({ type: "openPersonaEditor", botId: target.id })}
        onRename={() => setRenameRequest((count) => count + 1)}
        onMakePrimary={makePrimary}
        onBrowseBots={() => dispatch(openBotCatalog())}
      />
    </>
  );
}
