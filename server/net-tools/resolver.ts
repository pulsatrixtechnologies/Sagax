// DNS for IT checks. The name being checked goes only to the configured public
// resolvers, never the system resolver, so a split-horizon view cannot leak.
// When those resolvers fail, the same name is sent to a DNS-over-HTTPS endpoint
// pinned to a public address. The system resolver is used only to find that
// endpoint's own address, and only after the public resolvers already failed.
import { lookup as dnsLookup, Resolver } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

import { isIpv4Literal, isIpv6Literal, isRefusedName } from "../../shared/net-tools/target.ts";
import { publicAddressRefusal } from "./guard.ts";
import type { DnsAnswer, DnsRecord, DnsRecordType, DnsStatus, NetResolver } from "./model.ts";

export const DNS_SERVERS_ENV = "SAGAX_NET_DNS_SERVERS";
export const DOH_URLS_ENV = "SAGAX_NET_DOH_URLS";
export const QUERY_TIMEOUT_MS = 2_500;
export const QUERY_TRIES = 2;
export const DOH_BODY_CAP = 65_536;

/** Public recursive resolvers. An instance setServers call, never the process default. */
export const DEFAULT_DNS_SERVERS = ["1.1.1.1", "1.0.0.1", "8.8.8.8", "8.8.4.4", "9.9.9.9", "208.67.222.222"] as const;

export const DEFAULT_DOH_URLS = ["https://cloudflare-dns.com/dns-query", "https://dns.google/resolve"] as const;

const TYPE_CODE: Record<DnsRecordType, number> = {
  A: 1,
  NS: 2,
  CNAME: 5,
  SOA: 6,
  PTR: 12,
  MX: 15,
  TXT: 16,
  AAAA: 28,
  CAA: 257,
};

export type NodeDnsClass = DnsStatus | "UNKNOWN";

/** Map a Node resolver error. AbortError is the check's deadline and is rethrown by the caller. */
export function classifyNodeDnsError(error: unknown): NodeDnsClass {
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "";
  switch (code) {
    case "ENOTFOUND":
      return "NXDOMAIN";
    case "ENODATA":
      return "NODATA";
    case "ESERVFAIL":
      return "SERVFAIL";
    case "EREFUSED":
      return "REFUSED";
    case "ETIMEOUT":
    case "ETIMEDOUT":
      return "TIMEOUT";
    case "ECONNREFUSED":
    case "ENETUNREACH":
    case "EHOSTUNREACH":
    case "EAI_AGAIN":
      return "NO_EGRESS";
    case "EFORMERR":
    case "EBADRESP":
      return "UNKNOWN";
    default:
      return "UNKNOWN";
  }
}

function fallbackClass(status: NodeDnsClass): boolean {
  return status === "TIMEOUT" || status === "NO_EGRESS" || status === "SERVFAIL" || status === "UNKNOWN";
}

function asStatus(status: NodeDnsClass): DnsStatus {
  return status === "UNKNOWN" ? "SERVFAIL" : status;
}

function bareHost(value: string): string {
  if (value === "." || value === "") return ".";
  return value.replace(/\.$/, "");
}

function answer(status: DnsStatus, records: DnsRecord[], via: DnsAnswer["via"], authenticated = false): DnsAnswer {
  return { status, records, authenticated, via };
}

