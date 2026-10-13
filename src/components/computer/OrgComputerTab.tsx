// The Computer tab on an organization server, self-contained so it slots
// into any bot panel layout. It looks like the solo panel: one large screen
// (ComputerScreen) with Play / Pause / Stop on it and "<Bot>'s screen" below,
// showing the computer this bot uses, as its Works on says
// (src/lib/place.ts orgComputerFor):
//
// - Auto and Cloud: the person's server environment (power, live desktop
//   through SandboxDesktopView, view-only until they take control);
// - Local VM and This computer: their own computer through the desktop app
//   (src/lib/desktop-local-vm.ts, electron/local-vm.mjs), set up, repaired or
//   started from the screen itself.
//
// Above the screen, when there is more than one to look at, a segmented
// control: Cloud, then each of the person's online computers by its name
// (a person with two PCs sees two), a dot on the one the bot works on.
// Picking one only changes the screen shown (and where its Local VM
// actions go, `desktopId`), never where the bot works.
//
// Under it, only the usage of that computer (disk, CPU, memory, OS) behind
// a small Details toggle. The bot's Works on is Edit persona > Access
// (WorksOnSetting), not a control on this screen.
//
// Every action is the signed-in person's own (the server takes the person
// from the session); nothing here names a bot or another person.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ChevronDown, Cpu, Globe, HardDrive, Info, Laptop, MemoryStick, Server, type LucideIcon } from "lucide-react";

import { chosenComputer, computerChoices, currentDesktop, type DesktopBridgeStatus } from "@/lib/desktop-bridge";
import {
  desktopLocalVm, installChoices, localVmProblemKey, localVmView, runtimeSummaryKey,
  type DesktopLocalVmStatus, type InstallChoice, type LocalVmAction, type ScreenState, type SetupStep,
} from "@/lib/desktop-local-vm";
import { t } from "@/lib/i18n";
import { orgComputerFor, type EffectivePlace } from "@/lib/place";
import {
  formatBytes, loadServerEnvironment, loadServerEnvironmentStats, powerServerEnvironment, powerState,
  type PowerAction, type ServerEnvironmentStats, type ServerEnvironmentStatus,
} from "@/lib/server-environment";
import { SandboxDesktopView } from "../SandboxDesktopView";
import { ComputerScreen, type ScreenAction } from "./ComputerScreen";
import { SandboxDesktopModal } from "./SandboxDesktopModal";

const STATS_REFRESH_MS = 5_000;
const STATS_IDLE_REFRESH_MS = 15_000;
const LOCAL_STATUS_MS = 10_000;
const LOCAL_SETUP_MS = 2_000;
const LOCAL_FRAME_MS = 4_000;

export type ComputerSource = "local" | "server";

/** The screen tells the usage panel beside it that the environment changed
 * (started, paused, stopped, its view connected), so the figures follow at
 * once instead of at the next slow poll. */
const SERVER_ENVIRONMENT_CHANGED = "sagax:server-environment-changed";
const announceServerEnvironment = () => { window.dispatchEvent(new Event(SERVER_ENVIRONMENT_CHANGED)); };

/** Which computer this bot uses, from its Works on, and why (one sentence). */
export function activeComputer(bridge: DesktopBridgeStatus, place: EffectivePlace): { source: ComputerSource; reason: "cloud" | "computer" | "notConnected" | "none" } {
  const computer = orgComputerFor(place);
  if (computer === "server") return { source: "server", reason: "cloud" };
  if (computer === "computer") return { source: "local", reason: bridge.connected ? "computer" : "notConnected" };
  return { source: "server", reason: "none" };
}

