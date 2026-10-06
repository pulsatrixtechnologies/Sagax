// A person's own device-code sign-in for an engine CLI that has one and
// keeps its login in a home we choose (organization server, D10):
//
//   Grok Build: `grok login --device-auth` with HOME=<dir> and
//               GROK_HOME=<dir>/.grok -> <dir>/.grok/auth.json
//               (GROK_HOME wins over a server-level home)
//   Kimi Code:  `kimi login --region global` with KIMI_CODE_HOME=<dir>
//               -> <dir>/credentials/kimi-code.json
//
// A fixed login command, not a remote terminal: its output stays in bounded
// private memory. A device link on the provider's own host, its one-time
// code, or a short failure line with those removed, are the only text that
// leaves this file. Signed in means the command exited 0 AND the CLI's
// credential file exists in that home.
import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";

import type { ProviderAuthenticationStart, ProviderAuthenticationStatus } from "../contracts.ts";
import { killCliTree, spawnCli } from "../procs.ts";

const MAX_OUTPUT = 16_384;
const USER_CODE = /^[A-Z0-9]{4,8}-[A-Z0-9]{4,8}$/;

export type DeviceLoginEngine = "grokAgent" | "kimiAgent";

export interface DeviceLoginSpec {
  /** The provider's name in messages. */
  label: string;
  /** The login command's arguments. */
  args: readonly string[];
  /** The environment that points the CLI at `home`. */
  homeEnv(home: string): Record<string, string>;
  /** Where the CLI keeps the login it writes in `home`. */
  credentialFile(home: string): string;
  /** Device pages the link may point at: origin and exact path. */
  pages: ReadonlyArray<{ origin: string; path: string }>;
}

export const DEVICE_LOGIN_SPECS: Readonly<Record<DeviceLoginEngine, DeviceLoginSpec>> = {
  // Verified against grok 1.0.46: prints the link, then the code on its own line.
  grokAgent: {
    label: "Grok",
    args: ["login", "--device-auth"],
    homeEnv: (home) => ({ HOME: home, GROK_HOME: join(home, ".grok") }),
    credentialFile: (home) => join(home, ".grok", "auth.json"),
    pages: [{ origin: "https://accounts.x.ai", path: "/oauth2/device" }],
  },
  // Verified against kimi-code 2.1.1: "...authorize_device?user_code=XXXX-XXXX"
  // and "enter code: XXXX-XXXX". The global region (kimi.ai); a mainland
  // account signs in from its own kimi CLI.
  kimiAgent: {
    label: "Kimi",
    args: ["login", "--region", "global"],
    homeEnv: (home) => ({ KIMI_CODE_HOME: home }),
    credentialFile: (home) => join(home, "credentials", "kimi-code.json"),
    pages: [
      { origin: "https://www.kimi.ai", path: "/code/authorize_device" },
      { origin: "https://www.kimi.com", path: "/code/authorize_device" },
    ],
  },
};

/** A short reason from a login command that exited without a saved login.
 * URLs, device codes and long tokens never leave this file. */
export function deviceLoginFailure(spec: DeviceLoginSpec, output: string): string {
  const generic = `${spec.label} sign-in did not finish. Start sign-in again.`;
  const clean = stripVTControlCharacters(output)
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\b[A-Z0-9]{4,8}-[A-Z0-9]{4,8}\b/g, "")
    .replace(/[A-Za-z0-9+/=_-]{24,}/g, "")
    .replace(/\(\s*\)/g, "");
  if (/connection refused|failed to connect|could not connect|name or service not known|network is unreachable|timed out|certificate|os error 111/i.test(clean)) {
    return `${spec.label} could not reach its sign-in service from this server. Check the server's outbound connection, then try again.`;
  }
  if (/unrecognized|unknown option|unexpected argument/i.test(clean)) {
    return `This server's ${spec.label} CLI needs updating for subscription sign-in.`;
  }
  if (/not found|not installed|no such file|command not found/i.test(clean)) {
    return `${spec.label} is not installed on this server.`;
  }
  const reason = clean
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .find((line) => line.length > 8 && !/^waiting\b/i.test(line) && !/^confirm this code\b/i.test(line) && !/could not open browser/i.test(line) && /error|fail|unable|could not|denied/i.test(line));
  if (!reason) return generic;
  return `${generic} ${reason.slice(0, 180)}`;
}