/** Turn one Node resolver reply into records. TTL is present only for A and AAAA. */
export function recordsFromNodeReply(type: DnsRecordType, reply: unknown): DnsRecord[] {
  const rows = Array.isArray(reply) ? reply : reply === undefined || reply === null ? [] : [reply];
  switch (type) {
    case "A":
    case "AAAA":
      return rows.flatMap((row) => {
        if (typeof row === "string") return [{ type, value: row }];
        if (row && typeof row === "object" && "address" in row && typeof row.address === "string") {
          const ttl = "ttl" in row && typeof row.ttl === "number" ? row.ttl : undefined;
          return [{ type, value: row.address, ...(ttl === undefined ? {} : { ttl }) }];
        }
        return [];
      });
    case "CNAME":
    case "NS":
    case "PTR":
      return rows.filter((row): row is string => typeof row === "string").map((value) => ({ type, value: bareHost(value) }));
    case "TXT":
      return rows
        .filter((row): row is string[] => Array.isArray(row))
        .map((chunks) => ({ type, value: chunks.join("") }));
    case "SOA":
      return rows.flatMap((row) => {
        if (!row || typeof row !== "object" || !("serial" in row)) return [];
        const soa = row as { nsname: string; hostmaster: string; serial: number; refresh: number; retry: number; expire: number; minttl: number };
        return [{ type, value: `${soa.nsname} ${soa.hostmaster} ${soa.serial} ${soa.refresh} ${soa.retry} ${soa.expire} ${soa.minttl}` }];
      });
    case "CAA":
      return rows.flatMap((row) => {
        if (!row || typeof row !== "object") return [];
        const record = row as { critical?: number; issue?: string; issuewild?: string; iodef?: string; contactemail?: string; contactphone?: string };
        const tags = ["issue", "issuewild", "iodef", "contactemail", "contactphone"] as const;
        for (const tag of tags) {
          const value = record[tag];
          if (typeof value === "string") return [{ type, value: `${record.critical ?? 0} ${tag} ${JSON.stringify(value)}` }];
        }
        return [];
      });
    case "MX":
      return rows.flatMap((row) => {
        if (!row || typeof row !== "object" || !("exchange" in row)) return [];
        const mx = row as { exchange: string; priority?: number };
        return [{ type, value: bareHost(String(mx.exchange)), priority: mx.priority ?? 0 }];
      });
    default: {
      const unexpected: never = type;
      throw new Error(`unexpected record type ${String(unexpected)}`);
    }
  }
}

function unquoteTxt(data: string): string {
  const parts = data.match(/"(?:\\.|[^"\\])*"/g);
  if (!parts) return data;
  return parts.map((part) => {
    try {
      const parsed = JSON.parse(part) as unknown;
      return typeof parsed === "string" ? parsed : part.slice(1, -1);
    } catch {
      return part.slice(1, -1);
    }
  }).join("");
}

/** One DNS-over-HTTPS JSON body (RFC 8427). Undefined when the body is not that document. */
export function parseDohJson(body: unknown, type: DnsRecordType): DnsAnswer | undefined {
  if (!body || typeof body !== "object") return undefined;
  const doc = body as { Status?: unknown; status?: unknown; AD?: unknown; Answer?: unknown };
  const statusCode = typeof doc.Status === "number" ? doc.Status : typeof doc.status === "number" ? doc.status : undefined;
  if (statusCode === undefined) return undefined;
  const authenticated = doc.AD === true;
  const wanted = TYPE_CODE[type];
  const records: DnsRecord[] = [];
  if (Array.isArray(doc.Answer)) {
    for (const item of doc.Answer) {
      if (!item || typeof item !== "object") continue;
      const row = item as { type?: unknown; TTL?: unknown; data?: unknown };
      if (row.type !== wanted || typeof row.data !== "string") continue;
      const ttl = typeof row.TTL === "number" ? row.TTL : undefined;
      const ttlField = ttl === undefined ? {} : { ttl };
      if (type === "MX") {
        const match = /^(\d+)\s+(\S+)$/.exec(row.data.trim());
        if (!match) continue;
        records.push({ type, priority: Number(match[1]), value: bareHost(match[2]!), ...ttlField });
      } else if (type === "TXT") {
        records.push({ type, value: unquoteTxt(row.data), ...ttlField });
      } else if (type === "NS" || type === "CNAME" || type === "PTR") {
        records.push({ type, value: bareHost(row.data), ...ttlField });
      } else {
        records.push({ type, value: row.data, ...ttlField });
      }
    }
  }
  let status: DnsStatus;
  switch (statusCode) {
    case 0:
      status = records.length > 0 ? "NOERROR" : "NODATA";
      break;
    case 2:
      status = "SERVFAIL";
      break;
    case 3:
      status = "NXDOMAIN";
      break;
    case 5:
      status = "REFUSED";
      break;
    default:
      status = "SERVFAIL";
      break;
  }
  return answer(status, status === "NOERROR" ? records : [], "doh", authenticated);
}

