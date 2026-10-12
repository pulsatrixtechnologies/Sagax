// SentinelOne on a persistent local virtual machine.
//
// The site token stays in this process (SAGAX_S1_SITE_TOKEN). An install
// writes it to a root-only file in the guest and removes that file before
// the outcome is reported. Nothing here puts the token in a command
// argument, a guest variable, a log line, an audit row, or an API body.
// Ephemeral machines, a turned-off organization switch, and a missing
// token skip the install and leave readiness alone.
import { type ChildProcess, spawn as nodeSpawn } from "node:child_process";

import {
  INSTALL_FAILED,
  INSTALLING_PROBLEM,
  S1_POLICY,
  S1_SITE,
  S1_TOKEN_ENV,
  guestOs,
  packagePathFor,
  protectionRequired,
  publicProtection,
  readSiteToken,
  redactText,
  runSentinelOneInstall,
  commandGuestTransport,
} from "../electron/sentinelone-vm.mjs";
import { appendAdminAction } from "./admin-activity.ts";
import { augmentedPath, resolveCliSpawn } from "./env-path.ts";

export type ProtectionState = "installing" | "active" | "failed";
export type ProtectionView = { state: ProtectionState; error?: string; code?: string } | null;

type Outcome = { state: "active" | "failed"; error?: string; code?: string; audited: boolean };
type BookEntry = { state: ProtectionState; error?: string; code?: string; started: Promise<void> };

const book = new Map<string, BookEntry>();

/** Drop in-memory install state. Tests only. */
export function resetSentinelOneForTests(): void {
  book.clear();
}

/** Resolves when the install booked for `key` has finished. Tests only. */
export function sentinelOneSettled(key: string): Promise<void> {
  return book.get(key)?.started ?? Promise.resolve();
}

function viewOf(entry: BookEntry | undefined): ProtectionView {
  if (!entry) return null;
  return publicProtection(entry);
}

function auditInstall(dataDir: string, os: string, outcome: Outcome): void {
  if (!dataDir) return;
  appendAdminAction(dataDir, {
    category: "computer",
    action: "computer.sentinelone_install",
    actor: { kind: "worker" },
    target: { kind: "computer", name: "local-vm" },
    after: {
      os,
      persistent: true,
      result: outcome.state,
      site: S1_SITE,
      policy: S1_POLICY,
      ...(outcome.code ? { code: outcome.code } : {}),
      ...(outcome.error ? { error: outcome.error } : {}),
    },
  });
}

/** Book `installing` before `start` runs, so a second poll cannot start another install. */
function begin(key: string, retry: boolean, start: () => Promise<Outcome>, audit: (outcome: Outcome) => void, token?: string): ProtectionView {
  const current = book.get(key);
  if (current?.state === "installing") return { state: "installing" };
  if (current?.state === "active" && !retry) return { state: "active" };
  if (current?.state === "failed" && !retry) return viewOf(current);
  const entry: BookEntry = { state: "installing", started: Promise.resolve() };
  book.set(key, entry);
  entry.started = (async () => {
    let outcome: Outcome;
    try {
      outcome = await start();
    } catch (error) {
      const message = redactText(error instanceof Error ? error.message : String(error), token).slice(0, 300);
      outcome = { state: "failed", error: message || INSTALL_FAILED, code: "install_failed", audited: true };
    }
    if (book.get(key) !== entry) return;
    entry.state = outcome.state === "active" ? "active" : "failed";
    if (outcome.error) entry.error = outcome.error;
    else delete entry.error;
    if (outcome.code) entry.code = outcome.code;
    else delete entry.code;
    if (outcome.audited) audit(outcome);
  })();
  return { state: "installing" };
}

type GuestRun = { code?: number; stdout?: string; stderr?: string };

/** `docker exec` / `podman exec` for the server's own container runtime.
 * The site token is stdin of the write step only, and is removed from the
 * child environment before spawn. */
