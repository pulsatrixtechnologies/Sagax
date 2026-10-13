export const ENV_PREFIX: string;
export const DEFAULT_TIMEOUT_MS: number;
export const DEFAULT_POLL_MS: number;
export const SECRET_MAX: number;
export const GUEST_DIR: string;

export type HookConfig =
  | { enabled: false; error?: string }
  | {
      enabled: true;
      error?: undefined;
      installScript: string;
      packagePath?: string;
      packageSha256?: string;
      healthScript?: string;
      rollbackScript?: string;
      secret?: string;
      timeoutMs: number;
    };

export type GuestResult = { code: number; stdout?: string; stderr?: string };
export interface HookGuest {
  exec(command: string, options?: { stdin?: string; env?: Record<string, string> }): Promise<GuestResult>;
  writeFile(path: string, bytes: Uint8Array, options: { mode: number }): Promise<void>;
}
export type HookResult = { status: "skipped" | "healthy" | "rolled-back" | "failed"; step: string; detail: string };

export function vmIsPersistent(target?: { persistent?: boolean } | null): boolean;
export function readHookConfig(env?: Record<string, string | undefined>): HookConfig;
export function sha256Hex(bytes: Uint8Array | string): string;
export function checksumMatches(bytes: Uint8Array | string, expected: string | undefined): boolean;
export function redact(text: unknown, secret?: string): string;
export function runProtectionHook(options: {
  target?: { persistent?: boolean } | null;
  guest: HookGuest;
  env?: Record<string, string | undefined>;
  config?: HookConfig;
  readHostFile?: (path: string) => Promise<Uint8Array>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  pollMs?: number;
}): Promise<HookResult>;
