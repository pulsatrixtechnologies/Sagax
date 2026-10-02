import { useCallback, useEffect, useRef, useState } from "react";
import { Bot as BotIcon, Loader2, Menu, Plus } from "lucide-react";
import { openNotificationTarget, StoreProvider, useStore } from "@/state/store";
import { useWelcomeViewer, WelcomeGate } from "@/components/onboarding/WelcomeGate";
import { mainConversation } from "@/lib/main-view";
import { cloudSignInDue, spotlightsQuiet, type WelcomeViewer } from "@/lib/onboarding";
import { FirstConversationTour } from "@/components/onboarding/FirstConversationTour";
import { GuidedTour } from "@/components/onboarding/GuidedTour";
import { ThreadRefsProvider } from "@/components/ThreadRefs";
import { initAnalytics } from "@/lib/analytics";
import { Sidebar } from "@/components/Sidebar";
import { ChatView } from "@/components/ChatView";
import { GroupView } from "@/components/GroupView";
import { PersonPanel } from "@/components/PersonPanel";
import { BotSettingsDialog } from "@/components/BotSettingsDialog";
import { RemoteAgentSettingsPanel } from "@/components/RemoteAgentSettingsPanel";
import { NewBotDialog } from "@/components/NewBotDialog";
import { ComposeToPicker } from "@/components/ComposeToPicker";
import { PluginsPanel, preloadConnectedApps } from "@/components/PluginsPanel";
import { RemoteDesktopPanel } from "@/components/remote-desktop-panel";
import { InspectorPanel } from "@/components/InspectorPanel";
import { SettingsModal } from "@/components/SettingsModal";
import { WorkspaceBackupRecovery } from "@/components/WorkspaceBackupSettings";
import { UpdateBanner } from "@/components/UpdateBanner";
import { DesktopCapabilitiesProvider, useDesktopCapabilities } from "@/components/DesktopCapabilities";
import { WindowCaptionButtons } from "@/components/WindowCaptionButtons";
import { RoutinesPage } from "@/components/RoutinesPage";
import { NoEngines } from "@/components/NoEngines";
import { CloudEngineSignIn } from "@/components/CloudEngineSignIn";
import { CloudSetup } from "@/components/CloudSetup";
import { engineReady } from "@/components/EngineLibrary";
import { CommandPalette } from "@/components/CommandPalette";
import { StagedOrgImport } from "@/components/OrgImportDialog";
import { RetroAssistantHost } from "@/components/RetroAssistantHost";
import { AchievementToaster } from "@/components/achievements/AchievementToaster";
import { reportAchievement } from "@/lib/achievements";
import { FloatingBotsHost } from "@/components/FloatingBotsHost";
import { CallEngineHost } from "@/components/CallView";
import { RetroBootSlot, RetroChromeSlot } from "@/components/RetroChromeHost";
import { KeyboardShortcutsModal } from "@/components/KeyboardShortcutsModal";
import { LocalVmWorkspace } from "@/components/LocalVmWorkspace";
import { TeamMapPage } from "@/components/TeamMapPage";
import { setLocale, t } from "@/lib/i18n";
import { shouldOpenKeyboardShortcuts } from "@/lib/keyboard-shortcuts";
import { effectiveLanguage, useLanguageChoice } from "@/lib/language-preference";
import { requestEnterpriseEntry } from "@/lib/enterprise-entry";
import { takeRoutineDelegationReturn } from "@/lib/routine-delegation";
import { openThreadVisible, pageOpenThreadTarget, type OpenThreadTarget } from "@/lib/open-thread-hash";
import { botShowsUnread } from "@/lib/bot-unread";
import { viewerBotsReadOnly, viewerCanCreateBots } from "@/lib/viewer";

