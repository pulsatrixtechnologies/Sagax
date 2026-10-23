import { describe, expect, it } from "vitest";

import type { NetCheckResult } from "../../shared/net-tools/types.ts";
import {
  CACHE_TTL,
  DEFAULT_NET_LIMITS,
  NetLimiter,
  NetResultCache,
  dnsAnswerCacheTtl,
  resetSharedNetCache,
  resetSharedNetLimiter,
  sharedNetCache,
  sharedNetLimiter,
} from "./limits.ts";

const DAY = 24 * 60 * 60_000;
const TEN = 10 * 60_000;

function sample(at = 0): NetCheckResult {
  return {
    check: "dns_lookup",
    target: "example.com",
    at,
    durationMs: 1,
    verdict: "pass",
    findings: [],
    details: [],
    raw: "hello",
    vantage: "server",
  };
}

describe("rate windows", () => {
  it("caps a person at 60 DNS checks and a bot at 120", () => {
    let now = 0;
    const limiter = new NetLimiter(DEFAULT_NET_LIMITS, () => now);
    for (let index = 0; index < 60; index += 1) {
      const decision = limiter.tryAcquire({ limitClass: "dns", personId: "person" });
      expect(decision.ok).toBe(true);
      if (decision.ok) decision.release();
    }
    const person = limiter.tryAcquire({ limitClass: "dns", personId: "person" });
    expect(person).toMatchObject({ ok: false, code: "limit.rate" });
    expect(limiter.count("dns:person:person", TEN)).toBe(60);

    for (let index = 0; index < 120; index += 1) {
      const decision = limiter.tryAcquire({ limitClass: "dns", botId: "bot" });
      expect(decision.ok).toBe(true);
      if (decision.ok) decision.release();
    }
    expect(limiter.tryAcquire({ limitClass: "dns", botId: "bot" })).toMatchObject({ ok: false, code: "limit.rate" });
    expect(limiter.count("dns:bot:bot", TEN)).toBe(120);
    now += TEN;
    expect(limiter.tryAcquire({ limitClass: "dns", personId: "person" }).ok).toBe(true);
  });

  it("stops at eight running checks and does not stamp a busy refusal", () => {
    const limiter = new NetLimiter();
    const releases: Array<() => void> = [];
    for (let index = 0; index < 8; index += 1) {
      const decision = limiter.tryAcquire({ limitClass: "dns" });
      expect(decision.ok).toBe(true);
      if (decision.ok) releases.push(decision.release);
    }
    expect(limiter.tryAcquire({ limitClass: "dns", personId: "person" })).toEqual({ ok: false, code: "limit.busy" });
    expect(limiter.count("dns:person:person", TEN)).toBe(0);
    releases[0]?.();
    const next = limiter.tryAcquire({ limitClass: "dns", personId: "person" });
    expect(next.ok).toBe(true);
    expect(limiter.count("dns:person:person", TEN)).toBe(1);
    if (next.ok) next.release();
  });

  it("keeps the port day cap after the short window has aged out", () => {
    expect(DEFAULT_NET_LIMITS.port.personDay).toBe(30);
    let now = 0;
    const limiter = new NetLimiter(DEFAULT_NET_LIMITS, () => now);
    for (let batch = 0; batch < 6; batch += 1) {
      for (let index = 0; index < 5; index += 1) {
        const decision = limiter.tryAcquire({ limitClass: "port", personId: "person" });
        expect(decision.ok).toBe(true);
        if (decision.ok) decision.release();
      }
      now += TEN;
    }
    expect(limiter.tryAcquire({ limitClass: "port", personId: "person" })).toMatchObject({ ok: false, code: "limit.rate" });
    expect(limiter.count(`port:day:person`, DAY)).toBe(30);
  });

  it("reports the wait in whole minutes and skips a bucket with no id", () => {
    let now = 0;
    const limiter = new NetLimiter({
      ...DEFAULT_NET_LIMITS,
      dns: { person: 1, bot: 1, windowMs: TEN },
    }, () => now);
    const first = limiter.tryAcquire({ limitClass: "dns", personId: "person" });
    expect(first.ok).toBe(true);
    if (first.ok) first.release();
    const second = limiter.tryAcquire({ limitClass: "dns", personId: "person" });
    expect(second).toEqual({ ok: false, code: "limit.rate", minutes: 10 });
    expect(limiter.tryAcquire({ limitClass: "dns" }).ok).toBe(true);
    expect(limiter.count("dns:person:person", TEN)).toBe(1);
  });

  it("releases a slot only once", () => {
    const limiter = new NetLimiter({ ...DEFAULT_NET_LIMITS, concurrent: 1 });
    const first = limiter.tryAcquire({ limitClass: "dns" });
    expect(first.ok).toBe(true);
    if (first.ok) {
      first.release();
      first.release();
    }
    expect(limiter.tryAcquire({ limitClass: "dns" }).ok).toBe(true);
  });
});

describe("result cache", () => {
  it("keeps the stored answer and appends how long ago it was checked", () => {
    const cache = new NetResultCache();
    const stored = sample(0);
    cache.set("dns", stored, 180_000, 0);
    stored.raw = "mutated";
    const first = cache.get("dns", 60_000);
    expect(first?.raw).toBe("hello\nchecked 1 min ago");
    expect(first?.at).toBe(0);
    if (first) first.raw = "changed";
    expect(cache.get("dns", 120_000)?.raw).toBe("hello\nchecked 2 min ago");
  });

  it("does not store a zero TTL, does not extend a read, and does not repeat the age line", () => {
    const cache = new NetResultCache();
    cache.set("zero", sample(), 0, 0);
    expect(cache.get("zero", 0)).toBeUndefined();
    cache.set("short", sample(0), 10_000, 0);
    expect(cache.get("short", 5_000)?.raw).toContain("checked 0 min ago");
    expect(cache.get("short", 10_000)).toBeUndefined();
    cache.set("already", { ...sample(0), raw: "checked 0 min ago" }, 60_000, 0);
    expect(cache.get("already", 0)?.raw).toBe("checked 0 min ago");
  });

  it("derives a DNS cache lifetime from the record TTLs", () => {
    expect(dnsAnswerCacheTtl([{ ttl: 0 }, { ttl: 30 }], true)).toBeUndefined();
    expect(dnsAnswerCacheTtl([{ ttl: 30 }, { ttl: 90 }, {}], true)).toBe(30_000);
    expect(dnsAnswerCacheTtl([{}], true)).toBe(CACHE_TTL.dnsMaxMs);
    expect(dnsAnswerCacheTtl([], true)).toBe(60_000);
    expect(dnsAnswerCacheTtl([{ ttl: 30 }], false)).toBeUndefined();
    expect(dnsAnswerCacheTtl([{ ttl: 120 }], true)).toBe(60_000);
  });

  it("replaces the shared limiter and cache", () => {
    const decision = sharedNetLimiter().tryAcquire({ limitClass: "dns", personId: "person" });
    expect(decision.ok).toBe(true);
    sharedNetCache().set("shared", sample(), 60_000, 0);
    resetSharedNetLimiter();
    resetSharedNetCache();
    expect(sharedNetLimiter().count("dns:person:person", TEN)).toBe(0);
    expect(sharedNetCache().get("shared", 0)).toBeUndefined();
    if (decision.ok) decision.release();
  });
});
