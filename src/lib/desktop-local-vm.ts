// The person's own Local VM on their connected computer (organization
// server, server mode), through their desktop app: what the desktop reports
// (electron/local-vm.mjs) and what the Computer screen shows for it. Never
// shows the raw answer: every state and problem has words.
import type { LocaleKey } from "@/locales";

export type LocalVmAction = "status" | "start" | "stop" | "pause" | "resume" | "setup" | "install" | "screenshot" | "protect-retry";
export type InstallChoice = "orbstack-download" | "docker-download" | "docker-windows" | "podman-download" | "orbstack-brew";

export interface DesktopRuntime {
  found: boolean;
  runtime: "docker" | "podman" | null;
  cli: string | null;
  product: string | null;
  daemonUp: boolean;
  installed: string[];
}

export interface DesktopLocalVm {
  name: string;
  state: string;
  managed: boolean;
  stale: "foreign" | "test_container" | "missing_folder" | "other_folder" | "old_image" | null;
  folder: string | null;
  folderExists: boolean;
}

export interface SetupStep { id: "runtime" | "image" | "container" | "start"; state: "pending" | "running" | "done" | "error"; detail: string }
export interface SetupJob { state: "running" | "done" | "error"; steps: SetupStep[]; error: string | null; code: string | null; previousFolder: string | null }

export interface DesktopLocalVmStatus {
  runtime: DesktopRuntime;
  workspace: string;
  vm: DesktopLocalVm | null;
  setup: SetupJob | null;
  install: { product: string; state: string; error: string | null } | null;
  /** SentinelOne on a persistent machine. Absent when install is not required. */
  protection?: { state: "installing" | "active" | "failed"; error?: string; code?: string } | null;
}

export interface LocalVmAnswer {
  ok: boolean;
  text: string;
  status?: DesktopLocalVmStatus;
  image?: string;
}

/** The desktop's answer to one action, structured when it is the status. */
export function parseLocalVmAnswer(body: { result?: { content?: { type?: string; text?: string; data?: string; mimeType?: string }[]; isError?: boolean } }): LocalVmAnswer {
  const content = body.result?.content ?? [];
  const text = content.filter((item) => item.type === "text").map((item) => item.text ?? "").join("\n");
  const picture = content.find((item) => item.type === "image" && typeof item.data === "string");
  const answer: LocalVmAnswer = { ok: body.result?.isError !== true, text: text.slice(0, 2000) };
  if (picture?.data) answer.image = `data:${picture.mimeType === "image/jpeg" ? "image/jpeg" : "image/png"};base64,${picture.data}`;
  try {
    const parsed = JSON.parse(text) as Partial<DesktopLocalVmStatus>;
    if (parsed && typeof parsed === "object" && parsed.runtime && typeof parsed.runtime === "object") answer.status = parsed as DesktopLocalVmStatus;
  } catch { /* plain text */ }
  return answer;
}

/** `desktopId`: the person's computer they picked by name (several PCs);
 * without it the server asks their current one. */
