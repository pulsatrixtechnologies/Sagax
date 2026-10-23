// The checks this batch can run. Later checks stay out of the registry until
// their own batch, so a caller asking for one gets a clear "not available".
import { DNS_LOOKUP_JSON_SCHEMA, prepareDns, runDnsLookup } from "./checks/dns.ts";
import { MX_LOOKUP_JSON_SCHEMA, prepareMx, runMxLookup } from "./checks/mx.ts";
import type { NetCheckContext, NetCheckOutcome, NetLimitClass } from "./model.ts";

export interface PreparedCheck {
  target: string;
  cacheKey: string;
  run(ctx: NetCheckContext): Promise<NetCheckOutcome>;
}

export interface CheckRegistration {
  name: "dns_lookup" | "mx_lookup";
  schema: Record<string, unknown>;
  limitClass: NetLimitClass;
  prepare(input: unknown, ownNames?: readonly string[]): { ok: true; prepared: PreparedCheck } | { ok: false; outcome: NetCheckOutcome };
}

const CHECKS: readonly CheckRegistration[] = [
  {
    name: "dns_lookup",
    schema: DNS_LOOKUP_JSON_SCHEMA,
    limitClass: "dns",
    prepare(input, ownNames) {
      const result = prepareDns(input, ownNames);
      if (!result.ok) return result;
      const prepared = result.prepared;
      return { ok: true, prepared: { target: prepared.target, cacheKey: prepared.cacheKey, run: (ctx) => runDnsLookup(prepared, ctx) } };
    },
  },
  {
    name: "mx_lookup",
    schema: MX_LOOKUP_JSON_SCHEMA,
    limitClass: "dns",
    prepare(input, ownNames) {
      const result = prepareMx(input, ownNames);
      if (!result.ok) return result;
      const prepared = result.prepared;
      return { ok: true, prepared: { target: prepared.target, cacheKey: prepared.cacheKey, run: (ctx) => runMxLookup(prepared, ctx) } };
    },
  },
];

export function registrationFor(name: string): CheckRegistration | undefined {
  return CHECKS.find((check) => check.name === name);
}

/** Checks a caller can run today. Port, mail-auth and the rest are not here yet. */
export function listRegisteredChecks(): Array<CheckRegistration["name"]> {
  return CHECKS.map((check) => check.name);
}
