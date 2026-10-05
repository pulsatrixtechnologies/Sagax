// A person's own engine subscriptions on an organization server (slice 4,
// decision D10). Each person signs in to Claude, Codex, Grok Build or Kimi
// Code with their own account; the login lives in their own directory:
//
//   ${DATA_DIR}/principals/<principalId>/claude   (CLAUDE_CONFIG_DIR, 0700)
//   ${DATA_DIR}/principals/<principalId>/codex    (CODEX_HOME, 0700)
//   ${DATA_DIR}/principals/<principalId>/grok     (HOME of the grok CLI, 0700)
//   ${DATA_DIR}/principals/<principalId>/kimi     (KIMI_CODE_HOME, 0700)
//
// Signed in means our marker `<dir>/.pulsabot-login.json` ({ at }, 0600),
// written when the CLI reports success and removed on sign-out; nothing else
// is trusted. The flows are the drivers' own login controllers
// (ClaudeLoginController, CodexDeviceAuthController, and the device-code
// DeviceLoginController for Grok and Kimi) pointed at that
// directory, one flow per (person, engine), owned by the session that
// started it and ended with it (provider-auth-sessions.ts).
//
// A subscription only ever serves its owner speaking (engine-credentials.ts).
import { chmodSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "./atomic.ts";
import type { ProviderAuthenticationStart, ProviderAuthenticationStatus } from "./contracts.ts";
import { ClaudeLoginController } from "./drivers/claude-login-auth.ts";
import { CodexDeviceAuthController } from "./drivers/codex-device-auth.ts";
import { DeviceLoginController } from "./drivers/device-login.ts";
import { ProviderAuthSessions } from "./provider-auth-sessions.ts";
import { isPrincipalId } from "./principals.ts";

export const LOGIN_MARKER = ".pulsabot-login.json";
export type LoginDriver = "claudeAgent" | "codex" | "grokAgent" | "kimiAgent";

/** Each driver's own command when the instance saved none and the registry
 * has no default yet. API engines are absent on purpose: they have no CLI,
 * and a sign-in must not borrow Claude's command. */
const DEFAULT_CLI: Readonly<Record<string, string>> = {
  claudeAgent: "claude",
  codex: "codex",
  grokAgent: "grok",
  kimiAgent: "kimi",
  geminiAgent: "gemini",
  piAgent: "pi",
  cursorAgent: "cursor-agent",
  droidAgent: "droid",
  opencodeGo: "opencode",
  hermesAgent: "hermes",
  qwenAgent: "qwen",
  antigravityAgent: "agy",
};

/** Executable for a person's subscription sign-in.
 * A saved config.cli wins, then the registry's default for that instance.
 * Otherwise the driver's own command. An engine with no command yields "",
 * never another engine's binary. */
export function loginCliFor(driver: string, configured: unknown, driverDefault: string | null | undefined): string {
  const raw = typeof configured === "string" ? configured.trim() : "";
  if (raw) return raw;
  const fallback = typeof driverDefault === "string" ? driverDefault.trim() : "";
  if (fallback) return fallback;
  return DEFAULT_CLI[driver] ?? "";
}

const LOGIN_DIR: Readonly<Record<LoginDriver, string>> = { claudeAgent: "claude", codex: "codex", grokAgent: "grok", kimiAgent: "kimi" };

export interface LoginController {
  start(): Promise<ProviderAuthenticationStart>;
  get(flowId: string): Promise<ProviderAuthenticationStatus>;
  complete?(flowId: string, pasted: string): Promise<void>;
  cancel(): Promise<void>;
  signOut(): Promise<void>;
  dispose?(): Promise<void>;
}

export interface LoginInstanceFacts {
  driver: string;
  cli: string;
  /** The instance's own environment (Settings), merged over the process's. */
  environment?: Record<string, string | undefined>;
}

export interface PrincipalEngineLoginsOptions {
  dataDir: string;
  /** The instance's driver, CLI and environment, or null when unknown. */
  instance(instanceId: string): LoginInstanceFacts | null;
  /** Tests pass fakes; the default is the drivers' own controllers. */
  controller?(input: { driver: LoginDriver; cli: string; home: string; environment: () => Record<string, string | undefined>; onAuthenticated: () => Promise<void> }): LoginController;
  now?: () => number;
}

const failure = (message: string, status: number) => Object.assign(new Error(message), { status });

export function isLoginDriver(driver: string): driver is LoginDriver {
  return driver === "claudeAgent" || driver === "codex" || driver === "grokAgent" || driver === "kimiAgent";
}

export class PrincipalEngineLogins {
  private readonly options: PrincipalEngineLoginsOptions;
  private readonly sessions = new ProviderAuthSessions();
  private readonly controllers = new Map<string, LoginController>();
  private readonly now: () => number;

  constructor(options: PrincipalEngineLoginsOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
  }

  /** The person's login directory for a driver (not created). */
  loginDir(principalId: string, driver: LoginDriver): string {
    if (!isPrincipalId(principalId)) throw failure("not a person", 400);
    return join(this.options.dataDir, "principals", principalId, LOGIN_DIR[driver]);
  }

  signedIn(principalId: string, driver: string): boolean {
    if (!isLoginDriver(driver) || !isPrincipalId(principalId)) return false;
    return existsSync(join(this.loginDir(principalId, driver), LOGIN_MARKER));
  }

  private ensureDir(principalId: string, driver: LoginDriver): string {
    const personDir = join(this.options.dataDir, "principals", principalId);
    mkdirSync(personDir, { recursive: true, mode: 0o700 });
    const dir = this.loginDir(principalId, driver);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
      chmodSync(personDir, 0o700);
      chmodSync(dir, 0o700);
    } catch {
      /* best effort on filesystems without modes */
    }
    return dir;
  }

  private markSignedIn(principalId: string, driver: LoginDriver): void {
    const dir = this.ensureDir(principalId, driver);
    writeFileAtomic(join(dir, LOGIN_MARKER), JSON.stringify({ at: this.now() }), { mode: 0o600 });
  }

  private flowKey(principalId: string, instanceId: string): string {
    return `${principalId}/${instanceId}`;
  }

  private loginInstance(principalId: string, instanceId: string) {
    const facts = this.options.instance(instanceId);
    if (!facts || !isLoginDriver(facts.driver) || !facts.cli.trim()) throw failure("This engine has no personal sign-in.", 404);
    const driver = facts.driver;
    const key = this.flowKey(principalId, instanceId);
    let controller = this.controllers.get(key);
    if (!controller) {
      const dir = this.ensureDir(principalId, driver);
      const environment = () => {
        const env: Record<string, string | undefined> = { ...process.env, ...facts.environment };
        if (driver === "claudeAgent") {
          env.CLAUDE_CONFIG_DIR = dir;
          delete env.ANTHROPIC_API_KEY;
          delete env.ANTHROPIC_AUTH_TOKEN;
        } else if (driver === "codex") {
          env.CODEX_HOME = dir;
          delete env.OPENAI_API_KEY;
        } else {
          // the device login writes into the person's home only
          delete env.XAI_API_KEY;
          delete env.MOONSHOT_API_KEY;
          delete env.KIMI_API_KEY;
          if (driver === "grokAgent") {
            // GROK_HOME outranks $HOME/.grok. A copied server GROK_HOME must
            // not win over the overlay the device login applies next.
            env.HOME = dir;
            env.GROK_HOME = join(dir, ".grok");
          }
        }
        return env;
      };
      const onAuthenticated = async () => { this.markSignedIn(principalId, driver); };
      controller = this.options.controller
        ? this.options.controller({ driver, cli: facts.cli, home: dir, environment, onAuthenticated })
        : driver === "claudeAgent"
          ? new ClaudeLoginController({ cli: facts.cli, environment: environment as () => NodeJS.ProcessEnv, onAuthenticated })
          : driver === "codex"
            ? new CodexDeviceAuthController({ cli: facts.cli, environment, onAuthenticated })
            : new DeviceLoginController({ engine: driver, cli: facts.cli, home: dir, environment, onAuthenticated });
      this.controllers.set(key, controller);
    }
    const bound = controller;
    return {
      driver,
      instance: {
        instanceId: key,
        startAuthentication: () => bound.start(),
        getAuthentication: async (flowId: string) => {
          const status = await bound.get(flowId);
          // The marker follows the CLI's verdict even when the callback raced.
          if (status.phase === "succeeded" && !this.signedIn(principalId, driver)) this.markSignedIn(principalId, driver);
          return status;
        },
        ...(bound.complete ? { completeAuthentication: (flowId: string, pasted: string) => bound.complete!(flowId, pasted) } : {}),
        cancelAuthentication: () => bound.cancel(),
        signOut: async () => {
          try {
            await bound.signOut();
          } catch {
            /* the directory goes below either way */
          }
          rmSync(this.loginDir(principalId, driver), { recursive: true, force: true });
        },
      },
    };
  }

  async start(principalId: string, instanceId: string, sessionId: string): Promise<ProviderAuthenticationStart> {
    const { instance } = this.loginInstance(principalId, instanceId);
    return this.sessions.start(instance, sessionId);
  }

  async status(principalId: string, instanceId: string, sessionId: string, flowId: string): Promise<ProviderAuthenticationStatus> {
    return this.sessions.status(this.flowKey(principalId, instanceId), sessionId, flowId);
  }

  async complete(principalId: string, instanceId: string, sessionId: string, flowId: string, pasted: string): Promise<void> {
    this.loginInstance(principalId, instanceId);
    return this.sessions.complete(this.flowKey(principalId, instanceId), sessionId, flowId, pasted);
  }

  async cancel(principalId: string, instanceId: string, sessionId: string, flowId: string): Promise<void> {
    return this.sessions.cancel(this.flowKey(principalId, instanceId), sessionId, flowId);
  }

  async signOut(principalId: string, instanceId: string, sessionId: string): Promise<void> {
    const { instance } = this.loginInstance(principalId, instanceId);
    await this.sessions.signOut(instance, sessionId);
  }

  /** A session ended: its flows end with it. */
  revokeOwner(sessionId: string): void {
    this.sessions.revokeOwner(sessionId);
  }
}
