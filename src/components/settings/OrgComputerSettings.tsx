// Settings > Computer on an organization server: where bots work (one
// sentence: each bot's Works on decides, Auto being the server environment),
// the Local VM on their own computer
// (found through their desktop app: which runtime, its state, "Set up in one
// click" with visible steps, install offers) and their server environment
// (one line, state, resources, Reset behind "..." with a confirmation, and
// its screen shown here in the app, never in a browser window).
import { useEffect, useState } from "react";
import { Check, Circle, Loader2, MoreHorizontal, X } from "lucide-react";

import { cn } from "@/lib/cn";
import { currentDesktop, type DesktopBridgeStatus } from "@/lib/desktop-bridge";
import { installChoices, localVmProblemKey, localVmView, runtimeSummaryKey, type DesktopLocalVmStatus, type SetupStep } from "@/lib/desktop-local-vm";
import { t } from "@/lib/i18n";
import { loadServerEnvironment, resetServerEnvironment, type ServerEnvironmentStatus } from "@/lib/server-environment";
import { ServerComputerScreen, useDesktopLocalVm } from "../computer/OrgComputerTab";
import { screenStateLabel } from "../computer/ComputerScreen";
import { Card } from "../SettingsPrimitives";
import { serverEnvironmentStateText } from "./MyServerEnvironment";

export function OrgComputerSettings({ bridge, initialLocal = null, initialServer = null, confirm = (text: string) => window.confirm(text) }: {
  bridge: DesktopBridgeStatus;
  initialLocal?: DesktopLocalVmStatus | null;
  initialServer?: ServerEnvironmentStatus | null;
  confirm?: (text: string) => boolean;
}) {
  return (
    <>
      <Card cardId="computer.orgWhere" title={t("orgComputer.where")} subtitle={t("orgComputer.whereHelp")} />
      <LocalVmCard bridge={bridge} initial={initialLocal} confirm={confirm} />
      <ServerEnvironmentCard initial={initialServer} confirm={confirm} />
    </>
  );
}

