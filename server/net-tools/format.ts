// Zone-file lines for the raw pane. Host-like values gain a trailing dot here
// so table cells can stay bare.
import type { DnsRecord, DnsRecordType } from "./model.ts";

const HOST_TYPES = new Set<DnsRecordType>(["NS", "CNAME", "PTR", "MX"]);

function dotted(value: string): string {
  if (value === "." || value === "") return ".";
  return value.endsWith(".") ? value : `${value}.`;
}

/** One record in zone-file form. TTL is omitted when the resolver did not report one. */
export function zoneLine(owner: string, record: DnsRecord): string {
  const name = owner.endsWith(".") ? owner : `${owner}.`;
  const ttl = record.ttl === undefined ? "" : ` ${record.ttl}`;
  let value = record.value;
  if (record.type === "MX") value = `${record.priority ?? 0} ${dotted(value)}`;
  else if (HOST_TYPES.has(record.type)) value = dotted(value);
  return `${name}${ttl} IN ${record.type} ${value}`;
}
