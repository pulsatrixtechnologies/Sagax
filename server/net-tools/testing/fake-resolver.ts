// In-memory DNS for unit tests. A missing name is NODATA, never a live query.
import type { DnsAnswer, DnsRecord, DnsRecordType, DnsStatus, NetResolver } from "../model.ts";

export function fakeAnswer(status: DnsStatus, records: DnsRecord[] = [], extra?: Partial<DnsAnswer>): DnsAnswer {
  return { status, records, authenticated: false, via: "node", ...extra };
}

export function fakeRecord(type: DnsRecordType, value: string, extra?: Partial<DnsRecord>): DnsRecord {
  return { type, value, ...extra };
}

function abortError(): Error {
  const error = new Error("The check deadline passed.");
  error.name = "AbortError";
  return error;
}

function waitAbort(signal?: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (!signal) return;
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    signal.addEventListener("abort", () => reject(abortError()), { once: true });
  });
}

/** Answers keyed by name and type. `queryServer` sees only what `setAt` stored. */
export class FakeResolver implements NetResolver {
  readonly calls: { name: string; type: DnsRecordType; server?: string }[] = [];
  /** When set, each query waits on this before answering. */
  hold: Promise<void> | null = null;
  /** When set, each query waits until the signal aborts. */
  hang = false;
  private readonly answers = new Map<string, DnsAnswer>();
  private readonly at = new Map<string, DnsAnswer>();

  set(name: string, type: DnsRecordType, answer: DnsAnswer): void {
    this.answers.set(this.key(name, type), answer);
  }

  setAt(server: string, name: string, type: DnsRecordType, answer: DnsAnswer): void {
    this.at.set(`${server} ${this.key(name, type)}`, answer);
  }

  /** Every record type, including MX, is NXDOMAIN. */
  nxdomain(name: string): void {
    const types: DnsRecordType[] = ["A", "AAAA", "CNAME", "TXT", "NS", "SOA", "CAA", "PTR", "MX"];
    for (const type of types) this.set(name, type, fakeAnswer("NXDOMAIN"));
  }

  async query(name: string, type: DnsRecordType, signal?: AbortSignal): Promise<DnsAnswer> {
    this.calls.push({ name, type });
    if (this.hold) await this.hold;
    if (this.hang) await waitAbort(signal);
    return structuredClone(this.answers.get(this.key(name, type)) ?? fakeAnswer("NODATA"));
  }

  async queryServer(server: string, name: string, type: DnsRecordType, signal?: AbortSignal): Promise<DnsAnswer> {
    this.calls.push({ name, type, server });
    if (this.hold) await this.hold;
    if (this.hang) await waitAbort(signal);
    return structuredClone(this.at.get(`${server} ${this.key(name, type)}`) ?? fakeAnswer("NODATA"));
  }

  private key(name: string, type: DnsRecordType): string {
    return `${name.toLowerCase().replace(/\.$/, "")} ${type}`;
  }
}
