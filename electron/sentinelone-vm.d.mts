export type GuestOs = "linux-deb" | "linux-rpm" | "windows" | "macos";

export declare const S1_SITE: "Pulsatrix Technologies Inc.";
export declare const S1_POLICY: "detect-only";
export declare const S1_TOKEN_ENV: "SAGAX_S1_SITE_TOKEN";
export declare const S1_TIMEOUT_MS: number;
export declare const S1_POLL_MS: number;
export declare const TOKEN_MAX: number;
export declare const PACKAGE_MISSING: string;
export declare const INSTALLING_PROBLEM: string;
export declare const TIMEOUT_ERROR: string;
export declare const TOKEN_LEFT_ERROR: string;
export declare const INSTALL_FAILED: string;

export declare function vmIsPersistent(target?: { persistent?: boolean } | null): boolean;
export declare function guestOs(value?: string): GuestOs;
export declare function readSiteToken(env?: NodeJS.ProcessEnv): string | null;
export declare function protectionRequired(options?: { persistent?: boolean; enabled?: boolean; token?: string }): boolean;
export declare function redactText(text: unknown, token?: string): string;
export declare function agentOnline(output: unknown): boolean;
export declare function tokenPath(os?: string): string;
export declare function packagePathFor(os: string, env?: NodeJS.ProcessEnv): string | undefined;

export type GuestScripts = { write: string; wipe: string; env: string; probe: string; install: string };
export declare function guestScripts(os?: string): GuestScripts;
export declare function writeScript(os?: string): string;
export declare function wipeScript(os?: string): string;
export declare function envScript(os?: string): string;
export declare function probeScript(os?: string): string;
export declare function installScript(os?: string): string;

export declare function guestExecArgv(options?: {
  runtime?: string;
  container?: string;
  os?: string;
  script?: string;
  env?: Record<string, string>;
  token?: string;
}): string[];

export type GuestExecCall = { argv: string[]; stdin?: string; kind?: string; script: string };
export type GuestRun = { code?: number; stdout?: string; stderr?: string; argv?: string[] };
export type GuestTransport = {
  writeToken(contents: string): Promise<void>;
  run(script: string, env?: Record<string, string>): Promise<GuestRun>;
  wipe(): Promise<void>;
  environment(): Promise<string>;
};

export declare function commandGuestTransport(options: {
  os?: string;
  token: string;
  container: string;
  runtime?: string;
  exec: (call: GuestExecCall) => Promise<GuestRun | void> | GuestRun | void;
}): GuestTransport;

export type ProtectionRecord = { state: "installing" | "active" | "failed"; error?: string; code?: string };
export declare function publicProtection(result: ProtectionRecord | null | undefined): ProtectionRecord | null;

export type InstallOutcome = { state: "active" | "failed"; error?: string; code?: string; audited: boolean };
export declare function runSentinelOneInstall(options: {
  transport: GuestTransport;
  token: string;
  os?: string;
  timeoutMs?: number;
  pollMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  packagePath?: string;
}): Promise<InstallOutcome>;
