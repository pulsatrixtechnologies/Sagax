import { describe, expect, it } from "vitest";

import type { NetDnsType } from "../../../shared/net-tools/types.ts";
import { prepareDns, runDnsLookup } from "./dns.ts";
import type { DnsStatus, NetCheckContext, NetCheckOutcome } from "../model.ts";
import { FakeResolver, fakeAnswer, fakeRecord } from "../testing/fake-resolver.ts";

const DEFAULT_TYPES: NetDnsType[] = ["A", "AAAA", "CNAME", "TXT", "NS", "SOA", "CAA"];

function context(resolver: NetCheckContext["resolver"], ownNames?: readonly string[]): NetCheckContext {
  return { by: "person", resolver, signal: new AbortController().signal, deadlineMs: 20_000, ownNames };
}

function codes(outcome: NetCheckOutcome): string[] {
  return outcome.findings.map((finding) => finding.code);
}

async function lookup(
  input: { name: string; types?: NetDnsType[] },
  resolver: FakeResolver,
  ownNames?: readonly string[],
): Promise<{ ok: true; outcome: NetCheckOutcome; cacheKey: string } | { ok: false; outcome: NetCheckOutcome }> {
  const prepared = prepareDns(input, ownNames);
  if (!prepared.ok) return prepared;
  const outcome = await runDnsLookup(prepared.prepared, context(resolver, ownNames));
  return { ok: true, outcome, cacheKey: prepared.prepared.cacheKey };
}

function setStatus(resolver: FakeResolver, name: string, status: DnsStatus, types: readonly NetDnsType[] = DEFAULT_TYPES): void {
  for (const type of types) resolver.set(name, type, fakeAnswer(status));
}

