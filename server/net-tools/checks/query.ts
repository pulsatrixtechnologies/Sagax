// Shared query helpers. A check memos one name and type so a follow-up
// (lame name servers, the extra SOA probe) does not ask twice.
import type { DnsAnswer, DnsRecordType, DnsStatus, NetResolver } from "../model.ts";

export function abortError(): Error {
  const error = new Error("The check deadline passed.");
  error.name = "AbortError";
  return error;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

export function isConclusive(status: DnsStatus): boolean {
  return status === "NOERROR" || status === "NODATA" || status === "NXDOMAIN";
}

/** Remember both successes and failures for the rest of this check. */
export function memoResolver(resolver: NetResolver): NetResolver {
  const cache = new Map<string, Promise<DnsAnswer>>();
  const remember = (key: string, work: () => Promise<DnsAnswer>): Promise<DnsAnswer> => {
    const existing = cache.get(key);
    if (existing) return existing;
    const pending = work();
    cache.set(key, pending);
    return pending;
  };
  const queryServer = resolver.queryServer?.bind(resolver);
  return {
    query: (name, type, signal) => remember(`${name.toLowerCase()} ${type}`, () => resolver.query(name, type, signal)),
    ...(queryServer
      ? {
          queryServer: (server: string, name: string, type: DnsRecordType, signal?: AbortSignal) =>
            remember(`${server} ${name.toLowerCase()} ${type}`, () => queryServer(server, name, type, signal)),
        }
      : {}),
  };
}

/** One query. A transport throw becomes NO_EGRESS; the deadline still aborts. */
export async function ask(resolver: NetResolver, name: string, type: DnsRecordType, signal: AbortSignal): Promise<DnsAnswer> {
  throwIfAborted(signal);
  try {
    return await resolver.query(name, type, signal);
  } catch (error) {
    if (isAbortError(error)) throw error;
    return { status: "NO_EGRESS", records: [], authenticated: false, via: "node" };
  }
}
