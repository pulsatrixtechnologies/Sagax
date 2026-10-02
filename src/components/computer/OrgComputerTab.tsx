// The Computer tab on an organization server, self-contained so it slots
// into any bot panel layout. It shows where this person's bots do computer
// work right now:
//
// - their server environment (src/lib/sandbox-desktop.ts decides): power
//   controls (Start, Shutdown keeping /workspace, Pause, Resume) with the
//   state (Off, Starting, Running, Paused), the live desktop
//   (SandboxDesktopView) and a light usage panel (disk, CPU, memory, OS);
// - their own computer through the desktop app: "Votre ordinateur", its
//   coarse facts, and its Local VM (status, start) when it has one.
//
// Every action is the signed-in person's own (the server takes the person
// from the session); nothing here names a bot or another person.
import { useCallback, useEffect, useState } from "react";
import { Cpu, HardDrive, Laptop, Loader2, MemoryStick, Pause, Play, Power, Server } from "lucide-react";

import { cn } from "@/lib/cn";
import { currentDesktop, localVmThroughDesktop, type DesktopBridgeStatus } from "@/lib/desktop-bridge";
import { t } from "@/lib/i18n";
import { showsSandboxDesktop } from "@/lib/sandbox-desktop";
import {
  formatBytes, loadServerEnvironment, loadServerEnvironmentStats, powerServerEnvironment, powerState,
  type PowerAction, type ServerEnvironmentStats, type ServerEnvironmentStatus,
} from "@/lib/server-environment";
import { SandboxDesktopView } from "../SandboxDesktopView";

const STATS_REFRESH_MS = 5_000;

export function OrgComputerTab({ bridge, computerOff, botName }: { bridge: DesktopBridgeStatus; computerOff: boolean; botName: string }) {
  const sandbox = showsSandboxDesktop(bridge);
  return (
    <div className="flex flex-col gap-3" data-org-computer={sandbox ? "user-sandbox" : "user-desktop"}>
      {computerOff && <p role="note" className="rounded-lg border border-hairline bg-raised px-3 py-2 text-[12px] text-ink-secondary">{t("computer.phase.off")}</p>}
      {sandbox ? <ServerEnvironmentComputer botName={botName} /> : <YourComputer bridge={bridge} />}
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

function ServerEnvironmentComputer({ botName }: { botName: string }) {
  const [status, setStatus] = useState<ServerEnvironmentStatus | null>(null);
  const [pending, setPending] = useState<PowerAction | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setStatus(await loadServerEnvironment()); } catch { setStatus({ configured: true, state: "unavailable" }); }
  }, []);
  useEffect(() => { void load(); }, [load]);

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
      if (next) setStatus(next);
    } catch {
      setError(t("orgComputer.actionFailed"));
      await load();
    } finally {
      setPending(null);
    }
  };

  const state = powerState(status?.state, pending);
  const busy = pending !== null || !status;
  if (status && !status.configured) return <p role="status" className="text-[13px] text-ink-secondary">{t("serverEnvironment.notConfigured")}</p>;
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-[13px] text-ink-secondary">
          <Server size={14} aria-hidden="true" />
          <span className="truncate">{t("orgComputer.serverOf", { name: botName })}</span>
        </span>
        <PowerChip state={state} />
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label={t("orgComputer.power")}>
        {(state === "off" || state === "unavailable") && (
          <PowerButton icon={Play} label={t("orgComputer.start")} disabled={busy || state === "unavailable"} onClick={() => void act("start")} />
        )}
        {state === "starting" && <PowerButton icon={Loader2} spin label={t("orgComputer.state.starting")} disabled onClick={() => {}} />}
        {state === "running" && <PowerButton icon={Pause} label={t("orgComputer.pause")} disabled={busy} onClick={() => void act("pause")} />}
        {state === "paused" && <PowerButton icon={Play} label={t("orgComputer.resume")} disabled={busy} onClick={() => void act("resume")} />}
        {(state === "running" || state === "paused") && <PowerButton icon={Power} label={t("orgComputer.shutdown")} danger disabled={busy} onClick={() => void act("shutdown")} />}
      </div>
      {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
      <SandboxDesktopView onConnected={() => void load()} />
      <UsagePanel running={state === "running" || state === "paused"} />
    </>
  );
}

function PowerChip({ state }: { state: ReturnType<typeof powerState> }) {
  return (
    <span data-power={state} className={cn(
      "flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px]",
      state === "running" ? "border-success/30 text-success" : state === "paused" || state === "starting" ? "border-warning/30 text-warning" : "border-hairline text-ink-secondary",
    )}>
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", state === "running" ? "bg-success" : state === "paused" || state === "starting" ? "bg-warning" : "bg-ink-secondary/50")} />
      {t(`orgComputer.state.${state}`)}
    </span>
  );
}

