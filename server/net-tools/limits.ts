// In-memory budgets for IT checks. A sliding window of timestamps, not a
// refill rate: a slot returns when its timestamp ages out. The window is not
// charged for a busy server, a cache hit, or a target the syntax already
// refused. Knobs are an options object; nothing here is wired to config.
import type { NetCheckResult } from "../../shared/net-tools/types.ts";
import type { NetLimitClass } from "./model.ts";

export interface ClassLimit {
  person: number;
  bot: number;
  windowMs: number;
  /** Port checks only: a daily cap on top of the short window. */
  personDay?: number;
  dayMs?: number;
}

export interface NetLimitConfig {
  dns: ClassLimit;
  dnsbl: ClassLimit;
  rdap: ClassLimit;
  connect: ClassLimit;
  port: ClassLimit;
  headers: ClassLimit;
  concurrent: number;
}

const TEN_MINUTES = 10 * 60_000;
const ONE_DAY = 24 * 60 * 60_000;

export const DEFAULT_NET_LIMITS: NetLimitConfig = {
  dns: { person: 60, bot: 120, windowMs: TEN_MINUTES },
  dnsbl: { person: 10, bot: 20, windowMs: TEN_MINUTES },
  rdap: { person: 20, bot: 40, windowMs: TEN_MINUTES },
  connect: { person: 30, bot: 60, windowMs: TEN_MINUTES },
  port: { person: 5, bot: 10, windowMs: TEN_MINUTES, personDay: 30, dayMs: ONE_DAY },
  headers: { person: 60, bot: 120, windowMs: TEN_MINUTES },
  concurrent: 8,
};

/** How long a successful answer may be reused. TLS and blocklist knobs wait for those checks. */
export const CACHE_TTL = {
  dnsMaxMs: 60_000,
  nxdomainMs: 60_000,
  tlsMs: 5 * 60_000,
  dnsblMs: 15 * 60_000,
} as const;

/**
 * How long a DNS answer may be reused. A TTL of 0 is not stored. When the
 * resolver reported no TTL, a conclusive answer is kept for one minute.
 * Records that are not part of the answer (a probe, a PTR on an MX check)
 * stay out of `records`.
 */
export function dnsAnswerCacheTtl(records: readonly { ttl?: number }[], conclusive: boolean): number | undefined {
  if (!conclusive) return undefined;
  if (records.some((record) => record.ttl === 0)) return undefined;
  const ttls = records.flatMap((record) => (record.ttl === undefined ? [] : [record.ttl]));
  if (ttls.length === 0) return CACHE_TTL.dnsMaxMs;
  return Math.min(CACHE_TTL.dnsMaxMs, Math.min(...ttls) * 1000);
}

export interface LimitAcquire {
  limitClass: NetLimitClass;
  personId?: string;
  botId?: string;
}

export type LimitDecision =
  | { ok: true; release: () => void }
  | { ok: false; code: "limit.rate"; minutes: number }
  | { ok: false; code: "limit.busy" };

interface Bucket {
  key: string;
  windowMs: number;
  cap: number;
}

export class NetLimiter {
  private readonly limits: NetLimitConfig;
  private readonly now: () => number;
  private readonly stamps = new Map<string, number[]>();
  private running = 0;

  constructor(limits: NetLimitConfig = DEFAULT_NET_LIMITS, now: () => number = () => Date.now()) {
    this.limits = limits;
    this.now = now;
  }

  /** Stamps kept for one bucket, after dropping those outside the window. */
  count(key: string, windowMs: number): number {
    return this.prune(key, windowMs, this.now()).length;
  }

  tryAcquire(request: LimitAcquire): LimitDecision {
    const now = this.now();
    if (this.running >= this.limits.concurrent) return { ok: false, code: "limit.busy" };
    const buckets = this.buckets(request);
    let waitMs = 0;
    for (const bucket of buckets) {
      const kept = this.prune(bucket.key, bucket.windowMs, now);
      if (kept.length >= bucket.cap) {
        const oldest = kept[0] ?? now;
        waitMs = Math.max(waitMs, oldest + bucket.windowMs - now);
      }
    }
    if (waitMs > 0) return { ok: false, code: "limit.rate", minutes: Math.max(1, Math.ceil(waitMs / 60_000)) };
    for (const bucket of buckets) {
      const kept = this.prune(bucket.key, bucket.windowMs, now);
      kept.push(now);
      this.stamps.set(bucket.key, kept);
    }
    this.running += 1;
    let released = false;
    return {
      ok: true,
      release: () => {
        if (released) return;
        released = true;
        this.running = Math.max(0, this.running - 1);
      },
    };
  }

  private buckets(request: LimitAcquire): Bucket[] {
    const spec = this.limits[request.limitClass];
    const buckets: Bucket[] = [];
    if (request.personId) buckets.push({ key: `${request.limitClass}:person:${request.personId}`, windowMs: spec.windowMs, cap: spec.person });
    if (request.botId) buckets.push({ key: `${request.limitClass}:bot:${request.botId}`, windowMs: spec.windowMs, cap: spec.bot });
    if (request.limitClass === "port" && request.personId && spec.personDay && spec.dayMs) {
      buckets.push({ key: `port:day:${request.personId}`, windowMs: spec.dayMs, cap: spec.personDay });
    }
    return buckets;
  }

  private prune(key: string, windowMs: number, now: number): number[] {
    const kept = (this.stamps.get(key) ?? []).filter((stamp) => now - stamp < windowMs);
    if (kept.length === 0) this.stamps.delete(key);
    else this.stamps.set(key, kept);
    return kept;
  }
}

export class NetResultCache {
  private readonly entries = new Map<string, { result: NetCheckResult; expiresAt: number }>();

  get(key: string, now = Date.now()): NetCheckResult | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now) {
      this.entries.delete(key);
      return undefined;
    }
    const copy = structuredClone(entry.result);
    const age = Math.max(0, Math.floor((now - copy.at) / 60_000));
    const line = `checked ${age} min ago`;
    if (!copy.raw.split("\n").includes(line)) copy.raw = copy.raw ? `${copy.raw}\n${line}` : line;
    return copy;
  }

  set(key: string, result: NetCheckResult, ttlMs: number, now = Date.now()): void {
    if (ttlMs <= 0) return;
    this.entries.set(key, { result: structuredClone(result), expiresAt: now + ttlMs });
  }
}

let sharedLimiter = new NetLimiter();
let sharedCache = new NetResultCache();

export function sharedNetLimiter(): NetLimiter {
  return sharedLimiter;
}

export function resetSharedNetLimiter(): void {
  sharedLimiter = new NetLimiter();
}

export function sharedNetCache(): NetResultCache {
  return sharedCache;
}

export function resetSharedNetCache(): void {
  sharedCache = new NetResultCache();
}
