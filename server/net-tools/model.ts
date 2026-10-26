// IT tools server core. Language-neutral types the checks share. Findings stay
// codes from shared/net-tools/findings.ts; this module adds no new ones.
import type { NetDetailTable, NetDnsType, NetFinding, NetResultLink } from "../../shared/net-tools/types.ts";

/** Record types a resolver can return. MX is a check of its own, not a dns_lookup type. */
export type DnsRecordType = NetDnsType | "MX";

export interface DnsRecord {
  type: DnsRecordType;
  /** Address, text, or hostname without a trailing dot. A null MX is ".". */
  value: string;
  ttl?: number;
  priority?: number;
}

/** NODATA is NOERROR with nothing of the asked type. TIMEOUT and NO_EGRESS never left a resolver. */
export type DnsStatus = "NOERROR" | "NXDOMAIN" | "SERVFAIL" | "REFUSED" | "NODATA" | "TIMEOUT" | "NO_EGRESS";

export interface DnsAnswer {
  status: DnsStatus;
  records: DnsRecord[];
  /** True only when a resolver set the DNSSEC AD bit. Absence is not "unsigned". */
  authenticated: boolean;
  via: "node" | "doh";
}

export interface NetResolver {
  query(name: string, type: DnsRecordType, signal?: AbortSignal): Promise<DnsAnswer>;
  /** One authoritative server, by the address already checked. Absent on a resolver that cannot do it. */
  queryServer?(server: string, name: string, type: DnsRecordType, signal?: AbortSignal): Promise<DnsAnswer>;
}

export interface NetCheckContext {
  by: "bot" | "person";
  personId?: string;
  botId?: string;
  /** The person's own message, for the typed-target rule on port checks. */
  personText?: string;
  ownNames?: readonly string[];
  resolver: NetResolver;
  signal: AbortSignal;
  /** Connect checks only. Must be the public resolvers, never the system resolver. */
  lookup?: (host: string) => Promise<string[]>;
  deadlineMs: number;
  now?: () => number;
}

/** What a check returns before the runner stamps time, verdict and caps. */
export interface NetCheckOutcome {
  target: string;
  findings: NetFinding[];
  details: NetDetailTable[];
  raw: string;
  /** Set only for a result that may be cached. Zero or absent stores nothing. */
  cacheTtlMs?: number;
  links?: NetResultLink[];
}

export type NetLimitClass = "dns" | "dnsbl" | "rdap" | "connect" | "port" | "headers";

export function refusal(target: string, code: string, params?: NetFinding["params"], raw = ""): NetCheckOutcome {
  return { target, findings: [{ code, severity: "unknown", ...(params ? { params } : {}) }], details: [], raw };
}

export function deadlineSeconds(deadlineMs: number): number {
  return Math.max(1, Math.round(deadlineMs / 1000));
}

/** The target a person would recognise, taken from the input and cut to a domain's length. */
export function targetText(input: unknown, fields: readonly string[]): string {
  if (!input || typeof input !== "object") return "";
  const record = input as Record<string, unknown>;
  for (const field of fields) {
    const value = record[field];
    if (typeof value === "string") return value.trim().slice(0, 253);
  }
  return "";
}