function PowerButton({ icon: Icon, label, onClick, disabled, danger, spin }: {
  icon: typeof Play; label: string; onClick: () => void; disabled?: boolean; danger?: boolean; spin?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={cn(
      "flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-lg bg-control px-3 py-2 text-[13px] hover:bg-raised-hover disabled:opacity-50 md:min-h-0",
      danger ? "text-danger" : "text-ink",
    )}>
      <Icon size={14} aria-hidden="true" className={spin ? "animate-spin" : undefined} />
      {label}
    </button>
  );
}

/** Disk, CPU, memory and OS of the person's environment, refreshed every few
 * seconds while the tab is visible and the environment runs. */
function UsagePanel({ running }: { running: boolean }) {
  const visible = usePageVisible();
  const [stats, setStats] = useState<ServerEnvironmentStats | null>(null);
  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    const load = async () => {
      try { setStats(await loadServerEnvironmentStats(controller.signal)); } catch { /* keep the last one */ }
    };
    void load();
    if (!running) return () => controller.abort();
    const timer = window.setInterval(() => void load(), STATS_REFRESH_MS);
    return () => { controller.abort(); window.clearInterval(timer); };
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

function Row({ icon: Icon, label, value, detail }: { icon: typeof Cpu; label: string; value: string; detail?: string | undefined }) {
  return (
    <>
      <dt className="flex items-center gap-1.5 text-ink-secondary"><Icon size={12} aria-hidden="true" />{label}</dt>
      <dd className="min-w-0 truncate text-ink" title={detail ? `${value} (${detail})` : value}>{value}{detail && <span className="text-ink-secondary"> · {detail}</span>}</dd>
    </>
  );
}

/** The person's own PC through the desktop app: status and coarse facts,
 * no power controls (Sagax never shuts down someone's computer). */
function YourComputer({ bridge }: { bridge: DesktopBridgeStatus }) {
  const desktop = currentDesktop(bridge);
  const system = desktop?.system;
  const [vm, setVm] = useState<{ pending: boolean; text: string }>({ pending: false, text: "" });
  const runVm = async (action: "status" | "start") => {
    setVm({ pending: true, text: "" });
    try { setVm({ pending: false, text: await localVmThroughDesktop(action) }); }
    catch (error) { setVm({ pending: false, text: error instanceof Error ? error.message : t("orgComputer.actionFailed") }); }
  };
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-[13px] text-ink-secondary">
          <Laptop size={14} aria-hidden="true" />
          <span className="truncate">{t("orgComputer.yourComputer")}{desktop ? ` · ${desktop.name}` : ""}</span>
        </span>
        <span data-power={desktop ? "running" : "off"} className={cn("rounded-full border px-2 py-0.5 text-[11px]", desktop ? "border-success/30 text-success" : "border-hairline text-ink-secondary")}>
          {t(desktop ? "orgComputer.connected" : "orgComputer.notConnected")}
        </span>
      </div>
      <dl aria-label={t("orgComputer.usage")} className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-xl border border-hairline p-3 text-[12px]">
        <Row icon={Laptop} label={t("orgComputer.os")} value={system ? `${system.os} ${system.arch}` : "?"} />
        <Row icon={Cpu} label={t("orgComputer.cpu")} value={system ? [system.cpuPercent !== undefined ? t("orgComputer.cpuValue", { percent: system.cpuPercent }) : null, t("orgComputer.cores", { count: system.cpus })].filter(Boolean).join(", ") : "?"} detail={system?.cpuModel} />
        <Row icon={MemoryStick} label={t("orgComputer.memory")} value={system ? t("orgComputer.usedOf", { used: system.memoryUsedGb !== undefined ? `${system.memoryUsedGb} GB` : "?", limit: `${system.memoryGb} GB` }) : "?"} />
        <Row icon={HardDrive} label={t("orgComputer.disk")} value={system?.diskGb !== undefined ? t("orgComputer.freeOf", { free: `${system.diskFreeGb ?? "?"} GB`, total: `${system.diskGb} GB` }) : "?"} />
      </dl>
      {desktop?.capabilities?.localVm && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <PowerButton icon={Server} label={t("orgComputer.localVmStatus")} disabled={vm.pending} onClick={() => void runVm("status")} />
            <PowerButton icon={Play} label={t("orgComputer.localVmStart")} disabled={vm.pending} onClick={() => void runVm("start")} />
          </div>
          {vm.text && <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-lg bg-inset p-2 text-[11px] text-ink-secondary">{vm.text}</pre>}
        </div>
      )}
    </>
  );
}
