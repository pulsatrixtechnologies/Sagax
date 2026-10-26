// dns_lookup. Asks the public resolvers only. A private address in the answer
// is reported; this check never connects, so the address guard does not apply.
import { z } from "zod";

import { isIpv4Literal, isIpv6Literal, isRefusedName, parseNetTarget } from "../../../shared/net-tools/target.ts";
import { NET_DNS_TYPES, type NetDnsType, type NetFinding, type NetVerdict } from "../../../shared/net-tools/types.ts";
import { zoneLine } from "../format.ts";
import { publicAddressRefusal } from "../guard.ts";
import { dnsAnswerCacheTtl } from "../limits.ts";
import {
  deadlineSeconds,
  refusal,
  targetText,
  type DnsAnswer,
  type DnsRecord,
  type DnsStatus,
  type NetCheckContext,
  type NetCheckOutcome,
  type NetResolver,
} from "../model.ts";
import { ask, isAbortError, isConclusive, memoResolver, throwIfAborted } from "./query.ts";

const DEFAULT_TYPES: NetDnsType[] = ["A", "AAAA", "CNAME", "TXT", "NS", "SOA", "CAA"];
const MAX_NS = 6;

export const dnsLookupSchema = z.object({
  name: z.string(),
  types: z.array(z.enum(NET_DNS_TYPES)).max(8).optional(),
}).strict();

export const DNS_LOOKUP_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name"],
  properties: {
    name: { type: "string" },
    types: {
      type: "array",
      maxItems: 8,
      items: { type: "string", enum: [...NET_DNS_TYPES] },
    },
  },
} as const;

export interface PreparedDns {
  target: string;
  cacheKey: string;
  explicit: boolean;
  types: NetDnsType[];
  ip: boolean;
}

function finding(code: string, severity: NetVerdict, params?: NetFinding["params"]): NetFinding {
  return params ? { code, severity, params } : { code, severity };
}

function dedupeTypes(types: readonly NetDnsType[]): NetDnsType[] {
  const seen = new Set<NetDnsType>();
  const out: NetDnsType[] = [];
  for (const type of types) {
    if (seen.has(type)) continue;
    seen.add(type);
    out.push(type);
  }
  return out;
}

/** Validate and normalise a dns_lookup. A refusal here has not touched DNS. */
export function prepareDns(input: unknown, ownNames?: readonly string[]): { ok: true; prepared: PreparedDns } | { ok: false; outcome: NetCheckOutcome } {
  const parsed = dnsLookupSchema.safeParse(input);
  const shown = targetText(input, ["name"]);
  if (!parsed.success) return { ok: false, outcome: refusal(shown, "target.invalid") };
  if (parsed.data.types && parsed.data.types.length === 0) return { ok: false, outcome: refusal(shown, "target.invalid") };
  const target = parseNetTarget(parsed.data.name, { accept: "host", underscoreLabels: true, ownNames });
  if (!target.ok) return { ok: false, outcome: refusal(shown, target.code) };
  const host = target.target.host;
  const ip = target.target.kind !== "domain";
  const explicit = parsed.data.types !== undefined;
  const types = dedupeTypes(parsed.data.types ?? (ip ? ["PTR"] : DEFAULT_TYPES));
  if (ip && types.some((type) => type !== "PTR")) return { ok: false, outcome: refusal(host, "target.invalid") };
  if (!ip && types.includes("PTR")) return { ok: false, outcome: refusal(host, "target.invalid") };
  const sorted = [...types].sort().join(",");
  return { ok: true, prepared: { target: host, cacheKey: `dns:${host}:${explicit ? "ask" : "all"}:${sorted}`, explicit, types, ip } };
}

function recordsOf(answer: DnsAnswer | undefined, type: NetDnsType): DnsRecord[] {
  if (!answer || !isConclusive(answer.status)) return [];
  return answer.records.filter((record) => record.type === type);
}

function emptyAnswer(answer: DnsAnswer | undefined): boolean {
  if (!answer) return false;
  return answer.status === "NODATA" || answer.status === "NXDOMAIN" || (answer.status === "NOERROR" && answer.records.length === 0);
}

async function askServer(resolver: NetResolver, server: string, name: string, signal: AbortSignal): Promise<DnsAnswer> {
  throwIfAborted(signal);
  const queryServer = resolver.queryServer;
  if (!queryServer) return { status: "NO_EGRESS", records: [], authenticated: false, via: "node" };
  try {
    return await queryServer(server, name, "SOA", signal);
  } catch (error) {
    if (isAbortError(error)) throw error;
    return { status: "NO_EGRESS", records: [], authenticated: false, via: "node" };
  }
}

function soaSerial(value: string): number | undefined {
  const serial = Number(value.trim().split(/\s+/)[2]);
  return Number.isFinite(serial) ? serial : undefined;
}

function bareIp(value: string): string {
  return value.replace(/^\[|\]$/g, "");
}

interface NameServerNotes {
  findings: NetFinding[];
  notes: string[];
}

