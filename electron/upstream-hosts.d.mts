export declare const BLOCKED_DOMAINS: readonly string[];
export declare const BLOCKED_GITHUB_OWNERS: readonly string[];
export declare function isBlockedHost(host: string | null | undefined): boolean;
export declare function isBlockedUrl(value: unknown): boolean;
export declare class BlockedHostError extends Error {
  constructor(url: string);
  code: "ERR_SAGAX_BLOCKED_HOST";
}
export declare function guardFetch<T>(fetcher: T): T;
export declare function installFetchGuard(scope?: { fetch?: unknown }): unknown;
export declare function blockedRequestPatterns(): string[];
export declare function installSessionBlock(session: unknown, log?: (line: string) => void): void;