export function OrgComputerTab({ bridge, place, computerOff, botName, initialLocal = null, browser = null }: {
  bridge: DesktopBridgeStatus;
  /** The bot's Works on (Auto when unset). */
  place: EffectivePlace;
  computerOff: boolean; botName: string;
  /** Tests: the desktop's Local VM status to start from. */
  initialLocal?: DesktopLocalVmStatus | null;
  /** The bot's live browser, offered as the picker's last chip. */
  browser?: ReactNode;
}) {
  const active = activeComputer(bridge, place);
  const choices = computerChoices(bridge);
  const [picked, setPicked] = useState<string | null>(null);
  // a bot that works on its browser opens on it
  const showingBrowser = browser !== null && (picked === "browser" || (picked === null && place === "browser"));
  const chosen = chosenComputer(choices, active.source, bridge, showingBrowser ? null : picked);
  // Works on a computer that is not connected: its screen says so.
  const source = chosen?.source ?? active.source;
  const desktop = chosen?.source === "local" ? bridge.desktops.find((entry) => entry.id === chosen.desktopId) ?? null : currentDesktop(bridge);
  const worksOnKey = active.source === "server" ? "server" : chosenComputer(choices, "local", bridge, null)?.key ?? null;
  const [details, setDetails] = useState(false);
  const caption = t("computer.screenOf", { name: botName });
  return (
    <div className="flex flex-col gap-3" data-org-computer={source === "server" ? "user-sandbox" : "user-desktop"} data-works-on={place}>
      {(choices.length > 1 || browser !== null) && (
        <ScreenPicker
          items={[
            ...choices.map((choice): ScreenPickerItem => ({
              key: choice.key,
              label: choice.source === "server" ? t("orgComputer.choice.cloud") : choice.name,
              icon: choice.source === "server" ? Server : Laptop,
              here: choice.key === worksOnKey,
            })),
            ...(browser !== null ? [{ key: "browser", label: t("computer.view.browser"), icon: Globe }] : []),
          ]}
          chosen={showingBrowser ? "browser" : chosen?.key ?? null}
          onPick={setPicked}
        />
      )}
      {showingBrowser
        ? <BrowserScreen caption={t("computer.browserOf", { name: botName })}>{browser}</BrowserScreen>
        : source === "server"
        ? <ServerComputerScreen caption={caption} />
        : (
          <LocalComputerScreen
            // a new computer starts over: its own status, frames and errors
            key={chosen?.key ?? "current"}
            bridge={bridge}
            desktopId={chosen?.source === "local" ? chosen.desktopId : undefined}
            caption={chosen?.source === "local" ? `${caption} · ${chosen.name}` : caption}
            initial={initialLocal}
          />
        )}
      {computerOff && !showingBrowser && <p role="note" className="-mt-1 text-center text-[12px] text-ink-secondary">{t("computer.phase.off")}</p>}
      {!showingBrowser && <div className="flex flex-col gap-1.5">
        <button type="button" onClick={() => setDetails((open) => !open)} aria-expanded={details} data-usage-toggle
          className="flex items-center gap-1 self-start text-[12px] text-ink-secondary hover:text-ink">
          <Info size={12} aria-hidden="true" />
          {t("orgComputer.details")}
          <ChevronDown size={12} aria-hidden="true" className={details ? "rotate-180" : undefined} />
        </button>
        {details && (source === "server" ? <UsagePanel /> : <DesktopUsage bridge={bridge} name={desktop?.name} />)}
      </div>}
    </div>
  );
}

/** One chip of a screen picker. */
export interface ScreenPickerItem {
  key: string;
  label: string;
  icon: LucideIcon;
  /** The bot works here: a dot, and the tooltip says so. */
  here?: boolean;
}

/** The Computer tab's one segmented control: Cloud and each of the person's
 * computers by name on an organization server, then the bot's Browser
 * (Screen and Browser on a solo server). The dot marks where the bot works. */
export function ScreenPicker({ items, chosen, onPick }: { items: ScreenPickerItem[]; chosen: string | null; onPick: (key: string) => void }) {
  return (
    <div role="radiogroup" aria-label={t("orgComputer.choice.label")} data-computer-picker=""
      className="flex max-w-full gap-0.5 self-center overflow-x-auto rounded-full bg-control p-0.5 [scrollbar-width:none]">
      {items.map((item) => {
        const selected = item.key === chosen;
        const Icon = item.icon;
        return (
          <button key={item.key} type="button" role="radio" aria-checked={selected} data-computer-choice={item.key}
            title={item.here ? t("orgComputer.choice.worksHere", { name: item.label }) : item.label}
            onClick={() => onPick(item.key)}
            className={`flex min-w-0 shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${
              selected ? "bg-elevated text-ink shadow-sm" : "text-ink-secondary hover:text-ink"}`}>
            <Icon size={12} aria-hidden="true" />
            <span className="max-w-[132px] truncate">{item.label}</span>
            {item.here && <span aria-hidden="true" data-works-here="" className="size-1.5 rounded-full bg-accent" />}
          </button>
        );
      })}
    </div>
  );
}