/** Lame delegation and SOA serials need a query to each name server, not the recursive resolver. */
async function inspectNameServers(resolver: NetResolver, zone: string, nsAnswer: DnsAnswer | undefined, signal: AbortSignal, ownNames: readonly string[] | undefined): Promise<NameServerNotes> {
  const findings: NetFinding[] = [];
  const notes: string[] = [];
  if (!resolver.queryServer) {
    notes.push(";; authoritative name servers were not queried directly");
    return { findings, notes };
  }
  const names = recordsOf(nsAnswer, "NS").map((record) => record.value.replace(/\.$/, "")).slice(0, MAX_NS);
  const serials: number[] = [];
  let directCalls = 0;
  let transportCalls = 0;
  for (const ns of names) {
    throwIfAborted(signal);
    if (isRefusedName(ns, ownNames)) {
      notes.push(`;; ${ns} was not queried: refused name`);
      continue;
    }
    const literal = isIpv4Literal(bareIp(ns)) || isIpv6Literal(bareIp(ns));
    let addresses: string[] = [];
    if (literal) {
      const ip = bareIp(ns);
      if (publicAddressRefusal(ip)) {
        notes.push(`;; ${ns} was not queried directly: its address is not public`);
        continue;
      }
      addresses = [ip];
    } else {
      const v4 = await ask(resolver, ns, "A", signal);
      const v6 = await ask(resolver, ns, "AAAA", signal);
      const found = [...recordsOf(v4, "A"), ...recordsOf(v6, "AAAA")].map((record) => record.value);
      const bothEmpty = isConclusive(v4.status) && isConclusive(v6.status) && found.length === 0;
      if (bothEmpty) {
        findings.push(finding("dns.lame_ns", "warn", { ns }));
        continue;
      }
      const usable = found.filter((address) => publicAddressRefusal(address) === null);
      if (usable.length === 0) {
        notes.push(found.length > 0 ? `;; ${ns} was not queried directly: its address is not public` : `;; ${ns} address lookup was not conclusive`);
        continue;
      }
      addresses = usable;
    }
    let decided: "transport" | "soa" | "lame" = "transport";
    let serial: number | undefined;
    for (const address of addresses) {
      const answer = await askServer(resolver, address, zone, signal);
      directCalls += 1;
      if (answer.status === "TIMEOUT" || answer.status === "NO_EGRESS") {
        transportCalls += 1;
        continue;
      }
      const soa = answer.records.find((record) => record.type === "SOA");
      if (answer.status === "NOERROR" && soa) {
        decided = "soa";
        serial = soaSerial(soa.value);
        break;
      }
      decided = "lame";
    }
    if (decided === "soa") {
      if (serial !== undefined) serials.push(serial);
    } else if (decided === "lame") {
      findings.push(finding("dns.lame_ns", "warn", { ns }));
    }
  }
  if (directCalls > 0 && transportCalls === directCalls) notes.push(";; authoritative queries did not leave this server");
  if (new Set(serials).size >= 2) findings.push(finding("dns.soa_serial_mismatch", "warn"));
  return { findings, notes };
}

function joinRaw(groups: string[][]): string {
  return groups.flat().filter((line) => line !== "").join("\n");
}

