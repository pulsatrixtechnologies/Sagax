// mx_lookup. Mail hosts are resolved and reported. This check never connects,
// so a private address in an answer is not an address-guard refusal.
import { z } from "zod";

import { isIpv4Literal, isIpv6Literal, isRefusedName, parseNetTarget } from "../../../shared/net-tools/target.ts";
import type { NetFinding, NetVerdict } from "../../../shared/net-tools/types.ts";
import { zoneLine } from "../format.ts";
import { dnsAnswerCacheTtl } from "../limits.ts";
import {
  deadlineSeconds,
  refusal,
  targetText,
  type DnsAnswer,
  type DnsRecord,
  type DnsRecordType,
  type NetCheckContext,
  type NetCheckOutcome,
  type NetResolver,
} from "../model.ts";
import { ask, isConclusive, memoResolver } from "./query.ts";

export const mxLookupSchema = z.object({
  domain: z.string(),
}).strict();

export const MX_LOOKUP_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["domain"],
  properties: {
    domain: { type: "string" },
  },
} as const;

export interface PreparedMx {
  target: string;
  cacheKey: string;
}

interface HostRow {
  priority: number;
  host: string;
  ips: string[];
  ptrs: string[];
  hasAddress: boolean;
}

function finding(code: string, severity: NetVerdict, params?: NetFinding["params"]): NetFinding {
  return params ? { code, severity, params } : { code, severity };
}

function bareName(value: string): string {
  const stripped = value.trim().replace(/\.$/, "");
  if (stripped.startsWith("[") && stripped.endsWith("]")) return stripped.slice(1, -1);
  return stripped;
}

function isNullMx(record: DnsRecord): boolean {
  return record.type === "MX" && (record.priority ?? 0) === 0 && (record.value === "." || record.value === "");
}

function isLiteral(host: string): boolean {
  return isIpv4Literal(host) || isIpv6Literal(host);
}

/** Compare addresses the way a URL parser canonicalises them, including IPv6. */
function canonicalIp(ip: string): string {
  const bare = bareName(ip);
  if (!bare.includes(":")) return bare;
  try {
    return new URL(`http://[${bare}]/`).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return bare.toLowerCase();
  }
}

function sameIp(left: string, right: string): boolean {
  return canonicalIp(left) === canonicalIp(right);
}

function ofType(answer: DnsAnswer, type: DnsRecordType): DnsRecord[] {
  if (answer.status !== "NOERROR") return [];
  return answer.records.filter((record) => record.type === type);
}

async function addressRecords(resolver: NetResolver, name: string, signal: AbortSignal): Promise<DnsRecord[]> {
  const v4 = await ask(resolver, name, "A", signal);
  const v6 = await ask(resolver, name, "AAAA", signal);
  return [...ofType(v4, "A"), ...ofType(v6, "AAAA")];
}

/** Validate a domain. An address, a refused name, or a bad shape never reaches DNS. */
export function prepareMx(input: unknown, ownNames?: readonly string[]): { ok: true; prepared: PreparedMx } | { ok: false; outcome: NetCheckOutcome } {
  const parsed = mxLookupSchema.safeParse(input);
  const shown = targetText(input, ["domain"]);
  if (!parsed.success) return { ok: false, outcome: refusal(shown, "target.invalid") };
  const target = parseNetTarget(parsed.data.domain, { accept: "domain", ownNames });
  if (!target.ok) return { ok: false, outcome: refusal(shown, target.code) };
  const host = target.target.host;
  return { ok: true, prepared: { target: host, cacheKey: `mx:${host}` } };
}

function transport(target: string, status: "TIMEOUT" | "NO_EGRESS", deadlineMs: number): NetCheckOutcome {
  const timedOut = status === "TIMEOUT";
  return {
    target,
    findings: [finding(timedOut ? "check.timeout" : "check.no_egress", "unknown", timedOut ? { seconds: deadlineSeconds(deadlineMs) } : undefined)],
    details: [],
    raw: `;; MX ${status}`,
  };
}

