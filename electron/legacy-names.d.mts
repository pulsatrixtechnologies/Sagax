type Env = Record<string, string | undefined>;
type Fs = typeof import("node:fs");

export declare const ENV_PREFIX: "SAGAX_";
export declare const LEGACY_ENV_PREFIX: "OMB_";
export declare const LEGACY_ENV_PREFIXES: readonly string[];
export declare const ENV_BRIDGED_MARKER: "OMB_INTERNAL_ENV_BRIDGED";
export declare function legacyEnvName(name: string): string;
export declare function settingOfLegacyEnv(variable: string): string | null;
export declare function readEnv(name: string, env?: Env): string | undefined;
export declare function bridgeLegacyEnv(env?: Env, options?: { warn?: (line: string) => void }): string[];

export declare const DATA_FOLDER: ".sagax";
export declare const LEGACY_DATA_FOLDER: ".openmausbot";
export declare const MIGRATION_BREADCRUMB: string;
export declare function migrateLegacyDir(options: {
  target: string;
  legacy: string;
  isBusy?: (legacy: string) => boolean;
  fs?: Fs;
  log?: (line: string) => void;
  now?: () => number;
  timeoutMs?: number;
  breadcrumb?: string;
}): "exists" | "none" | "busy" | "moved" | "failed";
export declare function defaultDataDir(options?: {
  home?: string;
  fs?: Fs;
  log?: (line: string) => void;
  migrate?: boolean;
  isBusy?: (legacy: string) => boolean;
}): string;

export declare const ENVIRONMENT_PATH: "/.well-known/sagax/environment";
export declare const LEGACY_ENVIRONMENT_PATH: "/.well-known/openmausbot/environment";
export declare const ENVIRONMENT_PATHS: readonly string[];
export declare function fetchEnvironmentDescriptor(origin: string, init?: RequestInit, fetchImpl?: typeof fetch): Promise<Response>;

export declare const URL_SCHEME: "sagax";
export declare const LEGACY_URL_SCHEME: "openmausbot";
export declare const URL_SCHEMES: readonly string[];
export declare function isAppProtocol(protocol: unknown): boolean;
export declare function isAppLink(url: unknown, host: string): boolean;
export declare function appLink(host: string): string;

export declare const TOKEN_PREFIX: "sgx_";
export declare const LEGACY_TOKEN_PREFIX: "omb_";
export declare function hasTokenPrefix(value: unknown, kind: string): boolean;

export declare const HEALTH_APP: "openmausbot";
export declare const HEALTH_PRODUCT: "sagax";
export declare const HEALTH_IDENTITY: Readonly<{ app: "openmausbot"; product: "sagax" }>;
export declare function isOwnHealth(body: unknown): boolean;