/** The address to pin, or null when any address is missing or not public. */
export function dohPin(addresses: readonly string[]): string | null {
  if (addresses.length === 0) return null;
  for (const address of addresses) {
    if (publicAddressRefusal(address)) return null;
  }
  return addresses[0]!;
}

function validPort(value: string): boolean {
  if (!/^\d{1,5}$/.test(value)) return false;
  const port = Number(value);
  return port >= 1 && port <= 65_535;
}

/** Public addresses only. A blank or all-invalid list falls back to the defaults. */
export function configuredDnsServers(raw?: string): string[] {
  const source = raw ?? process.env[DNS_SERVERS_ENV];
  const parsed: string[] = [];
  for (const entry of (source ?? "").split(/[\s,]+/)) {
    const text = entry.trim();
    if (!text) continue;
    const v6 = /^\[([^\]]+)\](?::(\d{1,5}))?$/.exec(text);
    if (v6) {
      if (publicAddressRefusal(v6[1]!)) continue;
      if (v6[2] && !validPort(v6[2])) continue;
      parsed.push(v6[2] ? `[${v6[1]}]:${v6[2]}` : v6[1]!);
      continue;
    }
    const v4 = /^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/.exec(text);
    if (v4) {
      if (!isIpv4Literal(v4[1]!) || publicAddressRefusal(v4[1]!)) continue;
      if (!validPort(v4[2]!)) continue;
      parsed.push(`${v4[1]}:${v4[2]}`);
      continue;
    }
    if (publicAddressRefusal(text)) continue;
    parsed.push(text);
  }
  return parsed.length > 0 ? parsed : [...DEFAULT_DNS_SERVERS];
}

/** HTTPS endpoints only, with no user info. A name that is refused as a target is dropped. */
export function configuredDohUrls(raw?: string): string[] {
  const source = raw ?? process.env[DOH_URLS_ENV];
  const parsed: string[] = [];
  for (const entry of (source ?? "").split(/[\s,]+/)) {
    if (!entry) continue;
    let url: URL;
    try {
      url = new URL(entry);
    } catch {
      continue;
    }
    if (url.protocol !== "https:" || url.username || url.password) continue;
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (isIP(host)) {
      if (publicAddressRefusal(host)) continue;
    } else if (isRefusedName(host)) continue;
    parsed.push(url.toString());
  }
  return parsed.length > 0 ? parsed : [...DEFAULT_DOH_URLS];
}

export interface NodeDnsPort {
  resolve(servers: readonly string[], name: string, type: DnsRecordType, timeoutMs: number, tries: number, signal?: AbortSignal): Promise<unknown>;
  resolveAt(server: string, name: string, type: DnsRecordType, timeoutMs: number, tries: number, signal?: AbortSignal): Promise<unknown>;
}

export type DohFetch = (url: string, init: RequestInit, pinned: string) => Promise<Response>;

export interface NetResolverOptions {
  servers?: readonly string[];
  dohUrls?: readonly string[];
  node?: NodeDnsPort;
  /** Replaces the HTTPS fallback. Tests pass this so nothing is contacted. */
  dohQuery?: (name: string, type: DnsRecordType, signal?: AbortSignal) => Promise<DnsAnswer | undefined>;
  fetchImpl?: DohFetch;
  lookupHost?: (host: string) => Promise<string[]>;
  timeoutMs?: number;
  tries?: number;
}

function expandIpv6(ip: string): string {
  let text = ip.replace(/^\[|\]$/g, "").toLowerCase();
  const dotted = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (dotted) {
    const octets = dotted[2]!.split(".").map((part) => Number(part));
    const hi = ((octets[0]! << 8) | octets[1]!).toString(16);
    const lo = ((octets[2]! << 8) | octets[3]!).toString(16);
    const head = dotted[1] === ":" ? "" : dotted[1]!.slice(0, -1);
    text = head ? `${head}:${hi}:${lo}` : `${hi}:${lo}`;
  }
  const halves = text.split("::");
  const left = halves[0] ? halves[0]!.split(":") : [];
  const right = halves.length === 1 ? [] : halves[1] ? halves[1]!.split(":") : [];
  const missing = 8 - left.length - right.length;
  const parts = [...left, ...Array.from({ length: Math.max(0, missing) }, () => "0"), ...right];
  return parts.map((part) => part.padStart(4, "0")).join(":");
}