/** Run a prepared mx_lookup. Null MX, literals and refused names are not resolved further. */
export async function runMxLookup(prepared: PreparedMx, ctx: NetCheckContext): Promise<NetCheckOutcome> {
  const resolver = memoResolver(ctx.resolver);
  const { target } = prepared;
  const answer = await ask(resolver, target, "MX", ctx.signal);
  if (answer.status === "TIMEOUT" || answer.status === "NO_EGRESS") return transport(target, answer.status, ctx.deadlineMs);
  if (!isConclusive(answer.status)) {
    return { target, findings: [finding("check.error", "unknown")], details: [], raw: `;; MX ${answer.status}` };
  }
  if (answer.status === "NXDOMAIN") {
    return {
      target,
      findings: [finding("dns.nxdomain", "fail", { name: target })],
      details: [],
      raw: ";; status: NXDOMAIN",
      cacheTtlMs: dnsAnswerCacheTtl([], true),
    };
  }
  const records = ofType(answer, "MX");
  if (records.length === 0) {
    return {
      target,
      findings: [finding("mx.none", "fail")],
      details: [],
      raw: "",
      cacheTtlMs: dnsAnswerCacheTtl([], true),
    };
  }
  if (records.every(isNullMx)) {
    return {
      target,
      findings: [finding("mx.null", "info")],
      details: [{ label: "mx_hosts", columns: ["priority", "host"], rows: [["0", "."]] }],
      raw: records.map((record) => zoneLine(target, record)).join("\n"),
      cacheTtlMs: dnsAnswerCacheTtl(records, true),
    };
  }

  const ignoredNull = records.some(isNullMx);
  const hosts = records.filter((record) => !isNullMx(record)).map((record) => ({
    priority: record.priority ?? 0,
    host: bareName(record.value),
  })).sort((left, right) => left.priority - right.priority || left.host.localeCompare(right.host));

  const findings: NetFinding[] = [];
  const notes: string[] = [];
  const rows: HostRow[] = [];
  const ttlRecords: DnsRecord[] = [...records];
  if (ignoredNull) notes.push(";; ignored null MX beside real hosts");

  for (const host of hosts) {
    if (isLiteral(host.host)) {
      findings.push(finding("mx.ip_literal", "fail", { host: host.host }));
      rows.push({ ...host, ips: [], ptrs: [], hasAddress: false });
      continue;
    }
    if (isRefusedName(host.host, ctx.ownNames)) {
      findings.push(finding("mx.host_no_address", "fail", { host: host.host }));
      notes.push(`;; MX host ${host.host} was not queried`);
      rows.push({ ...host, ips: [], ptrs: [], hasAddress: false });
      continue;
    }
    const cname = await ask(resolver, host.host, "CNAME", ctx.signal);
    const canonical = isConclusive(cname.status) ? ofType(cname, "CNAME")[0] : undefined;
    let lookupName = host.host;
    if (canonical) {
      findings.push(finding("mx.cname", "warn", { host: host.host }));
      const next = bareName(canonical.value);
      if (isRefusedName(next, ctx.ownNames) || isLiteral(next)) {
        findings.push(finding("mx.host_no_address", "fail", { host: host.host }));
        rows.push({ ...host, ips: [], ptrs: [], hasAddress: false });
        continue;
      }
      lookupName = next;
    }
    const addresses = await addressRecords(resolver, lookupName, ctx.signal);
    ttlRecords.push(...addresses);
    if (addresses.length === 0) {
      findings.push(finding("mx.host_no_address", "fail", { host: host.host }));
      rows.push({ ...host, ips: [], ptrs: [], hasAddress: false });
      continue;
    }
    const ips = addresses.map((record) => record.value);
    const ptrs: string[] = [];
    for (const ip of ips) {
      const ptr = await ask(resolver, ip, "PTR", ctx.signal);
      if (!isConclusive(ptr.status)) continue;
      const names = ofType(ptr, "PTR").map((record) => bareName(record.value));
      if (names.length === 0) {
        findings.push(finding("mx.ptr_missing", "warn", { ip }));
        continue;
      }
      ptrs.push(...names);
      let confirmed = false;
      for (const name of names) {
        if (isRefusedName(name, ctx.ownNames) || isLiteral(name)) continue;
        const forward = await addressRecords(resolver, name, ctx.signal);
        if (forward.some((record) => sameIp(record.value, ip))) confirmed = true;
      }
      if (!confirmed) findings.push(finding("mx.ptr_not_confirmed", "warn", { ip, ptr: names.join(", ") }));
    }
    rows.push({ ...host, ips, ptrs, hasAddress: true });
  }

  const addressed = rows.filter((row) => row.hasAddress).length;
  if (addressed === 1) findings.push(finding("mx.single", "info"));
  if (rows.length > 0 && addressed === rows.length) findings.push(finding("mx.ok", "pass", { count: rows.length }));

  const zone = records.map((record) => zoneLine(target, record));
  return {
    target,
    findings,
    details: [{
      label: "mx_hosts",
      columns: ["priority", "host", "ips", "ptr"],
      rows: rows.map((row) => [String(row.priority), row.host, row.ips.join(", "), row.ptrs.join(", ")]),
    }],
    raw: [...zone, ...notes].filter((line) => line !== "").join("\n"),
    cacheTtlMs: dnsAnswerCacheTtl(ttlRecords, true),
  };
}