/** Run a prepared dns_lookup. The runner applies the cap, the verdict and the cache. */
export async function runDnsLookup(prepared: PreparedDns, ctx: NetCheckContext): Promise<NetCheckOutcome> {
  const resolver = memoResolver(ctx.resolver);
  const { target, types, explicit, ip } = prepared;
  const answers = new Map<NetDnsType, DnsAnswer>();
  let viaDoh = false;
  for (const type of types) {
    const answer = await ask(resolver, target, type, ctx.signal);
    answers.set(type, answer);
    if (answer.via === "doh") viaDoh = true;
  }
  const statuses = types.map((type) => answers.get(type)?.status ?? "NO_EGRESS");
  const conclusive = statuses.filter((status) => isConclusive(status));
  const failed = types.filter((type) => !isConclusive(answers.get(type)?.status ?? "NO_EGRESS"));
  const failureLines = failed.map((type) => `;; ${type} ${answers.get(type)?.status ?? "NO_EGRESS"}`);
  const viaLine = viaDoh ? [";; via doh"] : [];
  const requestedRecords = types.flatMap((type) => recordsOf(answers.get(type), type));

  if (conclusive.length === 0) {
    const transportOnly = statuses.every((status) => status === "TIMEOUT" || status === "NO_EGRESS");
    if (transportOnly) {
      const timedOut = statuses.some((status) => status === "TIMEOUT");
      const code = timedOut ? "check.timeout" : "check.no_egress";
      const params = timedOut ? { seconds: deadlineSeconds(ctx.deadlineMs) } : undefined;
      return { target, findings: [finding(code, "unknown", params)], details: [], raw: joinRaw([failureLines, viaLine]) };
    }
    const dominant: DnsStatus = statuses.includes("SERVFAIL") ? "SERVFAIL" : statuses.includes("REFUSED") ? "REFUSED" : (statuses[0] ?? "SERVFAIL");
    return {
      target,
      findings: [finding("check.error", "unknown")],
      details: [],
      raw: joinRaw([[`;; status: ${dominant}`], failureLines, viaLine]),
    };
  }

  const allNxdomain = conclusive.every((status) => status === "NXDOMAIN");
  const authenticated = [...answers.values()].some((answer) => answer.authenticated);
  const dnssec = (extra?: DnsAnswer): NetFinding[] => (authenticated || extra?.authenticated ? [finding("dns.dnssec_validated", "info")] : []);

  if (ip) {
    const ptr = answers.get("PTR");
    if (allNxdomain || emptyAnswer(ptr)) {
      const status = ptr?.status === "NXDOMAIN" ? "NXDOMAIN" : "NODATA";
      return {
        target,
        findings: [finding("dns.ptr_missing", "info", { ip: target }), ...dnssec()],
        details: [],
        raw: joinRaw([[`;; status: ${status}`], failureLines, viaLine]),
        cacheTtlMs: dnsAnswerCacheTtl(requestedRecords, true),
      };
    }
    return finish(target, explicit, types, answers, requestedRecords, [finding("dns.records_found", "pass", { count: requestedRecords.length }), ...dnssec()], [], failureLines, viaLine, false);
  }

  if (allNxdomain) {
    return {
      target,
      findings: [finding("dns.nxdomain", "fail", { name: target }), ...dnssec()],
      details: [],
      raw: joinRaw([[";; status: NXDOMAIN"], failureLines, viaLine]),
      cacheTtlMs: dnsAnswerCacheTtl([], true),
    };
  }

  let soaProbe: DnsAnswer | undefined;
  const cnameRecords = recordsOf(answers.get("CNAME"), "CNAME");
  if (cnameRecords.length > 0 && !types.includes("SOA")) {
    soaProbe = await ask(resolver, target, "SOA", ctx.signal);
    if (soaProbe.via === "doh") viaDoh = true;
  }
  const soaRecords = recordsOf(answers.get("SOA") ?? soaProbe, "SOA");
  const findings: NetFinding[] = [];
  if (requestedRecords.length > 0) findings.push(finding("dns.records_found", "pass", { count: requestedRecords.length }));
  if (explicit) {
    for (const type of types) {
      const answer = answers.get(type);
      if (answer && isConclusive(answer.status) && recordsOf(answer, type).length === 0) findings.push(finding("dns.no_records", "info", { type }));
    }
  }
  if (cnameRecords.length > 0 && soaRecords.length > 0) findings.push(finding("dns.cname_at_apex", "fail"));
  const hasA = recordsOf(answers.get("A"), "A").length > 0;
  const aaaa = answers.get("AAAA");
  const cname = answers.get("CNAME");
  const aaaaEmpty = aaaa !== undefined && (aaaa.status === "NODATA" || aaaa.status === "NXDOMAIN" || (aaaa.status === "NOERROR" && recordsOf(aaaa, "AAAA").length === 0));
  const cnameEmpty = cname !== undefined && isConclusive(cname.status) && recordsOf(cname, "CNAME").length === 0;
  if (hasA && aaaaEmpty && cnameEmpty) findings.push(finding("dns.no_aaaa", "info"));

  const nsNotes = types.includes("NS") ? await inspectNameServers(resolver, target, answers.get("NS"), ctx.signal, ctx.ownNames) : { findings: [], notes: [] };
  findings.push(...nsNotes.findings);
  if (soaProbe && !isConclusive(soaProbe.status)) nsNotes.notes.push(`;; SOA ${soaProbe.status}`);
  findings.push(...dnssec(soaProbe));
  const via = viaDoh ? [";; via doh"] : [];
  return finish(target, explicit, types, answers, requestedRecords, findings, nsNotes.notes, failureLines, via, requestedRecords.length === 0);
}

function finish(
  target: string,
  explicit: boolean,
  types: readonly NetDnsType[],
  answers: ReadonlyMap<NetDnsType, DnsAnswer>,
  requestedRecords: readonly DnsRecord[],
  findings: NetFinding[],
  notes: string[],
  failureLines: string[],
  via: string[],
  noRecords: boolean,
): NetCheckOutcome {
  const zone = types.flatMap((type) => recordsOf(answers.get(type), type).map((record) => zoneLine(target, record)));
  const phrase = !explicit && noRecords ? [";; NOERROR, no records"] : [];
  const details = types.flatMap((type) => {
    const records = recordsOf(answers.get(type), type);
    if (records.length === 0) return [];
    return [{
      label: type,
      columns: ["value", "ttl"],
      rows: records.map((record) => [record.value, record.ttl === undefined ? "" : String(record.ttl)]),
    }];
  });
  return {
    target,
    findings,
    details,
    raw: joinRaw([zone, failureLines, notes, phrase, via]),
    cacheTtlMs: dnsAnswerCacheTtl(requestedRecords, true),
  };
}