/** The bot's live browser in the screen's own frame, its name below. */
export function BrowserScreen({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5" data-browser-view="">
      <div className="flex min-h-[360px] flex-col overflow-hidden rounded-md bg-card">{children}</div>
      <p className="text-center text-[13px] text-ink-secondary">{caption}</p>
    </div>
  );
}

function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}

/** The person's server environment on the screen. */
export function ServerComputerScreen({ caption, initial = null }: { caption: string; initial?: ServerEnvironmentStatus | null }) {
  const [status, setStatus] = useState<ServerEnvironmentStatus | null>(initial);
  const [pending, setPending] = useState<PowerAction | null>(null);
  const [error, setError] = useState("");
  // "Take control" opens the large window; the square stays view-only.
  const [takeover, setTakeover] = useState(false);
  const load = useCallback(async () => {
    try { setStatus(await loadServerEnvironment()); } catch { setStatus({ configured: true, state: "unavailable" }); }
    announceServerEnvironment();
  }, []);
  useEffect(() => { if (!initial) void load(); }, [load, initial]);

  const act = async (action: PowerAction) => {
    setPending(action);
    setError("");
    try {
      let next = await powerServerEnvironment(action);
      if (next === null) {
        // A bot is working there right now: shutting down or pausing cuts it short.
        if (!window.confirm(t("orgComputer.confirmRunning"))) return;
        next = await powerServerEnvironment(action, true);
      }
      if (next) { setStatus(next); announceServerEnvironment(); }
    } catch {
      setError(t("orgComputer.actionFailed"));
      await load();
    } finally {
      setPending(null);
    }
  };

  const power = powerState(status?.state, pending);
  const state: ScreenState = !status ? "starting" : !status.configured || power === "unavailable" ? (status.configured ? "error" : "off") : power;
  const busy = pending !== null || !status;
  const message = !status ? undefined
    : !status.configured ? t("serverEnvironment.notConfigured")
    : power === "unavailable" ? t("computerScreen.serverUnavailable")
    : state === "off" ? t("computerScreen.serverOff")
    : undefined;
  const controls = {
    play: status?.configured && power === "off" ? () => void act("start") : undefined,
    resume: power === "paused" ? () => void act("resume") : undefined,
    pause: power === "running" ? () => void act("pause") : undefined,
    stop: power === "running" || power === "paused" ? () => void act("shutdown") : undefined,
  };
  // While the large window has control, the square shows no second live
  // view (one VNC stream, and the window's passwords stay the valid ones).
  const live = takeover
    ? <div data-sandbox-takeover-open className="flex h-full w-full items-center justify-center p-4 text-center text-[12px] text-ink-secondary">{t("sandboxDesktop.inWindow")}</div>
    : <SandboxDesktopView embedded onConnected={() => void load()} onTakeControl={() => setTakeover(true)} />;
  return (
    <>
      <ComputerScreen
        source="server"
        state={state}
        caption={caption}
        message={message}
        busy={busy}
        error={error || undefined}
        live={live}
        actions={state === "error" ? [{ label: t("computerScreen.retry"), onClick: () => void load() }] : []}
        controls={controls}
      />
      {takeover && (
        <SandboxDesktopModal title={caption} state={state} controls={controls} busy={busy}
          onClose={() => setTakeover(false)} onConnected={() => void load()} />
      )}
    </>
  );
}