/** The name a PTR query uses on DNS-over-HTTPS. Node's reverse() takes the address itself. */
export function ptrQueryName(ip: string): string {
  const bare = ip.replace(/^\[|\]$/g, "");
  if (isIpv4Literal(bare)) return `${bare.split(".").reverse().join(".")}.in-addr.arpa`;
  const nibbles = expandIpv6(bare).replace(/:/g, "").split("").reverse().join(".");
  return `${nibbles}.ip6.arpa`;
}

async function readCapped(response: Response): Promise<string | undefined> {
  const text = await response.text();
  if (text.length > DOH_BODY_CAP) return undefined;
  return text;
}

/** Ask each endpoint until one returns a DNS JSON document. A private address is not fetched. */
export async function queryDohEndpoints(options: {
  urls: readonly string[];
  name: string;
  type: DnsRecordType;
  lookupHost: (host: string) => Promise<string[]>;
  fetchImpl: DohFetch;
  signal?: AbortSignal;
}): Promise<DnsAnswer | undefined> {
  for (const endpoint of options.urls) {
    if (options.signal?.aborted) return undefined;
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      continue;
    }
    const host = url.hostname.replace(/^\[|\]$/g, "");
    let addresses: string[] = [];
    if (isIP(host)) addresses = [host];
    else {
      try {
        addresses = await options.lookupHost(host);
      } catch {
        continue;
      }
    }
    const pinned = dohPin(addresses);
    if (!pinned) continue;
    url.searchParams.set("name", options.name);
    url.searchParams.set("type", options.type);
    let response: Response;
    try {
      response = await options.fetchImpl(url.toString(), {
        method: "GET",
        headers: { accept: "application/dns-json" },
        signal: options.signal,
        redirect: "manual",
      }, pinned);
    } catch {
      continue;
    }
    if (response.status !== 200) continue;
    const text = await readCapped(response);
    if (text === undefined) continue;
    try {
      const parsed = parseDohJson(JSON.parse(text) as unknown, options.type);
      if (parsed) return parsed;
    } catch {
      continue;
    }
  }
  return undefined;
}

function pinnedHttps(urlString: string, init: RequestInit, address: string): Promise<Response> {
  const url = new URL(urlString);
  const family = isIP(address) === 6 ? 6 : 4;
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, {
      method: "GET",
      headers: { accept: "application/dns-json" },
      agent: false,
      lookup: (hostname, options, callback) => {
        void hostname;
        const done = typeof options === "function" ? options : callback;
        if (!done) return;
        if (options && typeof options === "object" && options.all) done(null, [{ address, family }]);
        else done(null, address, family);
      },
      signal: init.signal ?? undefined,
    }, (incoming) => {
      const chunks: Buffer[] = [];
      let size = 0;
      let failed = false;
      incoming.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > DOH_BODY_CAP) {
          failed = true;
          incoming.destroy();
          reject(new Error("oversized"));
          return;
        }
        chunks.push(chunk);
      });
      incoming.on("error", reject);
      incoming.on("end", () => {
        if (failed) return;
        resolve(new Response(Buffer.concat(chunks), { status: incoming.statusCode ?? 502 }));
      });
    });
    req.on("error", reject);
    req.end();
  });
}

async function systemLookup(host: string): Promise<string[]> {
  const entries = await dnsLookup(host, { all: true, verbatim: true });
  return entries.map((entry) => entry.address);
}

function withSignal<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    work.then((value) => {
      signal.removeEventListener("abort", onAbort);
      resolve(value);
    }, (error: unknown) => {
      signal.removeEventListener("abort", onAbort);
      reject(error);
    });
  });
}