/** The device link and code in a login command's output, or null. Only a
 * link to the provider's own device page, with no query but the same code,
 * is ever returned; a half-printed last line waits for its newline. */
export function deviceLoginPrompt(spec: DeviceLoginSpec, output: string): { authorizationUrl: string; userCode: string } | null {
  const lines = stripVTControlCharacters(output).split(/\r?\n/).slice(0, -1).map((line) => line.trim());
  let link: URL | null = null;
  for (const line of lines) {
    for (const word of line.split(/\s+/)) {
      if (!word.startsWith("https://")) continue;
      try {
        const url = new URL(word);
        if (spec.pages.some((page) => url.origin === page.origin && url.pathname === page.path) && !url.username && !url.password && !url.hash) {
          link = url;
          break;
        }
      } catch { /* not a link */ }
    }
    if (link) break;
  }
  if (!link) return null;
  const codes = lines.flatMap((line) => line.split(/[\s:]+/)).filter((word) => USER_CODE.test(word));
  const userCode = codes[0];
  if (!userCode) return null;
  const params = [...link.searchParams.keys()];
  if (params.some((name) => name !== "user_code")) return null;
  const inLink = link.searchParams.get("user_code");
  if (inLink !== null && inLink !== userCode) return null;
  const page = new URL(link.origin + link.pathname);
  page.searchParams.set("user_code", userCode);
  return { authorizationUrl: page.href, userCode };
}

interface Flow {
  status: ProviderAuthenticationStatus;
  child: ChildProcess | null;
  ready: boolean;
  resolve: (value: ProviderAuthenticationStart) => void;
  reject: (error: Error) => void;
  startupTimer: NodeJS.Timeout;
  expiryTimer: NodeJS.Timeout;
}

export interface DeviceLoginOptions {
  engine: DeviceLoginEngine;
  cli: string;
  /** The person's own home for the engine (principal-engine-logins.ts). */
  home: string;
  environment: () => Record<string, string | undefined>;
  onAuthenticated?: () => Promise<void>;
  startupTimeoutMs?: number;
  lifetimeMs?: number;
}

export class DeviceLoginController {
  private flow: Flow | null = null;
  private readonly spec: DeviceLoginSpec;
  private readonly options: DeviceLoginOptions;

  constructor(options: DeviceLoginOptions) {
    this.options = options;
    this.spec = DEVICE_LOGIN_SPECS[options.engine];
  }

  /** The CLI's login file is in the person's home. */
  signedIn(): boolean {
    return existsSync(this.spec.credentialFile(this.options.home));
  }