export function containerGuestTransport(options: {
  runtime: string;
  container: string;
  os?: string;
  token: string;
  spawnImpl?: (command: string, args: string[], opts: { env: NodeJS.ProcessEnv; stdio: ["pipe" | "ignore", "pipe", "pipe"]; windowsHide: boolean }) => ChildProcess;
}) {
  const spawnImpl = options.spawnImpl ?? nodeSpawn;
  return commandGuestTransport({
    os: options.os,
    token: options.token,
    container: options.container,
    runtime: options.runtime,
    exec: ({ argv, stdin }) => new Promise<GuestRun>((resolve) => {
      const [bin, ...rest] = argv as string[];
      const env: NodeJS.ProcessEnv = { ...process.env, PATH: augmentedPath() };
      delete env[S1_TOKEN_ENV];
      const resolved = resolveCliSpawn(bin ?? options.runtime, rest, env);
      let child: ChildProcess;
      try {
        child = spawnImpl(resolved.command, resolved.args, {
          env,
          stdio: [stdin !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
          windowsHide: true,
        });
      } catch (error) {
        resolve({ code: -1, stdout: "", stderr: redactText(error instanceof Error ? error.message : String(error), options.token) });
        return;
      }
      let stdout = "";
      let stderr = "";
      let settled = false;
      const finish = (code: number) => {
        if (settled) return;
        settled = true;
        resolve({
          code,
          stdout: redactText(stdout, options.token),
          stderr: redactText(stderr, options.token),
        });
      };
      child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
      child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
      if (stdin !== undefined && child.stdin) {
        child.stdin.on("error", () => { /* the guest closed the pipe */ });
        child.stdin.end(stdin);
      }
      child.once("error", (error: Error) => { stderr += error.message; finish(-1); });
      child.once("close", (code: number | null) => finish(code ?? 1));
    }),
  });
}

type StatusLike = { ready: boolean; problem: string | null; container: string; container_name?: string; runtime?: string | null };

function overlay<T extends StatusLike>(status: T, protection: ProtectionView): T & { protection: ProtectionView } {
  if (!protection || protection.state === "active") return { ...status, protection };
  if (protection.state === "failed") {
    return { ...status, ready: false, problem: protection.error ?? INSTALL_FAILED, protection };
  }
  if (status.ready) return { ...status, ready: false, problem: INSTALLING_PROBLEM, protection };
  return { ...status, protection };
}

export type PresentOptions = {
  /** Book key. The container target's key, or `desktop:<person>:<name>`. */
  key: string;
  persistent?: boolean;
  enabled?: boolean;
  dataDir?: string;
  os?: string;
  retry?: boolean;
  env?: NodeJS.ProcessEnv;
  transport?: ReturnType<typeof commandGuestTransport>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

/** Attach protection and, when it is required, hold `ready` until the agent is online. */
export function presentContainerStatus<T extends StatusLike>(status: T, options: PresentOptions): T & { protection: ProtectionView } {
  const env = options.env ?? process.env;
  const token = readSiteToken(env);
  const required = protectionRequired({ persistent: options.persistent, enabled: options.enabled, token: token ?? undefined });
  if (!required || status.container !== "running" || !token) return { ...status, protection: null };
  const os = guestOs(options.os);
  const runtime = status.runtime || "docker";
  const container = status.container_name || "";
  const dataDir = options.dataDir ?? "";
  const protection = begin(options.key, options.retry === true, async () => {
    const transport = options.transport ?? containerGuestTransport({ runtime, container, os, token });
    const outcome = await runSentinelOneInstall({
      transport,
      token,
      os,
      packagePath: packagePathFor(os, env),
      ...(options.now ? { now: options.now } : {}),
      ...(options.sleep ? { sleep: options.sleep } : {}),
    });
    return outcome;
  }, (outcome) => auditInstall(dataDir, os, outcome), token);
  return overlay(status, protection);
}

function resultText(result: unknown): { host: Record<string, unknown>; item: { type?: string; text: string }; text: string } | null {
  if (!result || typeof result !== "object") return null;
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return null;
  const item = content.find((entry) => entry && typeof entry === "object" && (entry as { type?: string }).type === "text" && typeof (entry as { text?: unknown }).text === "string") as { type?: string; text: string } | undefined;
  if (!item) return null;
  return { host: result as Record<string, unknown>, item, text: item.text };
}

function rewrite(host: Record<string, unknown>, item: { text: string }, value: unknown, token: string | null): unknown {
  const text = redactText(JSON.stringify(value), token ?? undefined);
  const content = host.content;
  return {
    ...host,
    content: Array.isArray(content) ? content.map((entry) => entry === item ? { ...item, text } : entry) : content,
  };
}

function interpretDesktop(raw: unknown, token: string): Outcome {
  const found = resultText(raw);
  const text = redactText(found?.text ?? "", token);
  let parsed: { protection?: { state?: string; error?: string; code?: string }; audited?: boolean } | null = null;
  try { parsed = JSON.parse(text) as typeof parsed; } catch { parsed = null; }
  const protection = parsed?.protection;
  const error = protection?.error ? redactText(protection.error, token).slice(0, 300) : undefined;
  if (protection?.state === "active") return { state: "active", audited: parsed?.audited === true };
  if (protection?.state === "failed") {
    return { state: "failed", error: error || INSTALL_FAILED, code: protection.code || "install_failed", audited: parsed?.audited === true };
  }
  return { state: "failed", error: INSTALL_FAILED, code: "install_failed", audited: true };
}

/** Decorate a desktop status payload. A running persistent machine starts
 * the install in the background; this returns at once with `installing`. */
export function decorateDesktopLocalVmResult(options: {
  person: string;
  result: unknown;
  enabled?: boolean;
  dataDir?: string;
  retry?: boolean;
  protect: (token: string) => Promise<unknown>;
  env?: NodeJS.ProcessEnv;
}): unknown {
  const found = resultText(options.result);
  if (!found) return options.result;
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(found.text) as Record<string, unknown>; } catch { return options.result; }
  if (!parsed || typeof parsed !== "object" || !parsed.runtime || typeof parsed.runtime !== "object") return options.result;
  const env = options.env ?? process.env;
  const token = readSiteToken(env);
  const vm = parsed.vm && typeof parsed.vm === "object" ? parsed.vm as { state?: string; name?: string } : null;
  const persistent = parsed.persistent !== false;
  const running = vm?.state === "running";
  if (!protectionRequired({ persistent, enabled: options.enabled, token: token ?? undefined }) || !running || !token) {
    return rewrite(found.host, found.item, { ...parsed, protection: null }, token);
  }
  const os = guestOs(typeof parsed.guestOs === "string" ? parsed.guestOs : undefined);
  const name = typeof vm?.name === "string" && vm.name ? vm.name : "local";
  const key = `desktop:${options.person}:${name}`;
  const dataDir = options.dataDir ?? "";
  const protection = begin(key, options.retry === true, async () => interpretDesktop(await options.protect(token), token), (outcome) => auditInstall(dataDir, os, outcome), token);
  const next: Record<string, unknown> = { ...parsed, protection };
  if (protection?.state === "failed") {
    next.ready = false;
    next.problem = protection.error ?? INSTALL_FAILED;
  } else if (protection?.state === "installing" && parsed.ready === true) {
    next.ready = false;
    next.problem = INSTALLING_PROBLEM;
  }
  return rewrite(found.host, found.item, next, token);
}