function abortError(): Error {
  const error = new Error("The check deadline passed.");
  error.name = "AbortError";
  return error;
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

async function dispatch(resolver: Resolver, name: string, type: DnsRecordType): Promise<unknown> {
  switch (type) {
    case "A":
      return resolver.resolve4(name, { ttl: true });
    case "AAAA":
      return resolver.resolve6(name, { ttl: true });
    case "CNAME":
      return resolver.resolveCname(name);
    case "TXT":
      return resolver.resolveTxt(name);
    case "NS":
      return resolver.resolveNs(name);
    case "SOA":
      return resolver.resolveSoa(name);
    case "CAA":
      return resolver.resolveCaa(name);
    case "MX":
      return resolver.resolveMx(name);
    case "PTR":
      return resolver.reverse(name);
    default: {
      const unexpected: never = type;
      throw new Error(`unexpected record type ${String(unexpected)}`);
    }
  }
}

function defaultNodePort(): NodeDnsPort {
  const ask = async (servers: readonly string[], name: string, type: DnsRecordType, timeoutMs: number, tries: number, signal?: AbortSignal): Promise<unknown> => {
    const resolver = new Resolver({ timeout: timeoutMs, tries });
    resolver.setServers([...servers]);
    return withSignal(dispatch(resolver, name, type), signal);
  };
  return {
    resolve: ask,
    resolveAt: (server, name, type, timeoutMs, tries, signal) => ask([server], name, type, timeoutMs, tries, signal),
  };
}

function fromNode(type: DnsRecordType, reply: unknown): DnsAnswer {
  const records = recordsFromNodeReply(type, reply);
  return answer(records.length > 0 ? "NOERROR" : "NODATA", records, "node");
}

/**
 * A resolver bound to the public servers. Under the test runner the Node port
 * must be injected: a forgotten injection must not query the network.
 */
export function createNetResolver(options: NetResolverOptions = {}): NetResolver {
  if (process.env.VITEST && !options.node) throw new Error("net resolver tests must inject the node port");
  const servers = options.servers ? [...options.servers] : configuredDnsServers();
  const dohUrls = options.dohUrls ? [...options.dohUrls] : configuredDohUrls();
  const timeoutMs = options.timeoutMs ?? QUERY_TIMEOUT_MS;
  const tries = options.tries ?? QUERY_TRIES;
  const node = options.node ?? defaultNodePort();
  const dohDisabled = Boolean(process.env.VITEST && !options.dohQuery && !options.fetchImpl);
  const doh = async (name: string, type: DnsRecordType, signal?: AbortSignal): Promise<DnsAnswer | undefined> => {
    if (dohDisabled) return undefined;
    if (options.dohQuery) return options.dohQuery(name, type, signal);
    return queryDohEndpoints({
      urls: dohUrls,
      name,
      type,
      lookupHost: options.lookupHost ?? systemLookup,
      fetchImpl: options.fetchImpl ?? pinnedHttps,
      signal,
    });
  };
  const settle = async (status: NodeDnsClass, name: string, type: DnsRecordType, signal?: AbortSignal): Promise<DnsAnswer> => {
    if (!fallbackClass(status)) return answer(asStatus(status), [], "node");
    const fallback = await doh(type === "PTR" ? ptrQueryName(name) : name, type, signal);
    if (fallback && fallback.status !== "TIMEOUT" && fallback.status !== "NO_EGRESS") return fallback;
    return answer(asStatus(status), [], "node");
  };
  return {
    async query(name, type, signal) {
      if (isAbort(signal && signal.aborted ? abortError() : undefined)) throw abortError();
      try {
        const reply = await node.resolve(servers, name, type, timeoutMs, tries, signal);
        return fromNode(type, reply);
      } catch (error) {
        if (isAbort(error)) throw error;
        return settle(classifyNodeDnsError(error), name, type, signal);
      }
    },
    async queryServer(server, name, type, signal) {
      try {
        const reply = await node.resolveAt(server, name, type, timeoutMs, tries, signal);
        return fromNode(type, reply);
      } catch (error) {
        if (isAbort(error)) throw error;
        return answer(asStatus(classifyNodeDnsError(error)), [], "node");
      }
    },
  };
}

/** The process resolver. Tests construct their own with an injected port. */
export function createDefaultResolver(): NetResolver {
  return createNetResolver();
}