export async function desktopLocalVm(action: LocalVmAction, extra: { choice?: InstallChoice; desktopId?: string } = {}, fetchImpl: typeof fetch = fetch): Promise<LocalVmAnswer> {
  const body = { action, ...(extra.choice !== undefined ? { choice: extra.choice } : {}), ...(extra.desktopId ? { desktopId: extra.desktopId } : {}) };
  const response = await fetchImpl("/api/me/desktop-bridge/local-vm", {
    method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const answer = await response.json().catch(() => ({})) as Parameters<typeof parseLocalVmAnswer>[0] & { error?: string };
  if (!response.ok) throw new Error(answer.error ?? `local VM ${response.status}`);
  return parseLocalVmAnswer(answer);
}

/** The screen's five states, as the person reads them. */
export type ScreenState = "off" | "starting" | "running" | "paused" | "error";

export type LocalVmProblem = "not_connected" | "no_runtime" | "runtime_stopped" | "missing" | "stale" | "foreign" | "setup_failed" | "protection_failed";

export interface LocalVmView {
  state: ScreenState;
  problem: LocalVmProblem | null;
  /** Play sets up (creates, repairs or recreates) the VM: idempotent. */
  canPlay: boolean;
  canPause: boolean;
  canResume: boolean;
  canStop: boolean;
  /** Play needs the person's consent first: it downloads, creates or
   * recreates something on their computer. */
  playNeedsConsent: boolean;
  repair: boolean;
  protection: "installing" | "active" | "failed" | null;
  canRetryProtection: boolean;
}

export function localVmView(status: DesktopLocalVmStatus | null, connected: boolean, pending: LocalVmAction | null = null): LocalVmView {
  const base: LocalVmView = { state: "off", problem: null, canPlay: false, canPause: false, canResume: false, canStop: false, playNeedsConsent: false, repair: false, protection: null, canRetryProtection: false };
  if (!connected) return { ...base, problem: "not_connected" };
  if (pending === "setup" || pending === "start" || pending === "resume" || pending === "protect-retry" || status?.setup?.state === "running") return { ...base, state: "starting" };
  if (!status) return base;
  if (status.setup?.state === "error") {
    const code = status.setup.code;
    const problem: LocalVmProblem = code === "no_runtime" ? "no_runtime" : code === "runtime_stopped" ? "runtime_stopped" : code === "foreign_container" ? "foreign" : "setup_failed";
    if (problem !== "setup_failed" || !status.vm || status.vm.state !== "running") {
      return { ...base, state: "error", problem, canPlay: problem !== "foreign", playNeedsConsent: problem !== "runtime_stopped", repair: problem === "setup_failed" };
    }
  }
  if (!status.runtime.cli && !status.runtime.found) return { ...base, state: "error", problem: "no_runtime" };
  if (!status.runtime.daemonUp) return { ...base, problem: "runtime_stopped", canPlay: true };
  const vm = status.vm;
  if (!vm) return { ...base, problem: "missing", canPlay: true, playNeedsConsent: true };
  if (vm.stale === "foreign") return { ...base, state: "error", problem: "foreign" };
  if (vm.stale && vm.stale !== "old_image") return { ...base, state: "error", problem: "stale", canPlay: true, playNeedsConsent: true, repair: true };
  if (vm.state === "running") {
    const protection = status.protection?.state ?? null;
    if (protection === "installing") return { ...base, state: "starting", canStop: true, protection: "installing" };
    if (protection === "failed") return { ...base, state: "error", problem: "protection_failed", canRetryProtection: true, canStop: true, protection: "failed" };
    if (protection === "active") return { ...base, state: "running", canPause: true, canStop: true, protection: "active" };
    return { ...base, state: "running", canPause: true, canStop: true };
  }
  if (vm.state === "paused") return { ...base, state: "paused", canResume: true, canStop: true };
  if (vm.state === "starting") return { ...base, state: "starting" };
  return { ...base, canPlay: true };
}

/** The words for a problem (the screen's message). */
export function localVmProblemKey(problem: LocalVmProblem): LocaleKey {
  return `localVm.problem.${problem}` as LocaleKey;
}

/** SentinelOne words for the screen, when protection is the message. */
export function localVmStatusCopy(view: LocalVmView, status: DesktopLocalVmStatus | null): { key: LocaleKey; values: Record<string, string> } | null {
  if (view.protection === "installing") return { key: "localVm.protection.installing", values: {} };
  if (view.protection === "failed") {
    if (status?.protection?.code === "timeout") return { key: "localVm.protection.timeout", values: {} };
    return { key: "localVm.problem.protection_failed", values: { error: status?.protection?.error ?? "" } };
  }
  if (view.protection === "active") return { key: "localVm.protection.active", values: {} };
  return null;
}

/** What "found" says about the runtime, for Settings and the screen. */
export function runtimeSummaryKey(runtime: DesktopRuntime | null | undefined): { key: LocaleKey; product: string } {
  if (!runtime || (!runtime.found && !runtime.runtime)) return { key: "localVm.runtime.none" as LocaleKey, product: "" };
  const product = runtime.product ?? runtime.runtime ?? "Docker";
  if (!runtime.runtime) return { key: "localVm.runtime.noCli" as LocaleKey, product };
  return { key: (runtime.daemonUp ? "localVm.runtime.running" : "localVm.runtime.stopped") as LocaleKey, product };
}

/** Install choices for this computer's system. */
export function installChoices(platform: string | undefined): InstallChoice[] {
  if (platform === "win32") return ["docker-windows", "podman-download"];
  if (platform === "darwin") return ["orbstack-download", "docker-download", "orbstack-brew"];
  return ["docker-download", "podman-download"];
}
