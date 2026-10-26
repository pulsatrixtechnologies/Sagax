import { describe, expect, it } from "vitest";

import { prepareMx, runMxLookup } from "./mx.ts";
import type { NetCheckContext, NetCheckOutcome } from "../model.ts";
import { FakeResolver, fakeAnswer, fakeRecord } from "../testing/fake-resolver.ts";

function context(resolver: FakeResolver): NetCheckContext {
  return { by: "person", resolver, signal: new AbortController().signal, deadlineMs: 20_000 };
}

function codes(outcome: NetCheckOutcome): string[] {
  return outcome.findings.map((finding) => finding.code);
}

async function mail(domain: string, resolver: FakeResolver): Promise<{ ok: true; outcome: NetCheckOutcome } | { ok: false; outcome: NetCheckOutcome }> {
  const prepared = prepareMx({ domain });
  if (!prepared.ok) return prepared;
  return { ok: true, outcome: await runMxLookup(prepared.prepared, context(resolver)) };
}

function host(name: string, address: string, resolver: FakeResolver, ttl = 90): void {
  resolver.set(name, "A", fakeAnswer("NOERROR", [fakeRecord("A", address, { ttl })]));
  resolver.set(address, "PTR", fakeAnswer("NOERROR", [fakeRecord("PTR", name, { ttl: 1 })]));
}