describe("dns_lookup", () => {
  it("keeps a record, its TTL and a zone line", async () => {
    const resolver = new FakeResolver();
    resolver.set("example.com", "A", fakeAnswer("NOERROR", [fakeRecord("A", "1.2.3.4", { ttl: 300 })]));
    const result = await lookup({ name: "example.com", types: ["A"] }, resolver);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(codes(result.outcome)).toEqual(["dns.records_found"]);
    expect(result.outcome.findings[0]?.params).toEqual({ count: 1 });
    expect(result.outcome.raw).toBe("example.com. 300 IN A 1.2.3.4");
    expect(result.outcome.details).toEqual([{ label: "A", columns: ["value", "ttl"], rows: [["1.2.3.4", "300"]] }]);
    expect(result.outcome.cacheTtlMs).toBe(60_000);
  });

  it("reports no IPv6 address on a default lookup that only has A", async () => {
    const resolver = new FakeResolver();
    resolver.set("example.com", "A", fakeAnswer("NOERROR", [fakeRecord("A", "1.2.3.4")]));
    const result = await lookup({ name: "example.com" }, resolver);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(codes(result.outcome)).toEqual(["dns.records_found", "dns.no_aaaa"]);
    expect(result.cacheKey).toBe("dns:example.com:all:A,AAAA,CAA,CNAME,NS,SOA,TXT");
  });

  it("uses a different cache key when the types were asked for", () => {
    const prepared = prepareDns({ name: "example.com", types: ["TXT", "A"] });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.prepared.cacheKey).toBe("dns:example.com:ask:A,TXT");
  });

  it("treats a name that does not exist as nxdomain", async () => {
    const resolver = new FakeResolver();
    resolver.nxdomain("missing.example");
    const result = await lookup({ name: "missing.example" }, resolver);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(codes(result.outcome)).toEqual(["dns.nxdomain"]);
    expect(result.outcome.findings[0]?.params).toEqual({ name: "missing.example" });
    expect(result.outcome.raw).toBe(";; status: NXDOMAIN");
    expect(result.outcome.cacheTtlMs).toBe(60_000);
  });

  it("names each empty type the caller asked for", async () => {
    const resolver = new FakeResolver();
    const result = await lookup({ name: "example.com", types: ["TXT"] }, resolver);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.findings).toEqual([{ code: "dns.no_records", severity: "info", params: { type: "TXT" } }]);
    expect(result.outcome.raw).not.toContain("NOERROR, no records");
  });

  it("stays quiet when a default lookup finds nothing", async () => {
    const result = await lookup({ name: "example.com" }, new FakeResolver());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.findings).toEqual([]);
    expect(result.outcome.raw).toBe(";; NOERROR, no records");
    expect(result.outcome.cacheTtlMs).toBe(60_000);
  });

  it("flags a CNAME beside an SOA at the same name", async () => {
    const resolver = new FakeResolver();
    resolver.set("example.com", "CNAME", fakeAnswer("NOERROR", [fakeRecord("CNAME", "other.example.net")]));
    resolver.set("example.com", "SOA", fakeAnswer("NOERROR", [fakeRecord("SOA", "ns.example.net. hostmaster.example.net. 1 7200 3600 1209600 86400")]));
    const result = await lookup({ name: "example.com", types: ["CNAME", "SOA"] }, resolver);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(codes(result.outcome)).toEqual(["dns.records_found", "dns.cname_at_apex"]);
    expect(result.outcome.findings[1]?.severity).toBe("fail");
  });

  it("probes SOA when a CNAME was seen and SOA was not asked for, without tabulating the probe", async () => {
    const resolver = new FakeResolver();
    resolver.set("example.com", "CNAME", fakeAnswer("NOERROR", [fakeRecord("CNAME", "other.example.net")]));
    const result = await lookup({ name: "example.com", types: ["CNAME"] }, resolver);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(resolver.calls.some((call) => call.type === "SOA")).toBe(true);
    expect(result.outcome.details.map((table) => table.label)).toEqual(["CNAME"]);
    expect(codes(result.outcome)).not.toContain("dns.cname_at_apex");
  });

  it("skips the missing IPv6 note unless AAAA and CNAME were both empty", async () => {
    const withAddress = new FakeResolver();
    withAddress.set("example.com", "A", fakeAnswer("NOERROR", [fakeRecord("A", "1.2.3.4")]));
    const skipped = await lookup({ name: "example.com", types: ["A", "AAAA"] }, withAddress);
    expect(skipped.ok && codes(skipped.outcome)).not.toContain("dns.no_aaaa");

    const aliased = new FakeResolver();
    aliased.set("example.com", "A", fakeAnswer("NOERROR", [fakeRecord("A", "1.2.3.4")]));
    aliased.set("example.com", "CNAME", fakeAnswer("NOERROR", [fakeRecord("CNAME", "other.example.net")]));
    const alias = await lookup({ name: "example.com", types: ["A", "AAAA", "CNAME"] }, aliased);
    expect(alias.ok && codes(alias.outcome)).not.toContain("dns.no_aaaa");

    const failed = new FakeResolver();
    failed.set("example.com", "A", fakeAnswer("NOERROR", [fakeRecord("A", "1.2.3.4")]));
    failed.set("example.com", "AAAA", fakeAnswer("SERVFAIL"));
    const servfail = await lookup({ name: "example.com", types: ["A", "AAAA", "CNAME"] }, failed);
    expect(servfail.ok && codes(servfail.outcome)).not.toContain("dns.no_aaaa");
    if (servfail.ok) expect(servfail.outcome.raw).toContain(";; AAAA SERVFAIL");
  });

  it("reports an empty asked-for AAAA together with the missing IPv6 note", async () => {
    const resolver = new FakeResolver();
    resolver.set("example.com", "A", fakeAnswer("NOERROR", [fakeRecord("A", "1.2.3.4")]));
    const result = await lookup({ name: "example.com", types: ["A", "AAAA", "CNAME"] }, resolver);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(codes(result.outcome)).toEqual(["dns.records_found", "dns.no_records", "dns.no_records", "dns.no_aaaa"]);
    expect(result.outcome.findings.filter((finding) => finding.code === "dns.no_records").map((finding) => finding.params)).toEqual([
      { type: "AAAA" },
      { type: "CNAME" },
    ]);
  });

  it("warns when a name server has no address", async () => {
    const resolver = new FakeResolver();
    resolver.set("example.com", "NS", fakeAnswer("NOERROR", [fakeRecord("NS", "ns1.example.net")]));
    const result = await lookup({ name: "example.com", types: ["NS"] }, resolver);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.findings).toContainEqual({ code: "dns.lame_ns", severity: "warn", params: { ns: "ns1.example.net" } });
  });

  it("warns when the name server's own answer is a failure", async () => {
    const resolver = new FakeResolver();
    resolver.set("example.com", "NS", fakeAnswer("NOERROR", [fakeRecord("NS", "ns1.example.net")]));
    resolver.set("ns1.example.net", "A", fakeAnswer("NOERROR", [fakeRecord("A", "1.2.3.4")]));
    resolver.setAt("1.2.3.4", "example.com", "SOA", fakeAnswer("SERVFAIL"));
    const result = await lookup({ name: "example.com", types: ["NS"] }, resolver);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(codes(result.outcome)).toContain("dns.lame_ns");
  });

  it("does not call a name server whose address is not public", async () => {
    const resolver = new FakeResolver();
    resolver.set("example.com", "NS", fakeAnswer("NOERROR", [fakeRecord("NS", "ns1.example.net")]));
    resolver.set("ns1.example.net", "A", fakeAnswer("NOERROR", [fakeRecord("A", "10.1.2.3")]));
    const result = await lookup({ name: "example.com", types: ["NS"] }, resolver);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(codes(result.outcome)).not.toContain("dns.lame_ns");
    expect(result.outcome.raw).toContain(";; ns1.example.net was not queried directly: its address is not public");
    expect(resolver.calls.some((call) => call.server)).toBe(false);
  });

  it("keeps a name server that answers SOA from a later address", async () => {
    const resolver = new FakeResolver();
    resolver.set("example.com", "NS", fakeAnswer("NOERROR", [fakeRecord("NS", "ns1.example.net")]));
    resolver.set("ns1.example.net", "A", fakeAnswer("NOERROR", [
      fakeRecord("A", "1.2.3.4"),
      fakeRecord("A", "1.2.3.5"),
    ]));
    resolver.setAt("1.2.3.4", "example.com", "SOA", fakeAnswer("NODATA"));
    resolver.setAt("1.2.3.5", "example.com", "SOA", fakeAnswer("NOERROR", [
      fakeRecord("SOA", "ns1.example.net. hostmaster.example.net. 100 7200 3600 1209600 86400"),
    ]));
    const result = await lookup({ name: "example.com", types: ["NS"] }, resolver);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(codes(result.outcome)).not.toContain("dns.lame_ns");
  });

  it("does not mark a name server lame when every direct query stayed on this server", async () => {
    const resolver = new FakeResolver();
    resolver.set("example.com", "NS", fakeAnswer("NOERROR", [fakeRecord("NS", "ns1.example.net")]));
    resolver.set("ns1.example.net", "A", fakeAnswer("NOERROR", [fakeRecord("A", "1.2.3.4")]));
    resolver.setAt("1.2.3.4", "example.com", "SOA", fakeAnswer("TIMEOUT"));
    const result = await lookup({ name: "example.com", types: ["NS"] }, resolver);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(codes(result.outcome)).not.toContain("dns.lame_ns");
    expect(result.outcome.raw).toContain(";; authoritative queries did not leave this server");
  });

  it("still marks a name server with no address when another query did not leave", async () => {
    const resolver = new FakeResolver();
    resolver.set("example.com", "NS", fakeAnswer("NOERROR", [
      fakeRecord("NS", "ns-empty.example.net"),
      fakeRecord("NS", "ns-down.example.net"),
    ]));
    resolver.set("ns-down.example.net", "A", fakeAnswer("NOERROR", [fakeRecord("A", "1.2.3.4")]));
    resolver.setAt("1.2.3.4", "example.com", "SOA", fakeAnswer("NO_EGRESS"));
    const result = await lookup({ name: "example.com", types: ["NS"] }, resolver);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.findings).toContainEqual({ code: "dns.lame_ns", severity: "warn", params: { ns: "ns-empty.example.net" } });
    expect(codes(result.outcome).filter((code) => code === "dns.lame_ns")).toEqual(["dns.lame_ns"]);
    expect(result.outcome.raw.split("\n").filter((line) => line.includes("did not leave this server"))).toHaveLength(1);
  });

  it("warns when two name servers report different SOA serials", async () => {
    const resolver = new FakeResolver();
    resolver.set("example.com", "NS", fakeAnswer("NOERROR", [
      fakeRecord("NS", "ns1.example.net"),
      fakeRecord("NS", "ns2.example.net"),
    ]));
    resolver.set("ns1.example.net", "A", fakeAnswer("NOERROR", [fakeRecord("A", "1.2.3.4")]));
    resolver.set("ns2.example.net", "A", fakeAnswer("NOERROR", [fakeRecord("A", "1.2.3.5")]));
    resolver.setAt("1.2.3.4", "example.com", "SOA", fakeAnswer("NOERROR", [
      fakeRecord("SOA", "ns1.example.net. hostmaster.example.net. 1 7200 3600 1209600 86400"),
    ]));
    resolver.setAt("1.2.3.5", "example.com", "SOA", fakeAnswer("NOERROR", [
      fakeRecord("SOA", "ns2.example.net. hostmaster.example.net. 2 7200 3600 1209600 86400"),
    ]));
    const result = await lookup({ name: "example.com", types: ["NS"] }, resolver);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.findings).toContainEqual({ code: "dns.soa_serial_mismatch", severity: "warn" });
  });

  it("does not query a refused name server and does not call it lame", async () => {
    const resolver = new FakeResolver();
    resolver.set("example.com", "NS", fakeAnswer("NOERROR", [fakeRecord("NS", "localhost")]));
    const result = await lookup({ name: "example.com", types: ["NS"] }, resolver);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(codes(result.outcome)).not.toContain("dns.lame_ns");
    expect(result.outcome.raw).toContain(";; localhost was not queried: refused name");
    expect(resolver.calls.some((call) => call.name === "localhost")).toBe(false);
  });

  it("says authoritative servers were not queried when the resolver cannot ask them, even with no NS records", async () => {
    const inner = new FakeResolver();
    const result = await lookup({ name: "example.com", types: ["NS"] }, inner);
    const bare = await runDnsLookup(
      { target: "example.com", cacheKey: "dns:example.com:ask:NS", explicit: true, types: ["NS"], ip: false },
      context({ query: (name, type, signal) => inner.query(name, type, signal) }),
    );
    expect(result.ok).toBe(true);
    expect(bare.raw).toContain(";; authoritative name servers were not queried directly");
  });

  it("refuses localhost and a name this server owns before any query", () => {
    const local = prepareDns({ name: "localhost" });
    const owned = prepareDns({ name: "sagax.example" }, ["sagax.example"]);
    expect(local.ok).toBe(false);
    expect(owned.ok).toBe(false);
    if (!local.ok) expect(local.outcome.findings[0]?.code).toBe("target.refused_name");
    if (!owned.ok) expect(owned.outcome.findings[0]?.code).toBe("target.refused_name");
  });

  it("reports a missing and a present pointer for an address", async () => {
    const missing = await lookup({ name: "1.2.3.4" }, new FakeResolver());
    expect(missing.ok).toBe(true);
    if (missing.ok) {
      expect(missing.outcome.findings).toEqual([{ code: "dns.ptr_missing", severity: "info", params: { ip: "1.2.3.4" } }]);
      expect(missing.outcome.raw).toBe(";; status: NODATA");
      expect(missing.cacheKey).toBe("dns:1.2.3.4:all:PTR");
    }
    const resolver = new FakeResolver();
    resolver.set("1.2.3.4", "PTR", fakeAnswer("NOERROR", [fakeRecord("PTR", "mail.example.com")]));
    const found = await lookup({ name: "1.2.3.4" }, resolver);
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(codes(found.outcome)).toEqual(["dns.records_found"]);
    expect(found.outcome.raw).toBe("example.com. IN PTR mail.example.com.".replace("example.com.", "1.2.3.4."));
  });

  it("rejects an address asked for A, a name asked for PTR, an empty type list, and accepts a service label", () => {
    const address = prepareDns({ name: "1.2.3.4", types: ["A"] });
    const pointer = prepareDns({ name: "example.com", types: ["PTR"] });
    const empty = prepareDns({ name: "example.com", types: [] });
    const service = prepareDns({ name: "_dmarc.example.com", types: ["TXT"] });
    expect(address.ok || address.outcome.findings[0]?.code).toBe("target.invalid");
    expect(pointer.ok || pointer.outcome.findings[0]?.code).toBe("target.invalid");
    expect(empty.ok || empty.outcome.findings[0]?.code).toBe("target.invalid");
    expect(service.ok).toBe(true);
    if (service.ok) expect(service.prepared.target).toBe("_dmarc.example.com");
  });

  it("turns a total timeout, a total egress failure and a total server failure into one finding", async () => {
    const timeout = new FakeResolver();
    setStatus(timeout, "example.com", "TIMEOUT");
    const timed = await lookup({ name: "example.com" }, timeout);
    expect(timed.ok && timed.outcome.findings).toEqual([{ code: "check.timeout", severity: "unknown", params: { seconds: 20 } }]);

    const egress = new FakeResolver();
    setStatus(egress, "example.com", "NO_EGRESS");
    const stuck = await lookup({ name: "example.com" }, egress);
    expect(stuck.ok && codes(stuck.outcome)).toEqual(["check.no_egress"]);

    const failed = new FakeResolver();
    setStatus(failed, "example.com", "SERVFAIL");
    const servfail = await lookup({ name: "example.com" }, failed);
    expect(servfail.ok && codes(servfail.outcome)).toEqual(["check.error"]);
    if (servfail.ok) expect(servfail.outcome.raw).toContain(";; status: SERVFAIL");

    const mixed = new FakeResolver();
    setStatus(mixed, "example.com", "TIMEOUT", ["A"]);
    setStatus(mixed, "example.com", "SERVFAIL", ["AAAA", "CNAME", "TXT", "NS", "SOA", "CAA"]);
    const blend = await lookup({ name: "example.com" }, mixed);
    expect(blend.ok && codes(blend.outcome)).toEqual(["check.error"]);
  });

  it("notes a type that failed beside one that answered", async () => {
    const resolver = new FakeResolver();
    resolver.set("example.com", "A", fakeAnswer("NOERROR", [fakeRecord("A", "1.2.3.4")]));
    resolver.set("example.com", "TXT", fakeAnswer("SERVFAIL"));
    const result = await lookup({ name: "example.com", types: ["A", "TXT"] }, resolver);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(codes(result.outcome)).toEqual(["dns.records_found"]);
    expect(result.outcome.raw).toContain(";; TXT SERVFAIL");
  });

  it("caches for the shortest TTL and skips a zero TTL", async () => {
    const resolver = new FakeResolver();
    resolver.set("example.com", "A", fakeAnswer("NOERROR", [fakeRecord("A", "1.2.3.4", { ttl: 30 })]));
    resolver.set("example.com", "TXT", fakeAnswer("NOERROR", [fakeRecord("TXT", "v=spf1", { ttl: 90 })]));
    const kept = await lookup({ name: "example.com", types: ["A", "TXT"] }, resolver);
    expect(kept.ok && kept.outcome.cacheTtlMs).toBe(30_000);

    const zero = new FakeResolver();
    zero.set("example.com", "A", fakeAnswer("NOERROR", [fakeRecord("A", "1.2.3.4", { ttl: 0 })]));
    const dropped = await lookup({ name: "example.com", types: ["A"] }, zero);
    expect(dropped.ok && dropped.outcome.cacheTtlMs).toBeUndefined();
  });

  it("notes a DNS-over-HTTPS answer and a validated signature", async () => {
    const resolver = new FakeResolver();
    resolver.set("example.com", "A", fakeAnswer("NOERROR", [fakeRecord("A", "1.2.3.4")], { via: "doh", authenticated: true }));
    const result = await lookup({ name: "example.com", types: ["A"] }, resolver);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.raw).toContain(";; via doh");
    expect(codes(result.outcome)).toContain("dns.dnssec_validated");

    const gone = new FakeResolver();
    for (const type of DEFAULT_TYPES) gone.set("missing.example", type, fakeAnswer("NXDOMAIN", [], { authenticated: type === "A" }));
    const nx = await lookup({ name: "missing.example" }, gone);
    expect(nx.ok && codes(nx.outcome)).toEqual(["dns.nxdomain", "dns.dnssec_validated"]);

    const aliased = new FakeResolver();
    aliased.set("example.com", "CNAME", fakeAnswer("NOERROR", [fakeRecord("CNAME", "other.example.net")]));
    aliased.set("example.com", "SOA", fakeAnswer("NODATA", [], { authenticated: true }));
    const probe = await lookup({ name: "example.com", types: ["CNAME"] }, aliased);
    expect(probe.ok && codes(probe.outcome)).toContain("dns.dnssec_validated");
  });
});