/** The person's Local VM, through their desktop app. */
export function useDesktopLocalVm(connected: boolean, initial: DesktopLocalVmStatus | null = null, desktopId?: string) {
  const visible = usePageVisible();
  const [status, setStatus] = useState<DesktopLocalVmStatus | null>(initial);
  const [pending, setPending] = useState<LocalVmAction | null>(null);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      const answer = await desktopLocalVm("status", { desktopId });
      if (answer.status) setStatus(answer.status);
      else if (!answer.ok) setError(answer.text);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("orgComputer.actionFailed"));
    }
  }, [desktopId]);
  const settingUp = status?.setup?.state === "running";
  useEffect(() => {
    if (!connected || !visible) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), settingUp ? LOCAL_SETUP_MS : LOCAL_STATUS_MS);
    return () => window.clearInterval(timer);
  }, [connected, visible, refresh, settingUp]);
  const act = useCallback(async (action: LocalVmAction, extra: { choice?: InstallChoice } = {}) => {
    setPending(action);
    setError("");
    try {
      const answer = await desktopLocalVm(action, { ...extra, desktopId });
      if (!answer.ok) setError(answer.text);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("orgComputer.actionFailed"));
    } finally {
      setPending(null);
      await refresh();
    }
  }, [refresh, desktopId]);
  return { status, pending, error, act, refresh, visible };
}

export function LocalComputerScreen({ bridge, caption, initial = null, desktopId }: {
  bridge: DesktopBridgeStatus; caption: string; initial?: DesktopLocalVmStatus | null;
  /** The computer the person picked by name; their current one without it. */
  desktopId?: string;
}) {
  const desktop = desktopId ? bridge.desktops.find((entry) => entry.id === desktopId && entry.online) ?? null : currentDesktop(bridge);
  const connected = Boolean(desktop?.capabilities?.localVm);
  const vm = useDesktopLocalVm(connected, initial, desktopId);
  const view = localVmView(vm.status, connected, vm.pending);
  const [frame, setFrame] = useState<string | null>(null);
  const running = view.state === "running";
  useEffect(() => {
    if (!running || !vm.visible) { setFrame(null); return; }
    let cancelled = false;
    const grab = async () => {
      try {
        const answer = await desktopLocalVm("screenshot", { desktopId });
        if (!cancelled && answer.image) setFrame(answer.image);
      } catch { /* keep the last frame */ }
    };
    void grab();
    const timer = window.setInterval(() => void grab(), LOCAL_FRAME_MS);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [running, vm.visible, desktopId]);

  const setUp = () => {
    if (view.playNeedsConsent && !window.confirm(t(view.repair ? "localVm.consent.repair" : "localVm.consent.create", { folder: vm.status?.workspace ?? "" }))) return;
    void vm.act("setup");
  };
  const setup = vm.status?.setup;
  const runtime = runtimeSummaryKey(vm.status?.runtime);
  const actions: ScreenAction[] = [];
  if (view.problem === "no_runtime") {
    for (const choice of installChoices(desktop?.platform)) actions.push({ label: t(`localVm.install.${choice}`), onClick: () => void vm.act("install", { choice }), primary: actions.length === 0 });
  } else if (view.repair) {
    actions.push({ label: t("localVm.repair"), onClick: setUp, primary: true });
  } else if (view.canPlay && view.state !== "running") {
    actions.push({ label: t(view.problem === "missing" ? "localVm.setupOneClick" : "computerScreen.play"), onClick: setUp, primary: true });
  }
  const message = view.state === "starting" && setup?.state === "running"
    ? setupProgress(setup.steps)
    : view.problem
      ? `${t(localVmProblemKey(view.problem), { product: runtime.product, folder: vm.status?.vm?.folder ?? "" })}${setup?.state === "error" && setup.error && view.problem === "setup_failed" ? ` ${setup.error}` : ""}`
      : view.state === "off" ? t("computerScreen.localOff") : undefined;
  return (
    <>
      <ComputerScreen
        source="local"
        state={view.state}
        caption={caption}
        message={message}
        busy={vm.pending !== null}
        error={vm.error || undefined}
        actions={actions}
        live={frame ? <img src={frame} alt={caption} className="h-full w-full object-contain" /> : undefined}
        controls={{
          play: view.canPlay ? setUp : undefined,
          resume: view.canResume ? () => void vm.act("resume") : undefined,
          pause: view.canPause ? () => void vm.act("pause") : undefined,
          stop: view.canStop ? () => void vm.act("stop") : undefined,
        }}
      />
      {setup?.state === "done" && setup.previousFolder && (
        <p className="text-[11.5px] text-ink-secondary">{t("localVm.previousFolder", { folder: setup.previousFolder })}</p>
      )}
    </>
  );
}

/** "Étape 2 sur 4 : préparation de l'image" while a setup runs. */
export function setupProgress(steps: SetupStep[]): string {
  const index = Math.max(0, steps.findIndex((step) => step.state === "running"));
  const step = steps[index];
  return t("localVm.progress", { step: index + 1, total: steps.length, label: t(`localVm.step.${step?.id ?? "runtime"}`) });
}

/** Disk, CPU, memory and OS of the person's server environment, refreshed
 * every few seconds while the tab is visible (more often while it runs). */
export function UsagePanel() {
  const visible = usePageVisible();
  const [stats, setStats] = useState<ServerEnvironmentStats | null>(null);
  const running = stats?.state === "running" || stats?.state === "paused";
  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    const load = async () => {
      try { setStats(await loadServerEnvironmentStats(controller.signal)); } catch { /* keep the last one */ }
    };
    void load();
    // Keep asking while it is off too: the person may start it from the
    // screen above, and a usage panel frozen on its first answer kept
    // showing "?" next to a running desktop.
    const timer = window.setInterval(() => void load(), running ? STATS_REFRESH_MS : STATS_IDLE_REFRESH_MS);
    const changed = () => void load();
    window.addEventListener(SERVER_ENVIRONMENT_CHANGED, changed);
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener(SERVER_ENVIRONMENT_CHANGED, changed); };
  }, [visible, running]);
  const live = stats?.state === "running";
  return (
    <dl aria-label={t("orgComputer.usage")} className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-xl border border-hairline p-3 text-[12px]">
      <Row icon={HardDrive} label={t("orgComputer.disk")} value={stats ? t("orgComputer.usedOf", { used: formatBytes(stats.workspaceBytes), limit: formatBytes(stats.workspaceQuotaBytes) }) : "?"} />
      <Row icon={Cpu} label={t("orgComputer.cpu")} value={live && stats.cpuPercent !== null ? t("orgComputer.cpuValue", { percent: Math.round(stats.cpuPercent) }) : "?"} />
      <Row icon={MemoryStick} label={t("orgComputer.memory")} value={stats ? t("orgComputer.usedOf", { used: live ? formatBytes(stats.memoryBytes) : "?", limit: formatBytes(stats.memoryLimitBytes) }) : "?"} />
      <Row icon={Server} label={t("orgComputer.os")} value={stats ? [stats.os, stats.arch].filter(Boolean).join(" ") || "Linux" : "?"} detail={stats?.image} />
    </dl>
  );
}