function LocalVmCard({ bridge, initial, confirm }: { bridge: DesktopBridgeStatus; initial: DesktopLocalVmStatus | null; confirm: (text: string) => boolean }) {
  const desktop = currentDesktop(bridge);
  const connected = Boolean(desktop?.capabilities?.localVm);
  const vm = useDesktopLocalVm(connected, initial);
  const view = localVmView(vm.status, connected, vm.pending);
  const runtime = runtimeSummaryKey(vm.status?.runtime);
  const setup = vm.status?.setup;
  const oneClick = () => {
    if (!confirm(t("localVm.consent.oneClick", { folder: vm.status?.workspace ?? "" }))) return;
    void vm.act("setup");
  };
  return (
    <Card cardId="computer.orgLocalVm" title={t("localVm.title")} subtitle={t("localVm.subtitle")} summary={screenStateLabel(view.state)}>
      <div className="flex flex-col gap-3 text-[13px]" data-org-local-vm={view.state} data-local-vm-problem={view.problem ?? ""}>
        {!connected ? (
          <p role="status" className="text-ink-secondary">{t("localVm.problem.not_connected")}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <StateChip label={screenStateLabel(view.state)} tone={view.state === "running" ? "ok" : view.state === "error" ? "bad" : "idle"} />
              {vm.status && <span className="text-[12px] text-ink-secondary" data-runtime-product={vm.status.runtime.product ?? ""}>{t(runtime.key, { product: runtime.product })}</span>}
            </div>
            {view.problem && view.problem !== "not_connected" && (
              <p className="text-[12px] leading-relaxed text-ink-secondary">{t(localVmProblemKey(view.problem), { product: runtime.product, folder: vm.status?.vm?.folder ?? "" })}</p>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={oneClick} disabled={vm.pending !== null || setup?.state === "running" || view.problem === "foreign"}
                className="flex min-h-[44px] items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-medium text-accent-ink hover:brightness-110 disabled:opacity-50 md:min-h-0">
                {setup?.state === "running" && <Loader2 size={13} aria-hidden="true" className="animate-spin" />}
                {setup?.state === "error" ? t("localVm.retry") : view.repair ? t("localVm.repair") : t("localVm.setupOneClick")}
              </button>
              <button type="button" onClick={() => void vm.refresh()} disabled={vm.pending !== null}
                className="min-h-[44px] rounded-lg border border-hairline/40 px-2.5 py-1 text-[12.5px] text-ink-secondary hover:bg-control hover:text-ink disabled:opacity-40 md:min-h-0">
                {t("vm.main.recheck")}
              </button>
            </div>
            {view.problem === "no_runtime" && (
              <div className="flex flex-col gap-1.5 rounded-lg bg-inset p-3" data-install-offers>
                <span className="text-[12px] text-ink-secondary">{t(desktop?.platform === "win32" ? "localVm.install.helpWindows" : "localVm.install.help")}</span>
                <div className="flex flex-wrap gap-2">
                  {installChoices(desktop?.platform).map((choice) => (
                    <button key={choice} type="button" onClick={() => void vm.act("install", { choice })} disabled={vm.pending !== null}
                      className="min-h-[44px] rounded-lg bg-control px-3 py-1.5 text-[12px] text-ink hover:bg-raised-hover disabled:opacity-50 md:min-h-0">
                      {t(`localVm.install.${choice}`)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {setup && <SetupSteps steps={setup.steps} />}
            {setup?.state === "error" && setup.error && <p role="alert" className="text-[12px] text-danger">{setup.error}</p>}
            {setup?.state === "done" && setup.previousFolder && <p className="text-[12px] text-ink-secondary">{t("localVm.previousFolder", { folder: setup.previousFolder })}</p>}
            {vm.error && <p role="alert" className="text-[12px] text-danger">{vm.error}</p>}
          </>
        )}
      </div>
    </Card>
  );
}

export function SetupSteps({ steps }: { steps: SetupStep[] }) {
  return (
    <ol className="flex flex-col gap-1 text-[12px]" aria-label={t("localVm.steps")}>
      {steps.map((step) => (
        <li key={step.id} data-step={step.id} data-step-state={step.state} className={cn("flex items-center gap-2", step.state === "error" ? "text-danger" : step.state === "pending" ? "text-ink-secondary" : "text-ink")}>
          {step.state === "done" ? <Check size={12} aria-hidden="true" className="text-success" />
            : step.state === "running" ? <Loader2 size={12} aria-hidden="true" className="animate-spin" />
            : step.state === "error" ? <X size={12} aria-hidden="true" />
            : <Circle size={9} aria-hidden="true" />}
          <span>{t(`localVm.step.${step.id}`)}{step.detail && step.state !== "error" ? ` · ${step.detail}` : ""}</span>
        </li>
      ))}
    </ol>
  );
}

function StateChip({ label, tone }: { label: string; tone: "ok" | "bad" | "idle" }) {
  return (
    <span className={cn("rounded-full px-2.5 py-0.5 text-[12px]", tone === "ok" ? "bg-success/15 text-success" : tone === "bad" ? "bg-danger/10 text-danger" : "bg-control text-ink-secondary")}>{label}</span>
  );
}

/** The person's server environment, compact: what it is in one line, its
 * state, its resources, the screen on demand, Reset behind "...". */
export function ServerEnvironmentCard({ initial = null, confirm = (text: string) => window.confirm(text) }: { initial?: ServerEnvironmentStatus | null; confirm?: (text: string) => boolean }) {
  const [status, setStatus] = useState<ServerEnvironmentStatus | null>(initial);
  const [menu, setMenu] = useState(false);
  const [showScreen, setShowScreen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = async () => {
    try { setStatus(await loadServerEnvironment()); } catch { setStatus({ configured: true, state: "unavailable" }); }
  };
  useEffect(() => { if (!initial) void load(); }, []);
  const reset = async () => {
    setMenu(false);
    if (!confirm(t("serverEnvironment.reset.confirm"))) return;
    setBusy(true);
    setError("");
    try { setStatus(await resetServerEnvironment()); } catch { setError(t("serverEnvironment.reset.error")); await load(); } finally { setBusy(false); }
  };
  const limits = status?.limits;
  const usable = Boolean(status?.configured) && !status?.pendingDeletionAt && status?.state !== "unavailable";
  return (
    <Card cardId="computer.orgServerEnvironment" title={t("serverEnvironment.sectionTitle")} subtitle={t("serverEnvironment.oneLine")} summary={serverEnvironmentStateText(status)}>
      <div className="flex flex-col gap-3 text-[13px]" data-server-environment={status?.state ?? (status ? "off" : "loading")}>
        {!status ? <Loader2 size={14} aria-hidden="true" className="animate-spin text-ink-secondary" /> : !status.configured ? (
          <p role="status" className="text-ink-secondary">{t("serverEnvironment.notConfigured")}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <StateChip label={serverEnvironmentStateText(status)} tone={status.state === "running" ? "ok" : status.state === "unavailable" ? "bad" : "idle"} />
              {limits && <span className="text-[12px] text-ink-secondary">{t("serverEnvironment.resourcesValue", { cpus: limits.cpus, memory: limits.memoryMb, disk: limits.diskMb })}</span>}
              <div className="relative ml-auto">
                <button type="button" aria-label={t("serverEnvironment.more")} aria-expanded={menu} onClick={() => setMenu((open) => !open)}
                  className="flex size-8 items-center justify-center rounded-lg text-ink-secondary hover:bg-control hover:text-ink">
                  <MoreHorizontal size={16} aria-hidden="true" />
                </button>
                {menu && (
                  <div role="menu" className="absolute right-0 top-9 z-10 min-w-40 rounded-lg border border-hairline bg-raised p-1 shadow-md">
                    <button type="button" role="menuitem" disabled={busy || !usable} onClick={() => void reset()}
                      className="w-full rounded-md px-2 py-1.5 text-left text-[13px] text-danger hover:bg-control disabled:opacity-50">
                      {t("serverEnvironment.reset")}
                    </button>
                  </div>
                )}
              </div>
            </div>
            <button type="button" disabled={!usable} onClick={() => setShowScreen((open) => !open)} aria-expanded={showScreen}
              className="ui-button w-fit min-h-[44px] md:min-h-0">
              {t(showScreen ? "serverEnvironment.hideScreen" : "serverEnvironment.showScreen")}
            </button>
            {showScreen && <ServerComputerScreen caption={t("serverEnvironment.sectionTitle")} />}
          </>
        )}
        {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
      </div>
    </Card>
  );
}
