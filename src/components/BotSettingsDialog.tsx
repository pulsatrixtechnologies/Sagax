// Per-bot settings as a right sidebar with fold-out (accordion) categories —
// same shell pattern as InspectorPanel. Every section lives under
// bot-settings/; their bodies and reads (overview, system-prompt, history)
// are useBotSectionContent, shared with the persona editor. This dialog owns
// which tab is up; every section but Details opens in the persona editor.
import { useCallback, useEffect, useRef, useState } from "react";
import { DockedPanelResizeHandle, useDockedPanelWidth } from "./DockedPanelResize";
import { Bug, MoreHorizontal, PanelRight, Pencil } from "lucide-react";

import { useStore, visibleMessages, type Bot } from "@/state/store";
import { requestPrimaryBot } from "@/lib/bot-quick-actions";
import { BotContextMenu, type MenuState } from "./Sidebar";
import { CIRCLE_BUTTON } from "@/lib/circle-button";
import { reportAchievement } from "@/lib/achievements";
import { ExportTranscriptMenu } from "./ExportTranscriptMenu";
import { cn } from "@/lib/cn";
import { useAdvancedMode } from "@/lib/interface-mode";
import { simpleHidesPanelTab } from "@/lib/interface-visibility";
import { useShowInspectorButton } from "@/lib/inspector-preferences";
import { LibraryTab } from "./bot-settings/LibraryTab";
import { RoutinesSection } from "./bot-settings/RoutinesSection";
import { PANEL_TABS, type PanelTab } from "./bot-settings/panel-tabs";
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
import { useBotSectionAvailability, useBotSectionContent } from "./bot-settings/useBotSectionContent";
import { botsReadOnlyText } from "@/lib/permissions";

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
  // Keep expansion in the store too: header deep links can arrive while
  // this panel is already mounted, including after collapsing the same row.
  const collapsed = !state.botSettingsExpandAccordion;
  // Every deep link that reaches the panel (Details, Routines) lands on Details.
  const [pickedTab, setPickedTab] = useState<Exclude<PanelTab, "computer">>("details");
  useEffect(() => {
    if (!collapsed) setPickedTab("details");
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
  // persona, Rename the bot, Put on the desktop, Make primary bot.
  const [mascotMenu, setMascotMenu] = useState<MenuState | null>(null);
  const [renameRequest, setRenameRequest] = useState(0);
  const closeMascotMenu = useCallback(() => setMascotMenu(null), []);
  const makePrimary = (target: Bot) => {
    void requestPrimaryBot(target.id)
      .then((primary) => dispatch({ type: "botPatched", bot: primary }))
      .catch((cause: unknown) => dispatch({ type: "error", message: cause instanceof Error ? cause.message : String(cause) }));
  };
  const { slackUrl } = useBotSectionAvailability(bot.id);
  const { dialogs, derived } = useBotSectionContent(bot, {
    section,
    expanded: !collapsed,
    // Sections other than Details open in the persona editor (store).
    onOpenSection: (target) => dispatch({ type: "toggleSettings", open: true, section: target }),
    returnFocusRef: dialogRef,
    slackUrl,
  });

  useEffect(() => {
    // A deep link to Routines scrolls to its row.
    if (collapsed) return;
    dialogRef.current?.querySelector(`[data-bot-settings-section="${section}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [collapsed, section]);

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
          <span />
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
              // The header's own round control, as Export and Close beside
              // it (ExportTranscriptMenu: the same hover tone while open).
              className={cn(CIRCLE_BUTTON, mascotMenu !== null && "bg-elevated-hover")}
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
            <p role="note" data-bots-read-only className="mx-4 mb-2 rounded-lg bg-raised/60 px-3 py-2 text-center text-[12.5px] leading-snug text-ink-secondary">{botsReadOnlyText(state.config)}</p>
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
            <button
              type="button"
              data-edit-persona=""
              onClick={() => dispatch({ type: "openPersonaEditor", botId: bot.id, section: "overview" })}
              className="mt-3 flex items-center gap-1.5 rounded-lg border border-hairline-weak bg-elevated px-3 py-1.5 text-[13px] text-ink transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              <Pencil size={13} aria-hidden="true" className="text-ink-secondary" />
              {t("botPanel.editPersona")}
            </button>
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
      />
    </>
  );
}