/** The person's own computer: its coarse facts (the Local VM runs there). */
function DesktopUsage({ bridge, name }: { bridge: DesktopBridgeStatus; name: string | undefined }) {
  const system = currentDesktop(bridge)?.system;
  return (
    <dl aria-label={t("orgComputer.usage")} className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-xl border border-hairline p-3 text-[12px]">
      <Row icon={HardDrive} label={t("orgComputer.disk")} value={system?.diskGb !== undefined ? t("orgComputer.freeOf", { free: `${system.diskFreeGb ?? "?"} GB`, total: `${system.diskGb} GB` }) : "?"} />
      <Row icon={Cpu} label={t("orgComputer.cpu")} value={system ? [system.cpuPercent !== undefined ? t("orgComputer.cpuValue", { percent: system.cpuPercent }) : null, t("orgComputer.cores", { count: system.cpus })].filter(Boolean).join(", ") : "?"} detail={system?.cpuModel} />
      <Row icon={MemoryStick} label={t("orgComputer.memory")} value={system ? t("orgComputer.usedOf", { used: system.memoryUsedGb !== undefined ? `${system.memoryUsedGb} GB` : "?", limit: `${system.memoryGb} GB` }) : "?"} />
      <Row icon={Laptop} label={t("orgComputer.os")} value={system ? `${system.os} ${system.arch}` : "?"} detail={name} />
    </dl>
  );
}

function Row({ icon: Icon, label, value, detail }: { icon: typeof Cpu; label: string; value: string; detail?: string | undefined }) {
  return (
    <>
      <dt className="flex items-center gap-1.5 text-ink-secondary"><Icon size={12} aria-hidden="true" />{label}</dt>
      <dd className="min-w-0 truncate text-ink" title={detail ? `${value} (${detail})` : value}>{value}{detail && <span className="text-ink-secondary"> · {detail}</span>}</dd>
    </>
  );
}
