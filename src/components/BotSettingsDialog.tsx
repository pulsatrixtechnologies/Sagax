// Per-bot settings as a right sidebar with fold-out (accordion) categories —
// same shell pattern as InspectorPanel. Every section lives under
// bot-settings/; this dialog owns only the fetches (overview, system-prompt,
// history) and which accordion row is expanded.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bug, ChevronDown, ChevronLeft, PanelRight, Search } from "lucide-react";

import { api, useStore, visibleMessages, type Bot } from "@/state/store";
import { CIRCLE_BUTTON } from "@/lib/circle-button";
import { reportAchievement } from "@/lib/achievements";
import { ExportTranscriptMenu } from "./ExportTranscriptMenu";
import type { BotOverview } from "@/lib/bot-overview-types";
import { cn } from "@/lib/cn";
import { useAdvancedMode } from "@/lib/interface-mode";
import { simpleHidesBotSection, simpleHidesPanelTab } from "@/lib/interface-visibility";
import { useShowInspectorButton } from "@/lib/inspector-preferences";
import { ConfirmDialog } from "./ConfirmDialog";
import { BOT_SECTIONS } from "./bot-settings/sections";
import { useBotSettingsDerived } from "./bot-settings/useBotSettingsDerived";
import { OverviewSection } from "./bot-settings/OverviewSection";
import { SlackSection } from "./bot-settings/SlackSection";
import { useSlackManagementUrl } from "./bot-settings/useSlackManagement";
import { SoulSection } from "./bot-settings/SoulSection";
import { SkillsSection } from "./bot-settings/SkillsSection";
import { LibraryTab } from "./bot-settings/LibraryTab";
import { MemorySection } from "./bot-settings/MemorySection";
import { RoutinesSection } from "./bot-settings/RoutinesSection";
import { AccessSection } from "./bot-settings/AccessSection";
import { ModelSection } from "./bot-settings/ModelSection";
import { PermissionsSection } from "./bot-settings/PermissionsSection";
import { VoiceSection } from "./bot-settings/VoiceSection";
import { HistorySection, type HistoryRow } from "./bot-settings/HistorySection";
import { UsageSection } from "./bot-settings/UsageSection";
import { VisibilitySection } from "./bot-settings/VisibilitySection";
import { SharingSection } from "./bot-settings/SharingSection";
import { PerspicaxSection } from "./bot-settings/PerspicaxSection";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import { isMoreSection, PANEL_TABS, tabForSection, type PanelTab } from "./bot-settings/panel-tabs";
import { ActivitySection } from "./bot-settings/ActivitySection";
import { InlineEditableText } from "./bot-settings/InlineEditableText";
import { PackageProvenance } from "./bot-settings/PackageProvenance";
import { ProposalStatus } from "./bot-settings/ProposalStatus";
import { BOT_PROFILE_LIMITS } from "../../shared/bot-profile";
import { ComputerPanel } from "./ComputerPanel";
import { WorksOnSetting } from "./computer/WorksOnSetting";
import { BotProfileAvatarCard } from "./BotProfileAvatarCard";
import { useCaptionChrome, useMacInsetChrome } from "./DesktopCapabilities";
import { t } from "@/lib/i18n";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import type { PromptPreviewData } from "./bot-settings/PromptPreview";
import { servedPage } from "@/lib/desktop";
import { canEditBotField, canStepPrimary } from "@/lib/bot-capabilities";
import { viewerBotsReadOnly, viewerIsOrgMember } from "@/lib/viewer";

const sectionLabel = (entry: (typeof BOT_SECTIONS)[number]) => (entry.labelKey ? t(entry.labelKey) : entry.label);

function sectionMatches(entry: (typeof BOT_SECTIONS)[number], query: string): boolean {
  if (!query) return true;
  return [entry.label, sectionLabel(entry), ...entry.keywords].some((part) => part.toLowerCase().includes(query));
}

const SETTINGS_WIDTH_KEY = "omb-settings-panel-width";
const SETTINGS_MIN_WIDTH = 320;
const SETTINGS_MAX_WIDTH = 720;
const SETTINGS_DEFAULT_WIDTH = 360;

function readSettingsWidth(): number {
  try {
    const stored = Number(localStorage.getItem(SETTINGS_WIDTH_KEY));
    if (Number.isFinite(stored) && stored >= SETTINGS_MIN_WIDTH && stored <= SETTINGS_MAX_WIDTH) return stored;
  } catch { /* default width */ }
  return SETTINGS_DEFAULT_WIDTH;
}