  async start(): Promise<ProviderAuthenticationStart> {
    if (this.flow?.status.phase === "waiting") {
      if (this.flow.ready) return { ...this.flow.status, phase: "waiting" };
      throw new Error(`A ${this.spec.label} sign-in is already starting. Please wait for the code.`);
    }
    if (this.signedIn()) {
      void this.options.onAuthenticated?.().catch(() => {});
      return { phase: "succeeded", flowId: null, authorizationUrl: null, expiresAt: null };
    }
    const lifetime = this.options.lifetimeMs ?? 15 * 60_000;
    return new Promise<ProviderAuthenticationStart>((resolveStart, reject) => {
      const flow: Flow = {
        status: { phase: "waiting", flowId: randomUUID(), authorizationUrl: null, expiresAt: new Date(Date.now() + lifetime).toISOString() },
        child: null,
        ready: false,
        resolve: resolveStart,
        reject,
        startupTimer: setTimeout(() => this.finish(flow, "failed", `${this.spec.label} did not provide a sign-in code in time. Check the server's connection, then try again.`), this.options.startupTimeoutMs ?? 30_000),
        expiryTimer: setTimeout(() => this.finish(flow, "expired", `The ${this.spec.label} sign-in code expired. Start sign-in again.`), lifetime),
      };
      flow.startupTimer.unref();
      flow.expiryTimer.unref();
      this.flow = flow;
      let child: ChildProcess;
      try {
        child = spawnCli(this.options.cli, [...this.spec.args], {
          env: { ...this.options.environment(), ...this.spec.homeEnv(this.options.home), NO_COLOR: "1", BROWSER: "none" },
          cwd: this.options.home,
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch {
        this.finish(flow, "failed", `${this.spec.label} could not start on this server.`);
        return;
      }
      flow.child = child;
      child.stdin?.end();
      let output = "";
      const receive = (chunk: Buffer) => {
        if (flow.status.phase !== "waiting") return;
        // Keep a bounded tail after the code is shown. A CLI that prints the
        // code and then dies still has a reason, with the code stripped later.
        if (output.length < MAX_OUTPUT) output += chunk.toString("utf8").slice(0, MAX_OUTPUT - output.length);
        if (flow.ready) return;
        if (output.length >= MAX_OUTPUT && !deviceLoginPrompt(this.spec, output)) {
          this.finish(flow, "failed", `${this.spec.label} returned an unexpected sign-in response.`);
          return;
        }
        const prompt = deviceLoginPrompt(this.spec, output);
        if (!prompt) return;
        flow.status = { ...flow.status, ...prompt };
        flow.ready = true;
        clearTimeout(flow.startupTimer);
        flow.resolve({ ...flow.status, phase: "waiting" });
      };
      child.stdout?.on("data", receive);
      child.stderr?.on("data", receive);
      child.once("error", (error: NodeJS.ErrnoException) => {
        this.finish(flow, "failed", error.code === "ENOENT" ? `${this.spec.label} is not installed on this server.` : `${this.spec.label} could not start on this server.`);
      });
      child.once("close", (code) => {
        if (flow.child === child) flow.child = null;
        if (flow.status.phase !== "waiting") return;
        if (code === 0 && this.signedIn()) this.finish(flow, "succeeded");
        else this.finish(flow, "failed", deviceLoginFailure(this.spec, output));
      });
    });
  }

  async get(flowId: string): Promise<ProviderAuthenticationStatus> {
    if (!flowId || this.flow?.status.flowId !== flowId) throw new Error("This sign-in is no longer available. Start sign-in again.");
    return { ...this.flow.status };
  }

  async cancel(): Promise<void> {
    if (this.flow?.status.phase === "waiting") this.finish(this.flow, "cancelled", `${this.spec.label} sign-in cancelled.`);
  }

  /** The person's home goes away with the sign-out (principal-engine-logins.ts). */
  async signOut(): Promise<void> {
    await this.cancel();
  }

  async dispose(): Promise<void> {
    await this.cancel();
    this.flow = null;
  }

  private finish(flow: Flow, phase: Exclude<ProviderAuthenticationStatus["phase"], "waiting">, message?: string): void {
    if (flow.status.phase !== "waiting") return;
    clearTimeout(flow.startupTimer);
    clearTimeout(flow.expiryTimer);
    flow.status = { phase, flowId: flow.status.flowId, authorizationUrl: null, expiresAt: null, ...(phase !== "succeeded" && message ? { message } : {}) };
    if (!flow.ready) {
      if (phase === "succeeded") flow.resolve({ ...flow.status, phase });
      else flow.reject(new Error(message ?? `${this.spec.label} sign-in did not finish.`));
    }
    const child = flow.child;
    if (child && child.exitCode === null && child.signalCode === null) void killCliTree(child, 1500).catch(() => false);
    if (phase === "succeeded") void this.options.onAuthenticated?.().catch(() => {});
  }
}
