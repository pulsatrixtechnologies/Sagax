import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { NET_RESULT_LIMITS } from "../../shared/net-tools/types.ts";
import { DEFAULT_NET_LIMITS, NetLimiter, NetResultCache } from "./limits.ts";
import { buildResult, listRegisteredChecks, runNetCheck, runWithinDeadline } from "./run.ts";
import { FakeResolver, fakeAnswer, fakeRecord } from "./testing/fake-resolver.ts";

function limiter(person: number, concurrent = 8, now: () => number = () => 0): NetLimiter {
  return new NetLimiter({
    ...DEFAULT_NET_LIMITS,
    dns: { person, bot: 120, windowMs: 600_000 },
    concurrent,
  }, now);
}

function count(gate: NetLimiter): number {
  return gate.count("dns:person:p", 600_000);
}

describe("runNetCheck", () => {
  it("reuses a fresh answer for the same name and does not spend another slot", async () => {
    let now = 1_000_000;
    const gate = limiter(10, 8, () => now);
    const cache = new NetResultCache();
    const resolver = new FakeResolver();
    const first = await runNetCheck("dns_lookup", { name: "example.com" }, {
      by: "person",
      personId: "p",
      resolver,
      limiter: gate,
      cache,
      now: () => now,
    });
    expect(first.verdict).toBe("unknown");
    expect(count(gate)).toBe(1);
    now += 30_000;
    const again = await runNetCheck("dns_lookup", { name: "Example.COM" }, {
      by: "person",
      personId: "p",
      resolver,
      limiter: gate,
      cache,
      now: () => now,
    });
    expect(again.at).toBe(first.at);
    expect(again.raw).toContain("checked 0 min ago");
    expect(count(gate)).toBe(1);

    const asked = await runNetCheck("dns_lookup", { name: "example.com", types: ["A"] }, {
      by: "person",
      personId: "p",
      resolver,
      limiter: gate,
      cache,
      now: () => now,
    });
    expect(asked.at).toBe(now);
    expect(count(gate)).toBe(2);
  });

  it("stops after the person's window and does not stamp a busy server", async () => {
    const gate = limiter(2);
    const cache = new NetResultCache();
    const resolver = new FakeResolver();
    for (let i = 0; i < 2; i += 1) {
      const result = await runNetCheck("dns_lookup", { name: `n${i}.example.com`, types: ["A"] }, {
        by: "person",
        personId: "p",
        resolver,
        limiter: gate,
        cache,
      });
      expect(result.findings[0]?.code).not.toBe("limit.rate");
    }
    const limited = await runNetCheck("dns_lookup", { name: "n3.example.com", types: ["A"] }, {
      by: "person",
      personId: "p",
      resolver,
      limiter: gate,
      cache,
    });
    expect(limited.findings[0]).toMatchObject({ code: "limit.rate", params: { minutes: 10 } });
    expect(count(gate)).toBe(2);

    let release = (): void => {};
    const held = new FakeResolver();
    held.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const busyGate = limiter(10, 1);
    const first = runNetCheck("dns_lookup", { name: "held.example.com", types: ["A"] }, {
      by: "person",
      personId: "p",
      resolver: held,
      limiter: busyGate,
      cache: new NetResultCache(),
    });
    for (let i = 0; i < 50 && held.calls.length === 0; i += 1) await new Promise((done) => setTimeout(done, 10));
    const second = await runNetCheck("dns_lookup", { name: "other.example.com", types: ["A"] }, {
      by: "person",
      personId: "p",
      resolver: held,
      limiter: busyGate,
      cache: new NetResultCache(),
    });
    expect(second.findings[0]?.code).toBe("limit.busy");
    expect(busyGate.count("dns:person:p", 600_000)).toBe(1);
    release();
    await first;
  });

  it("does not spend a slot on a bad name, an unknown check, a shape error or a refused name", async () => {
    const gate = limiter(2);
    const cache = new NetResultCache();
    const resolver = new FakeResolver();
    const options = { by: "person" as const, personId: "p", resolver, limiter: gate, cache };
    const garbage = await runNetCheck("not-a-check", { name: "example.com" }, options);
    expect(garbage.check).toBe("dns_lookup");
    expect(garbage.findings[0]?.code).toBe("target.invalid");
    const missing = await runNetCheck("mail_auth_check", { domain: "example.com" }, options);
    expect(missing.check).toBe("mail_auth_check");
    expect(missing.raw).toContain("mail_auth_check is not available");
    expect(missing.findings[0]?.code).toBe("check.error");
    const extra = await runNetCheck("dns_lookup", { name: "example.com", extra: true }, options);
    const empty = await runNetCheck("dns_lookup", { name: "example.com", types: [] }, options);
    const refused = await runNetCheck("dns_lookup", { name: "localhost" }, options);
    expect([extra, empty, refused].map((result) => result.findings[0]?.code)).toEqual([
      "target.invalid",
      "target.invalid",
      "target.refused_name",
    ]);
    expect(count(gate)).toBe(0);
  });

  it("times out a query that never answers", async () => {
    const resolver = new FakeResolver();
    resolver.hang = true;
    const started = Date.now();
    const result = await runNetCheck("dns_lookup", { name: "example.com", types: ["A"] }, {
      by: "person",
      resolver,
      limiter: limiter(10),
      cache: new NetResultCache(),
      deadlineMs: 200,
    });
    expect(result.findings[0]).toEqual({ code: "check.timeout", severity: "unknown", params: { seconds: 1 } });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("releases the slot when the default resolver is not injected", async () => {
    const gate = limiter(10, 1);
    await expect(runNetCheck("dns_lookup", { name: "example.com" }, {
      by: "person",
      personId: "p",
      limiter: gate,
      cache: new NetResultCache(),
    })).rejects.toThrow("net resolver tests must inject the node port");
    const result = await runNetCheck("dns_lookup", { name: "example.com", types: ["A"] }, {
      by: "person",
      personId: "p",
      resolver: new FakeResolver(),
      limiter: gate,
      cache: new NetResultCache(),
    });
    expect(result.findings[0]?.code).not.toBe("limit.busy");
  });

  it("lists only the two checks this batch runs", () => {
    expect(listRegisteredChecks()).toEqual(["dns_lookup", "mx_lookup"]);
  });

  it("turns a thrown check into an error and caps what is stored", async () => {
    const thrown = await runWithinDeadline("example.com", 1_000, async () => {
      throw new Error("boom");
    });
    expect(thrown.findings[0]?.code).toBe("check.error");

    const rows = Array.from({ length: 61 }, (_, index) => ["y".repeat(300), String(index)]);
    const links = [
      { label: "plain", url: "http://example.com/a" },
      ...Array.from({ length: 7 }, (_, index) => ({ label: String(index), url: `https://example.com/${index}` })),
    ];
    const result = buildResult("dns_lookup", {
      target: "example.com",
      findings: [
        { code: "dns.records_found", severity: "pass", params: { count: 1 } },
        { code: "dns.cname_at_apex", severity: "fail" },
      ],
      details: [{ label: "A", columns: ["value", "ttl"], rows }],
      raw: "x".repeat(NET_RESULT_LIMITS.raw + 100),
      links,
    }, 5, 12);
    expect(result.raw).toHaveLength(NET_RESULT_LIMITS.raw);
    expect(result.details[0]?.rows).toHaveLength(NET_RESULT_LIMITS.tableRows);
    expect(result.details[0]?.rows[0]?.[0]).toHaveLength(NET_RESULT_LIMITS.cell);
    expect(result.links).toHaveLength(NET_RESULT_LIMITS.links);
    expect(result.links?.every((link) => link.url.startsWith("https://"))).toBe(true);
    expect(result.findings.map((finding) => finding.code)).toEqual(["dns.cname_at_apex", "dns.records_found"]);
    expect(result.verdict).toBe("fail");
    expect(result.vantage).toBe("server");
    expect(result.durationMs).toBe(12);

    const bare = buildResult("mx_lookup", {
      target: "example.org",
      findings: [],
      details: [],
      raw: "",
    }, 1, 0);
    expect(bare).not.toHaveProperty("links");
  });

  it("sorts a live answer so a failure comes before a pass", async () => {
    const resolver = new FakeResolver();
    resolver.set("example.com", "CNAME", fakeAnswer("NOERROR", [fakeRecord("CNAME", "other.example.net")]));
    resolver.set("example.com", "SOA", fakeAnswer("NOERROR", [fakeRecord("SOA", "ns.example.net. hostmaster.example.net. 1 7200 3600 1209600 86400")]));
    const result = await runNetCheck("dns_lookup", { name: "example.com", types: ["CNAME", "SOA"] }, {
      by: "person",
      resolver,
      limiter: limiter(10),
      cache: new NetResultCache(),
    });
    expect(result.findings.map((finding) => finding.severity)).toEqual(["fail", "pass"]);
    expect(result.verdict).toBe("fail");
  });

  it("is not mounted on the server", () => {
    const source = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
    expect(source).not.toContain("net-tools");
    expect(source).not.toContain("features.netTools");
  });
});