function Shell({ viewer }: { viewer: WelcomeViewer | null }) {
  const { state, dispatch } = useStore();
  const { capabilities } = useDesktopCapabilities();
  const unreadCount =
    state.bots.filter((bot) => !bot.hidden && botShowsUnread(bot)).length +
    state.groups.filter((group) => group.unread).length;
  const remoteClient = window.ogb?.remoteClient?.active === true;
  useEffect(() => {
    if (!window.ogb?.environments) return;
    const open = (computerId?: string | null) => {
      if (computerId) {
        const target = new URL(window.location.href);
        target.searchParams.set("share-computer", computerId);
        window.history.replaceState(null, "", `${target.pathname}${target.search}${target.hash}`);
      }
      dispatch({ type: "toggleAppSettings", open: true, section: "organization" });
    };
    const url = new URL(window.location.href);
    const requestedSettings = url.searchParams.get("desktop-settings");
    // Sagax: the inherited OMB Cloud links ("cloud", "cloud-settings") open nothing.
    if (requestedSettings === "workspaces" || (requestedSettings === "organization" && window.ogb.organization && !remoteClient)) {
      url.searchParams.delete("desktop-settings");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
      if (requestedSettings === "organization") requestEnterpriseEntry();
      open();
    }
    return window.ogb.environments.onOpenSettings?.(open);
  }, [dispatch]);
  // Slice 6: back from a routine delegation consent at Perspicax: show the
  // outcome in Settings > Organization.
  useEffect(() => {
    if (takeRoutineDelegationReturn()) dispatch({ type: "toggleAppSettings", open: true, section: "organization" });
  }, [dispatch]);
  // Slice 7: "Open in Sagax" from the Perspicax console (#thread=…&bot=…):
  // the thread opens once the viewer's lists hold it; a thread they may not
  // see is never listed, so nothing happens and the link is dropped.
  const openThreadTarget = useRef<OpenThreadTarget | null | undefined>(undefined);
  if (openThreadTarget.current === undefined) openThreadTarget.current = pageOpenThreadTarget();
  useEffect(() => {
    if (!openThreadTarget.current) return;
    const timer = setTimeout(() => { openThreadTarget.current = null; }, 30_000);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    const target = openThreadTarget.current;
    if (!target || !openThreadVisible(target, state)) return;
    openThreadTarget.current = null;
    openNotificationTarget(dispatch, target, state);
  }, [state.bots, state.groups, dispatch]);
  // Mobile-only drawer state. Above md, none of these properties are emitted
  // at all — Sidebar scopes every mobile class with max-md: rather than
  // cancelling them with md:, which would still emit a translate value and
  // turn the aside into a containing block for its fixed descendants (see
  // Sidebar.tsx's className comment).
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Apply this device's language, else the server's default, the moment
  // either changes; "" follows the system. The epoch bump re-renders
  // extracted strings — t() reads a module variable, so React needs this nudge.
  const language = effectiveLanguage(useLanguageChoice(), state.config?.language);
  const [, setLocaleEpoch] = useState(0);
  useEffect(() => {
    setLocale(language || globalThis.navigator?.language);
    setLocaleEpoch((epoch) => epoch + 1);
  }, [language]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // the palette and the shortcuts sheet each teach a habit (achievements)
  useEffect(() => {
    if (paletteOpen) reportAchievement("palette.opened");
  }, [paletteOpen]);
  useEffect(() => {
    if (state.shortcutsOpen) reportAchievement("shortcuts.opened");
  }, [state.shortcutsOpen]);
  const [composeOpen, setComposeOpen] = useState(false);
  const [localVmWorkspaceBotId, setLocalVmWorkspaceBotId] = useState<string | null>(null);
  // the Browser tab, expanded into the main column (the small preview in
  // the panel hands off to this and back)
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const previousViewRef = useRef(state.activeView);
  const calendarOriginRef = useRef<"chat" | "team-map">("chat");
  // Someone with no bot of their own still opens on a group they are in.
  const { group, bot } = mainConversation(state.bots, state.groups, state.selectedId);
  const calendarOpen = state.activeView === "routines";

  // Nothing on this machine can run a bot. A missing cloud login does not
  // count — that CLI can still host a local model. Wait for the first
  // /api/instances response before deciding: an empty list means "not asked
  // yet", and flashing the setup screen at every launch would be worse.
  const noEngines =
    state.connected &&
    state.instances.length > 0 &&
    !state.instances.some((i) => i.snapshot.state === "available");
  // An OMB Cloud home with none of the person's own engines signed in yet:
  // its first run, and every bot until then, is the engine sign-in.
  const cloudSignIn = cloudSignInDue(viewer, state, engineReady);

  // App-wide shortcuts: ⌘N new bot · ⌘1–9 jump to bot · ⌘⇧[ / ⌘⇧] prev/next · ⌘/ or ? shortcuts cheat sheet.
  // Kept deliberately small; every panel already closes on Esc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || state.shortcutsOpen) return;
      if (shouldOpenKeyboardShortcuts(e)) {
        e.preventDefault();
        dispatch({ type: "toggleShortcuts", open: true });
        return;
      }

      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const bots = state.bots.filter((b) => !b.hidden);
      if (e.key === "n" && !e.shiftKey) {
        e.preventDefault();
        setComposeOpen((open) => !open);
      } else if (composeOpen && /^[1-9]$/.test(e.key)) {
        return;
      } else if (/^[1-9]$/.test(e.key)) {
        const target = bots[Number(e.key) - 1];
        if (target) {
          e.preventDefault();
          dispatch({ type: "select", id: target.id });
        }
      } else if (e.shiftKey && (e.key === "[" || e.key === "]")) {
        const idx = bots.findIndex((b) => b.id === state.selectedId);
        const next = bots[(idx + (e.key === "]" ? 1 : -1) + bots.length) % bots.length];
        if (next) {
          e.preventDefault();
          dispatch({ type: "select", id: next.id });
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.bots, state.selectedId, state.shortcutsOpen, composeOpen, dispatch]);

  useEffect(() => {
    window.ogb?.setUnreadCount?.(unreadCount);
  }, [unreadCount]);

  // Warm connected-account state as soon as the local server is available.
  // The modal then opens with the correct Connect/Add account buttons and
  // quietly revalidates instead of rediscovering every account from scratch.
  useEffect(() => {
    if (!state.connected) return;
    void preloadConnectedApps().catch(() => {});
  }, [state.connected]);

  // Picking a conversation closes the drawer: on a phone the chat is what you
  // asked for, and leaving the list up would hide it. Watching activeView too
  // catches re-selecting the bot that is already current from another view —
  // the reducer switches the view without changing selectedId. pluginsOpen
  // and settingsOpen cover the same idea from a different trigger: close the
  // drawer whenever an action opens something over the chat.
  useEffect(() => {
    setDrawerOpen(false);
  }, [state.selectedId, bot?.threadId, group?.threadId, state.activeView, state.pluginsOpen, state.settingsOpen]);
  useEffect(() => {
    setComposeOpen(false);
  }, [state.selectedId, state.activeView]);

  if (previousViewRef.current !== state.activeView) {
    if (state.activeView === "routines" && previousViewRef.current !== "routines") {
      calendarOriginRef.current = previousViewRef.current === "team-map" ? "team-map" : "chat";
    }
    previousViewRef.current = state.activeView;
  }
  const mainIsTeamMap = state.activeView === "team-map";
  const calendarFillsMain = calendarOpen;

  useEffect(() => {
    if (
      localVmWorkspaceBotId &&
      (state.activeView !== "chat" || state.selectedId !== localVmWorkspaceBotId)
    ) {
      setLocalVmWorkspaceBotId(null);
    }
  }, [localVmWorkspaceBotId, state.activeView, state.selectedId]);

  const openLocalVmWorkspace = (botId: string) => {
    dispatch({ type: "toggleComputer", open: false });
    setLocalVmWorkspaceBotId(botId);
  };

  const openComputerFromWorkspace = (botId: string) => {
    setLocalVmWorkspaceBotId(null);
    dispatch({ type: "select", id: botId });
    dispatch({ type: "toggleComputer", open: true });
  };

  const closeCalendar = useCallback(() => {
    if (calendarOriginRef.current === "team-map") {
      dispatch({ type: "showTeamMap" });
      return;
    }
    dispatch({ type: "select", id: state.selectedId });
  }, [dispatch, state.selectedId]);
  const openCalendarRoom = useCallback((id: string) => {
    dispatch({ type: "select", id });
  }, [dispatch]);

  const nativeViewOverlayOpen =
    drawerOpen ||
    paletteOpen ||
    state.settingsOpen ||
    state.computerOpen ||
    state.inspectorOpen ||
    state.appSettingsOpen ||
    state.pluginsOpen;

  // The macOS app menu's Preferences… item lives in the desktop shell, so the
  // shell signals the request over the bridge (Cmd+, accelerates the item).
  // Local-shell only: remote server pages never receive the channel, and ogb
  // is absent in the browser.
  useEffect(() => {
    return window.ogb?.onOpenAppSettings?.(section => {
      if (section === "organization" && window.ogb && !remoteClient) requestEnterpriseEntry();
      dispatch({ type: "toggleAppSettings", open: true, ...(section === "organization" && window.ogb && !remoteClient ? { section } : {}) });
    });
  }, [dispatch]);

  // The viewer outlives ComputerPanel and can target any bot, so release control
  // here (always mounted) when a bot's viewer closes. release() is idempotent.
  useEffect(() => {
    return window.ogb?.desktopViewer?.onState((viewer) => {
      if (viewer.open || !viewer.contextId) return;
      const botId = viewer.contextId;
      void fetch(`/api/bots/${botId}/computer/control`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "release" }),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((snap) => {
          if (snap) dispatch({ type: "computerControl", botId, held: snap.held === true, helpReason: snap.helpReason ?? null });
        })
        .catch(() => {});
      void fetch(`/api/bots/${botId}/computer/viewer-close`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }).catch(() => {});
    });
  }, [dispatch]);

  return (
    <div className="flex h-full flex-col" data-app-shell="">
      {/* fixed-position popup, bottom-left — outside the layout flow */}
      <UpdateBanner />
      {/* Hibou 98 only: title bar, menus and toolbar (renders nothing otherwise) */}
      <RetroChromeSlot slot="top" onNewBot={() => setComposeOpen((open) => !open)} />
      <div className="app-shell-row relative flex min-h-0 flex-1">
      <button
        type="button"
        ref={menuButtonRef}
        aria-label="Open bot list"
        aria-expanded={drawerOpen}
        onClick={() => setDrawerOpen(true)}
        className="absolute left-3 top-3 z-30 rounded-md p-1.5 text-ink-secondary hover:bg-raised hover:text-ink md:hidden"
      >
        <Menu size={18} />
      </button>
      {drawerOpen && (
        <div
          aria-hidden
          onMouseDown={(e) => e.target === e.currentTarget && setDrawerOpen(false)}
          className="absolute inset-0 z-30 bg-black/50 md:hidden"
        />
      )}
      <Sidebar
        open={drawerOpen}
        composeOpen={composeOpen}
        onCompose={() => setComposeOpen((open) => !open)}
        onClose={() => {
          setDrawerOpen(false);
          menuButtonRef.current?.focus();
        }}
      />
      <div className="app-content-frame relative flex h-full min-w-0 flex-1 flex-col">
      {composeOpen && (group || bot) ? (
        group ? <GroupView key={group.id} group={group} /> : bot ? <ChatView bot={bot} /> : null
      ) : calendarFillsMain ? (
        <RoutinesPage fill onBack={closeCalendar} onOpenRoom={openCalendarRoom} />
      ) : mainIsTeamMap ? (
        <TeamMapPage />
      ) : !remoteClient && localVmWorkspaceBotId ? (
        <LocalVmWorkspace
          primaryBotId={localVmWorkspaceBotId}
          overlayOpen={nativeViewOverlayOpen}
          onClose={() => setLocalVmWorkspaceBotId(null)}
          onOpenComputer={openComputerFromWorkspace}
        />
      ) : cloudSignIn ? (
        <CloudEngineSignIn />
      ) : noEngines ? (
        <NoEngines />
      ) : group ? (
        <GroupView key={group.id} group={group} />
      ) : bot ? (
        <ChatView bot={bot} />
      ) : (
        state.connected ? (
          // Connected with no bot: an empty state that invites creating one,
          // not a spinner (nothing is loading).
          <main className="flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-3 bg-app text-ink-secondary">
            <BotIcon size={28} aria-hidden />
            <div className="text-center">
              <div className="text-[15px] text-ink">{t("app.empty.title")}</div>
              <div className="mt-1 text-[13px]">{t("app.empty.body")}</div>
            </div>
            {viewerCanCreateBots(state.config) ? (
              <button type="button" className="ui-button mt-1 inline-flex items-center gap-1.5" onClick={() => dispatch({ type: "toggleNewBot", open: true })}>
                <Plus size={14} aria-hidden />
                {t("app.empty.create")}
              </button>
            ) : viewerBotsReadOnly(state.config) && (
              <p role="note" data-bots-read-only className="max-w-sm text-center text-[13px]">{t("bots.readOnly.notice")}</p>
            )}
          </main>
        ) : (
        <main className="flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-3 bg-app text-ink-secondary">
          <Loader2 size={20} className="animate-spin" />
          <div className="text-[14px]">
            {"Connecting to the bot server…"}
          </div>
          {!state.connected && (
            <div className="text-[12px]">
              Start it with <code className="rounded bg-raised px-1.5 py-0.5">pnpm dev:server</code>
            </div>
          )}
        </main>
        )
      )}
      {composeOpen && <ComposeToPicker onClose={() => setComposeOpen(false)} />}
      </div>
      {/* The panels below are siblings, so their keys must differ even
          though each is remounted per bot. Two siblings keyed `bot.id`
          collide in React's keyed reconciliation whenever both are open
          (Computer panel, then the usage chip): every re-render mounts a
          fresh settings panel and never removes the previous one, so the
          panels pile up and Close stops working. */}
      {/* One tabbed bot panel (Details, Routines, Files, Computer, Advanced) on the
          desktop; its Computer tab is the store's computer view, so both
          flags render the same panel under one key. */}
      {!remoteClient && (state.settingsOpen || state.computerOpen) && bot && (
        <BotSettingsDialog key={`panel:${bot.id}`} bot={bot} onOpenVmWorkspace={openLocalVmWorkspace} />
      )}
      {remoteClient && state.settingsOpen && bot && <RemoteAgentSettingsPanel bot={bot} />}
      {state.personPanelId && <PersonPanel key={`person:${state.personPanelId}`} personId={state.personPanelId} />}
      {remoteClient && state.computerOpen && bot && (
        <RemoteDesktopPanel key={`computer:${bot.id}`} bot={bot} />
      )}
      {!remoteClient && state.inspectorOpen && bot && <InspectorPanel key={bot.threadId} bot={bot} />}
      {state.appSettingsOpen && <SettingsModal />}
      {/* On the person's Cloud: its setup checklist, and after it Move to
          Cloud's one-time card on an empty Cloud (desktop app only). */}
      <CloudSetup viewer={viewer} />
      {state.pluginsOpen && <PluginsPanel />}
      {state.newBotOpen && <NewBotDialog />}
      {state.shortcutsOpen && (
        <KeyboardShortcutsModal
          open={state.shortcutsOpen}
          onClose={() => dispatch({ type: "toggleShortcuts", open: false })}
        />
      )}
      {/* mounted after the modals: same z-50 tier, so DOM order keeps the
          palette on top when one of them is open underneath */}
      <CommandPalette onOpenChange={setPaletteOpen} />
      <StagedOrgImport />
      <RetroAssistantHost />
      <AchievementToaster />
      <CallEngineHost />
      <FloatingBotsHost />
      <RetroBootSlot />
      </div>
      <RetroChromeSlot slot="status" />
      {/* Renderer-drawn caption buttons for the overlay-less frameless
          Windows window. Deliberately the LAST child of the shell: Blink
          resolves -webkit-app-region in DOM-walk order, so these no-drag
          buttons must come after every drag-region header to actually
          subtract from it — earlier placement let the header's drag region
          swallow the buttons (dead clicks, no hover). z-40 keeps true
          modals (z-50, later in DOM) painting above the buttons. */}
      <WindowCaptionButtons
        visible={capabilities.windowChrome === "win-caption" && Boolean(window.ogb?.windowControls)}
      />
    </div>
  );
}

function Application() {
  useEffect(() => {
    initAnalytics();
  }, []);
  const viewer = useWelcomeViewer();
  return (
    <DesktopCapabilitiesProvider>
      <StoreProvider>
        <ThreadRefsProvider>
          <Shell viewer={viewer} />
        </ThreadRefsProvider>
        <WelcomeGate viewer={viewer} />
        <GuidedTour />
        <FirstConversationTour quiet={spotlightsQuiet(viewer)} />
      </StoreProvider>
    </DesktopCapabilitiesProvider>
  );
}

export default function App() {
  return <WorkspaceBackupRecovery><Application /></WorkspaceBackupRecovery>;
}