describe("mx_lookup", () => {
  it("confirms two mail hosts and ignores pointer TTLs in the cache", async () => {
    const resolver = new FakeResolver();
    resolver.set("example.org", "MX", fakeAnswer("NOERROR", [
      fakeRecord("MX", "mx2.example.org", { priority: 20, ttl: 30 }),
      fakeRecord("MX", "mx1.example.org", { priority: 10, ttl: 30 }),
    ]));
    host("mx1.example.org", "1.2.3.4", resolver);
    host("mx2.example.org", "1.2.3.5", resolver);
    const result = await mail("example.org", resolver);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.findings).toEqual([{ code: "mx.ok", severity: "pass", params: { count: 2 } }]);
    expect(result.outcome.details[0]?.rows).toEqual([
      ["10", "mx1.example.org", "1.2.3.4", "mx1.example.org"],
      ["20", "mx2.example.org", "1.2.3.5", "mx2.example.org"],
    ]);
    expect(result.outcome.cacheTtlMs).toBe(30_000);
  });

  it("shows one null-MX row even when the answer repeats it", async () => {
    const resolver = new FakeResolver();
    resolver.set("example.net", "MX", fakeAnswer("NOERROR", [
      fakeRecord("MX", ".", { priority: 0 }),
      fakeRecord("MX", ".", { priority: 0 }),
    ]));
    const result = await mail("example.net", resolver);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.findings).toEqual([{ code: "mx.null", severity: "info" }]);
    expect(result.outcome.details).toEqual([{ label: "mx_hosts", columns: ["priority", "host"], rows: [["0", "."]] }]);
    expect(result.outcome.raw).toContain("IN MX 0 .");
    expect(resolver.calls.map((call) => call.type)).toEqual(["MX"]);
  });

  it("ignores a null record that sits beside a real host", async () => {
    const resolver = new FakeResolver();
    resolver.set("example.org", "MX", fakeAnswer("NOERROR", [
      fakeRecord("MX", ".", { priority: 0 }),
      fakeRecord("MX", "mx1.example.org", { priority: 10 }),
    ]));
    host("mx1.example.org", "1.2.3.4", resolver);
    const result = await mail("example.org", resolver);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.raw).toContain(";; ignored null MX beside real hosts");
    expect(result.outcome.details[0]?.rows.map((row) => row[1])).toEqual(["mx1.example.org"]);
    expect(codes(result.outcome)).toEqual(["mx.single", "mx.ok"]);
  });

  it("fails a domain with no MX and does not fall back to an address", async () => {
    const resolver = new FakeResolver();
    resolver.set("example.org", "A", fakeAnswer("NOERROR", [fakeRecord("A", "1.2.3.4")]));
    const result = await mail("example.org", resolver);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.findings).toEqual([{ code: "mx.none", severity: "fail" }]);
    expect(result.outcome.raw).toBe("");
    expect(result.outcome.cacheTtlMs).toBe(60_000);
    expect(resolver.calls.map((call) => call.type)).toEqual(["MX"]);
  });

  it("reports a missing domain as nxdomain", async () => {
    const resolver = new FakeResolver();
    resolver.nxdomain("missing.example");
    const result = await mail("missing.example", resolver);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(codes(result.outcome)).toEqual(["dns.nxdomain"]);
    expect(result.outcome.raw).toBe(";; status: NXDOMAIN");
  });

  it("does not resolve an address written as the mail host", async () => {
    const resolver = new FakeResolver();
    resolver.set("example.org", "MX", fakeAnswer("NOERROR", [
      fakeRecord("MX", "192.0.2.10", { priority: 10 }),
      fakeRecord("MX", "2001:db8::1", { priority: 20 }),
    ]));
    const result = await mail("example.org", resolver);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.findings.map((finding) => finding.params)).toEqual([{ host: "192.0.2.10" }, { host: "2001:db8::1" }]);
    expect(codes(result.outcome)).toEqual(["mx.ip_literal", "mx.ip_literal"]);
    expect(resolver.calls.map((call) => call.type)).toEqual(["MX"]);
    expect(codes(result.outcome)).not.toContain("mx.ok");
  });

  it("follows one CNAME and does not ask the alias for an address", async () => {
    const resolver = new FakeResolver();
    resolver.set("example.org", "MX", fakeAnswer("NOERROR", [fakeRecord("MX", "mail.example.org", { priority: 10 })]));
    resolver.set("mail.example.org", "CNAME", fakeAnswer("NOERROR", [fakeRecord("CNAME", "canonical.example.org")]));
    host("canonical.example.org", "1.2.3.4", resolver);
    const result = await mail("example.org", resolver);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(codes(result.outcome)).toContain("mx.cname");
    expect(resolver.calls.some((call) => call.name === "mail.example.org" && call.type === "A")).toBe(false);
    expect(resolver.calls.some((call) => call.name === "canonical.example.org" && call.type === "A")).toBe(true);
  });

  it("does not query a canonical name this server refuses", async () => {
    const resolver = new FakeResolver();
    resolver.set("example.org", "MX", fakeAnswer("NOERROR", [fakeRecord("MX", "mail.example.org", { priority: 10 })]));
    resolver.set("mail.example.org", "CNAME", fakeAnswer("NOERROR", [fakeRecord("CNAME", "localhost")]));
    const result = await mail("example.org", resolver);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(codes(result.outcome)).toEqual(["mx.cname", "mx.host_no_address"]);
    expect(resolver.calls.some((call) => call.name === "localhost")).toBe(false);
  });

  it("fails a mail host with no address", async () => {
    const resolver = new FakeResolver();
    resolver.set("example.org", "MX", fakeAnswer("NOERROR", [fakeRecord("MX", "mx1.example.org", { priority: 10 })]));
    const result = await mail("example.org", resolver);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.findings).toEqual([{ code: "mx.host_no_address", severity: "fail", params: { host: "mx1.example.org" } }]);
  });

  it("does not query a refused mail host", async () => {
    const resolver = new FakeResolver();
    resolver.set("example.org", "MX", fakeAnswer("NOERROR", [fakeRecord("MX", "mail.internal", { priority: 10 })]));
    const result = await mail("example.org", resolver);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.findings).toContainEqual({ code: "mx.host_no_address", severity: "fail", params: { host: "mail.internal" } });
    expect(result.outcome.raw).toContain(";; MX host mail.internal was not queried");
    expect(resolver.calls.some((call) => call.name === "mail.internal")).toBe(false);
  });

  it("warns when a mail address has no pointer", async () => {
    const resolver = new FakeResolver();
    resolver.set("example.org", "MX", fakeAnswer("NOERROR", [fakeRecord("MX", "mx1.example.org", { priority: 10 })]));
    resolver.set("mx1.example.org", "A", fakeAnswer("NOERROR", [fakeRecord("A", "1.2.3.4")]));
    const result = await mail("example.org", resolver);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.findings).toContainEqual({ code: "mx.ptr_missing", severity: "warn", params: { ip: "1.2.3.4" } });
    expect(codes(result.outcome)).toEqual(["mx.ptr_missing", "mx.single", "mx.ok"]);
  });

  it("warns when none of the pointer names resolve back to the address", async () => {
    const resolver = new FakeResolver();
    resolver.set("example.org", "MX", fakeAnswer("NOERROR", [fakeRecord("MX", "mx1.example.org", { priority: 10 })]));
    resolver.set("mx1.example.org", "A", fakeAnswer("NOERROR", [fakeRecord("A", "1.2.3.4")]));
    resolver.set("1.2.3.4", "PTR", fakeAnswer("NOERROR", [fakeRecord("PTR", "other.example.net")]));
    resolver.set("other.example.net", "A", fakeAnswer("NOERROR", [fakeRecord("A", "9.9.9.9")]));
    const result = await mail("example.org", resolver);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.findings).toContainEqual({
      code: "mx.ptr_not_confirmed",
      severity: "warn",
      params: { ip: "1.2.3.4", ptr: "other.example.net" },
    });
  });

  it("accepts one confirming name among several pointers", async () => {
    const resolver = new FakeResolver();
    resolver.set("example.org", "MX", fakeAnswer("NOERROR", [fakeRecord("MX", "mx1.example.org", { priority: 10 })]));
    resolver.set("mx1.example.org", "A", fakeAnswer("NOERROR", [fakeRecord("A", "1.2.3.4")]));
    resolver.set("1.2.3.4", "PTR", fakeAnswer("NOERROR", [
      fakeRecord("PTR", "bad.example.net"),
      fakeRecord("PTR", "mx1.example.org"),
    ]));
    resolver.set("bad.example.net", "A", fakeAnswer("NOERROR", [fakeRecord("A", "9.9.9.9")]));
    const result = await mail("example.org", resolver);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(codes(result.outcome)).not.toContain("mx.ptr_not_confirmed");
    expect(codes(result.outcome)).toContain("mx.ok");
  });

  it("does not treat a refused pointer name as confirmation", async () => {
    const resolver = new FakeResolver();
    resolver.set("example.org", "MX", fakeAnswer("NOERROR", [fakeRecord("MX", "mx1.example.org", { priority: 10 })]));
    resolver.set("mx1.example.org", "A", fakeAnswer("NOERROR", [fakeRecord("A", "1.2.3.4")]));
    resolver.set("1.2.3.4", "PTR", fakeAnswer("NOERROR", [fakeRecord("PTR", "localhost")]));
    const result = await mail("example.org", resolver);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.findings).toContainEqual({
      code: "mx.ptr_not_confirmed",
      severity: "warn",
      params: { ip: "1.2.3.4", ptr: "localhost" },
    });
    expect(resolver.calls.some((call) => call.name === "localhost")).toBe(false);
  });

  it("notes a single mail host and withholds a pass when another host has no address", async () => {
    const one = new FakeResolver();
    one.set("example.org", "MX", fakeAnswer("NOERROR", [fakeRecord("MX", "mx1.example.org", { priority: 10 })]));
    host("mx1.example.org", "1.2.3.4", one);
    const single = await mail("example.org", one);
    expect(single.ok && codes(single.outcome)).toEqual(["mx.single", "mx.ok"]);

    const mixed = new FakeResolver();
    mixed.set("example.org", "MX", fakeAnswer("NOERROR", [
      fakeRecord("MX", "mx1.example.org", { priority: 10 }),
      fakeRecord("MX", "mx2.example.org", { priority: 20 }),
    ]));
    host("mx1.example.org", "1.2.3.4", mixed);
    const both = await mail("example.org", mixed);
    expect(both.ok && codes(both.outcome)).toContain("mx.single");
    expect(both.ok && codes(both.outcome)).toContain("mx.host_no_address");
    expect(both.ok && codes(both.outcome)).not.toContain("mx.ok");

    const literal = new FakeResolver();
    literal.set("example.org", "MX", fakeAnswer("NOERROR", [
      fakeRecord("MX", "192.0.2.10", { priority: 10 }),
      fakeRecord("MX", "mx1.example.org", { priority: 20 }),
    ]));
    host("mx1.example.org", "1.2.3.4", literal);
    const withLiteral = await mail("example.org", literal);
    expect(withLiteral.ok && codes(withLiteral.outcome)).not.toContain("mx.ok");
  });

  it("maps a failed MX query without looking up hosts", async () => {
    const servfail = new FakeResolver();
    servfail.set("example.org", "MX", fakeAnswer("SERVFAIL"));
    const failed = await mail("example.org", servfail);
    expect(failed.ok && failed.outcome.findings).toEqual([{ code: "check.error", severity: "unknown" }]);
    if (failed.ok) expect(failed.outcome.raw).toBe(";; MX SERVFAIL");

    const timeout = new FakeResolver();
    timeout.set("example.org", "MX", fakeAnswer("TIMEOUT"));
    const timed = await mail("example.org", timeout);
    expect(timed.ok && timed.outcome.findings).toEqual([{ code: "check.timeout", severity: "unknown", params: { seconds: 20 } }]);
    if (timed.ok) expect(timed.outcome.raw).toBe(";; MX TIMEOUT");

    const egress = new FakeResolver();
    egress.set("example.org", "MX", fakeAnswer("NO_EGRESS"));
    const stuck = await mail("example.org", egress);
    expect(stuck.ok && codes(stuck.outcome)).toEqual(["check.no_egress"]);
    if (stuck.ok) expect(stuck.outcome.raw).toBe(";; MX NO_EGRESS");

    const refused = new FakeResolver();
    refused.set("example.org", "MX", fakeAnswer("REFUSED"));
    const deny = await mail("example.org", refused);
    expect(deny.ok && deny.outcome.raw).toBe(";; MX REFUSED");
    if (deny.ok) expect(deny.outcome.cacheTtlMs).toBeUndefined();
  });

  it("uses the host's own address when the alias lookup fails", async () => {
    const resolver = new FakeResolver();
    resolver.set("example.org", "MX", fakeAnswer("NOERROR", [fakeRecord("MX", "mail.example.org", { priority: 10 })]));
    resolver.set("mail.example.org", "CNAME", fakeAnswer("SERVFAIL"));
    host("mail.example.org", "1.2.3.4", resolver);
    const result = await mail("example.org", resolver);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(codes(result.outcome)).not.toContain("mx.cname");
    expect(resolver.calls.some((call) => call.name === "mail.example.org" && call.type === "A")).toBe(true);
    expect(codes(result.outcome)).toContain("mx.ok");
  });

  it("rejects an address and a service label before any query", () => {
    const address = prepareMx({ domain: "1.2.3.4" });
    const service = prepareMx({ domain: "_dmarc.example.com" });
    expect(address.ok).toBe(false);
    expect(service.ok).toBe(false);
    if (!address.ok) expect(address.outcome.findings[0]?.code).toBe("target.invalid");
    if (!service.ok) expect(service.outcome.findings[0]?.code).toBe("target.invalid");
  });
});