export function BotSettingsDialog({ bot, onOpenVmWorkspace }: {
  bot: Bot;
  onOpenVmWorkspace?: (botId: string) => void;
  /** Accepted for upstream callers; this panel is a resizable column. */
  overlay?: boolean;
}) {
  const showInspector = useShowInspectorButton();
  const advanced = useAdvancedMode();
  const { state, dispatch, flushBotPatches } = useStore();
  const { padClass } = useCaptionChrome();
  const { macInset, browser } = useMacInsetChrome();
  const section = state.botSettingsSection;
  const derived = useBotSettingsDerived(bot);
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
  const [settingsWidth, setSettingsWidth] = useState(readSettingsWidth);
  const settingsResize = useRef<{ x: number; width: number; current: number } | null>(null);
  const q = query.trim().toLowerCase();
  // Slack is offered only where the server has an Admin page to link to
  // (a hosted organisation workspace); otherwise its row does not exist.
  const slackUrl = useSlackManagementUrl(bot.id);
  // Who can see a bot matters only where several people sign in: a browser
  // on a served workspace, and there only to an admin.
  const ownerOrAdmin = useOwnerOrAdmin();
  // A server signed in with Perspicax shares a bot person by person
  // (SharingSection); the audience setting does not apply there.
  const perspicaxOrg = usePerspicaxOrg();
  const sections = BOT_SECTIONS
    .filter((entry) => isMoreSection(entry.id))
    .filter((entry) => entry.id !== "slack" || slackUrl !== null)
    .filter((entry) => entry.id !== "visibility" || (servedPage() && ownerOrAdmin === true && perspicaxOrg === null))
    .filter((entry) => entry.id !== "sharing" || perspicaxOrg !== null)
    .filter((entry) => entry.id !== "perspicax" || perspicaxOrg !== null)
    // An organization member never sees a section whose fields the server refuses.
    .filter((entry) => entry.id !== "access" || canEditBotField(state.config, bot, "computer") || canEditBotField(state.config, bot, "cwd"))
    .filter((entry) => entry.id !== "worksOn" || canEditBotField(state.config, bot, "computer"))
    .filter((entry) => entry.id !== "memory" || canEditBotField(state.config, bot, "memoryEnabled"))
    .filter((entry) => entry.id !== "soul" || canEditBotField(state.config, bot, "soul"))
    .filter((entry) => entry.id !== "history" || !viewerIsOrgMember(state.config))
    .filter((entry) => entry.id !== "permissions" || canStepPrimary(state.config, bot) || canEditBotField(state.config, bot, "approvalMode"))
    .filter((entry) => advanced || !simpleHidesBotSection(entry.id));
  const visibleSections = sections.filter((entry) => sectionMatches(entry, q));
  // A deep link into a section Simple hides shows Overview instead. The
  // hidden section's saved values stay.
  const shownSection = !advanced && simpleHidesBotSection(section) ? "overview" : section;

  const [overview, setOverview] = useState<BotOverview | null>(null);
  const [overviewError, setOverviewError] = useState(false);
  const [prompt, setPrompt] = useState<PromptPreviewData | null>(null);
  const [promptError, setPromptError] = useState(false);
  const [historyRows, setHistoryRows] = useState<HistoryRow[] | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const [historyRevision, setHistoryRevision] = useState<string | null>(null);
  const historyRequest = useRef(0);
  const [rollingBack, setRollingBack] = useState(false);
  const [rollbackTarget, setRollbackTarget] = useState<{ id: string; expectedRevision: string } | null>(null);

  // The bot-record fields the server-built overview and system-prompt
  // preview actually read (OverviewFacts.bot plus the prompt's persona
  // inputs). A streamed message or unread flag replaces the bot object but
  // must not refetch an unchanged overview.
  const factsSignature = useMemo(
    () =>
      JSON.stringify([
        bot.name,
        bot.title,
        bot.description,
        bot.soul,
        bot.computer,
        bot.cloudBackend,
        bot.cwd,
        bot.autoApprove,
        bot.approvePeerComms,
        bot.peers,
        bot.section,
        bot.composio,
        bot.browser,
        bot.mcpServers,
        bot.chiefOfStaff,
        bot.managedSections,
        bot.modelSelection,
      ]),
    [
      bot.name,
      bot.title,
      bot.description,
      bot.soul,
      bot.computer,
      bot.cloudBackend,
      bot.cwd,
      bot.autoApprove,
      bot.approvePeerComms,
      bot.peers,
      bot.section,
      bot.composio,
      bot.browser,
      bot.mcpServers,
      bot.chiefOfStaff,
      bot.managedSections,
      bot.modelSelection,
    ],
  );

  // Fetch on entry: skills and memory are files, not bot-record fields, so
  // returning from either editor must reload their overview/prompt too.
  // Await the existing write queue instead of racing a second debounce.
  useEffect(() => {
    if (section !== "overview") return;
    let cancelled = false;
    const fetchOverviewAndPrompt = async () => {
      await flushBotPatches(bot.id);
      if (cancelled) return;
      void api(`/api/bots/${bot.id}/overview`)
        .then((data: BotOverview) => {
          if (cancelled) return;
          setOverview(data);
          setOverviewError(false);
        })
        .catch(() => {
          if (!cancelled) setOverviewError(true);
        });
      void api(`/api/bots/${bot.id}/system-prompt`)
        .then((data: PromptPreviewData) => {
          if (cancelled) return;
          setPrompt(data);
          setPromptError(false);
        })
        .catch(() => {
          if (!cancelled) setPromptError(true);
        });
    };

    void fetchOverviewAndPrompt();
    return () => {
      cancelled = true;
    };
  }, [bot.id, section, factsSignature, state.routines, state.webhooks, flushBotPatches]);

  // Read the file-backed history only when its section is opened. A newer
  // load (or leaving History) invalidates older rows, revision, and errors.
  const loadHistory = useCallback(() => {
    const request = ++historyRequest.current;
    setHistoryError(false);
    return flushBotPatches(bot.id)
      .then(() => api(`/api/bots/${bot.id}/history?limit=100`))
      .then((data: { rows: HistoryRow[]; revision: string }) => {
        if (request !== historyRequest.current) return;
        setHistoryRows(data.rows);
        setHistoryRevision(data.revision);
      })
      .catch(() => {
        if (request === historyRequest.current) setHistoryError(true);
      });
  }, [bot.id, flushBotPatches]);

  const historyAllowed = !viewerIsOrgMember(state.config);
  useEffect(() => {
    if (!historyAllowed || section !== "history") return;
    void loadHistory();
    return () => { historyRequest.current++; };
  }, [section, loadHistory, historyAllowed]);

  // A rollback failure (the row's soul text no longer round-trips the
  // server's validation, say) still reloads history so the list matches
  // the server's actual state, but also surfaces the server's message
  // through the app's error toast — mirrors SoulField's Apply/Discard.
  const rollbackHistory = async (target: { id: string; expectedRevision: string }) => {
    if (rollingBack) return;
    setRollbackTarget(null);
    setRollingBack(true);
    try {
      await flushBotPatches(bot.id);
      await api(`/api/bots/${bot.id}/history/rollback`, {
        method: "POST",
        body: JSON.stringify(target),
      });
    } catch (e: unknown) {
        dispatch({ type: "error", message: e instanceof Error ? e.message : "Couldn't undo that change." });
    } finally {
      await loadHistory();
      setRollingBack(false);
    }
  };

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

  const renderSectionBody = (id: (typeof BOT_SECTIONS)[number]["id"]) => {
    switch (id) {
      case "overview":
        return overview === null && overviewError ? (
          <div className="rounded-xl bg-card p-4 text-[13px] text-ink-secondary">Couldn’t load the overview.</div>
        ) : (
          // Data wins over a transient refetch failure: once an overview has
          // loaded once, a later failed refetch (routines/webhooks/bot-record
          // changed, the request errored) keeps showing it rather than
          // replacing a fully populated card with an error block — the same
          // precedence PromptPreview already gives its own data vs. error.
          <OverviewSection
            overview={overview}
            refreshError={overview !== null && overviewError}
            prompt={prompt}
            promptError={promptError}
            onOpen={(target) => {
              if (!advanced && simpleHidesBotSection(target)) return;
              dispatch({ type: "toggleSettings", open: true, section: target });
            }}
          />
        );
      case "soul":
        if (!canEditBotField(state.config, bot, "soul")) return null;
        return <SoulSection bot={bot} patch={derived.patch} />;
      case "slack":
        return slackUrl ? <SlackSection managementUrl={slackUrl} /> : null;
      case "skills":
        return <SkillsSection bot={bot} />;
      case "memory":
        // Memory has an explicit Save button; preserve its unsaved draft
        // while the user consults another section. It fetches when it
        // becomes the active section. Mounted below while the viewer may
        // change it; visibility toggled via hidden on the wrapper.
        if (!canEditBotField(state.config, bot, "memoryEnabled")) return null;
        return <MemorySection bot={bot} active={!collapsed && section === "memory"} onToggle={(enabled) => derived.patch({ memoryEnabled: enabled })} />;
      case "routines":
        return <RoutinesSection bot={bot} routines={derived.botRoutines} runs={state.routineRuns} />;
      case "access":
        return <AccessSection bot={bot} derived={derived} />;
      case "worksOn":
        return <WorksOnSetting bot={bot} />;
      case "model":
        return <ModelSection bot={bot} />;
      case "permissions":
        return <PermissionsSection bot={bot} derived={derived} />;
      case "voice":
        return <VoiceSection bot={bot} derived={derived} />;
      case "visibility":
        return <VisibilitySection bot={bot} />;
      case "sharing":
        return <SharingSection bot={bot} />;
      case "perspicax":
        return <PerspicaxSection bot={bot} />;
      case "history":
        if (!historyAllowed) return null;
        return historyRows === null && historyError ? (
          <div className="rounded-xl bg-card p-4 text-[13px] text-ink-secondary">Couldn’t load history.</div>
        ) : (
          // Same precedence as the Overview: rows already on screen
          // survive a failed reload (after an undo, say) with a quiet
          // note rather than being replaced by an error block.
          <HistorySection
            bot={bot}
            rows={historyRows}
            refreshError={historyRows !== null && historyError}
            onRollback={(id) => {
              if (historyRevision) setRollbackTarget({ id, expectedRevision: historyRevision });
            }}
            rollingBack={rollingBack || !historyRevision}
          />
        );
      case "usage":
        return <UsageSection bot={bot} />;
      default:
        return null;
    }
  };

  return (
    <>
      <aside
        ref={dialogRef}
        role="dialog"
        aria-labelledby="bot-settings-title"
        tabIndex={-1}
        style={{ width: settingsWidth }}
        className="app-docked-panel animate-panel-in relative flex h-full min-w-0 shrink-0 flex-col border-l-[0.5px] border-hairline-weak bg-app outline-none max-lg:absolute max-lg:inset-0 max-lg:z-40 max-lg:w-auto"
      >
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize settings"
          aria-valuemin={SETTINGS_MIN_WIDTH}
          aria-valuemax={SETTINGS_MAX_WIDTH}
          aria-valuenow={settingsWidth}
          tabIndex={0}
          onPointerDown={(event) => {
            settingsResize.current = { x: event.clientX, width: settingsWidth, current: settingsWidth };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const from = settingsResize.current;
            if (!from) return;
            const next = Math.min(SETTINGS_MAX_WIDTH, Math.max(SETTINGS_MIN_WIDTH, from.width + (from.x - event.clientX)));
            settingsResize.current = { ...from, current: next };
            setSettingsWidth(next);
          }}
          onPointerUp={(event) => {
            const width = settingsResize.current?.current;
            if (width == null) return;
            settingsResize.current = null;
            event.currentTarget.releasePointerCapture(event.pointerId);
            try { localStorage.setItem(SETTINGS_WIDTH_KEY, String(width)); } catch { /* session only */ }
          }}
          onKeyDown={(event) => {
            const delta = event.key === "ArrowLeft" ? 24 : event.key === "ArrowRight" ? -24 : 0;
            if (!delta) return;
            event.preventDefault();
            setSettingsWidth((current) => {
              const next = Math.min(SETTINGS_MAX_WIDTH, Math.max(SETTINGS_MIN_WIDTH, current + delta));
              try { localStorage.setItem(SETTINGS_WIDTH_KEY, String(next)); } catch { /* session only */ }
              return next;
            });
          }}
          className="app-resize-handle -left-[3px] hidden lg:block"
        />
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

        <div className="content-card-body flex min-h-0 flex-1 flex-col overflow-y-auto">
          {viewerBotsReadOnly(state.config) && (
            <p role="note" data-bots-read-only className="mx-4 mb-2 rounded-lg bg-raised/60 px-3 py-2 text-center text-[12.5px] leading-snug text-ink-secondary">{t("bots.readOnly.notice")}</p>
          )}
          {/* Who this is, then the tabs */}
          <div className="flex shrink-0 flex-col items-center px-4 pb-3">
            <BotProfileAvatarCard bot={bot} activeState={derived.activeState} mascotMotion={derived.mascotMotion} onPatch={derived.patch} />
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
            <div className="mt-1 w-full max-w-full empty:hidden"><ProposalStatus bot={bot} kind="chief" /></div>
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
      <ConfirmDialog
        open={rollbackTarget !== null}
        title="Restore previous instructions?"
        body="Replaces current SOUL with the version before this change. Current version stays in History."
        confirmLabel="Restore instructions"
        tone="neutral"
        returnFocusRef={dialogRef}
        onCancel={() => setRollbackTarget(null)}
        onConfirm={() => { if (rollbackTarget) void rollbackHistory(rollbackTarget); }}
      />
    </>
  );
}
