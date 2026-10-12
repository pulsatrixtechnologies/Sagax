// Finance agreements.

import type { CwAgreement, CwSite } from "./types.ts";
import { bool, date, id, num, text, type CwRecord } from "./read.ts";
import { cwRecordLink } from "./links.ts";

export function looksLikeAgreement(record: CwRecord): boolean {
  if (!id(record)) return false;
  return "agreementStatus" in record || "cancelledFlag" in record || "billAmount" in record;
}

export function agreementFrom(record: CwRecord, site: CwSite | undefined): CwAgreement | undefined {
  const agreementId = id(record);
  const name = text(record, "name");
  if (!agreementId || !name) return undefined;
  const agreement: CwAgreement = { id: agreementId, name };
  const fields: Array<[keyof CwAgreement, string | undefined]> = [
    ["company", text(record, "company.name", "company")],
    ["type", text(record, "type.name", "type")],
    ["status", text(record, "agreementStatus", "status.name", "status")],
    ["start", date(record, "startDate")],
    ["end", date(record, "endDate")],
    ["cycle", text(record, "billingCycle.name", "billingCycle")],
  ];
  for (const [key, value] of fields) if (value) (agreement as unknown as Record<string, unknown>)[key] = value;
  const amount = num(record, "billAmount");
  if (amount !== undefined && amount >= 0 && amount < 1e12) agreement.billAmount = amount;
  const cancelled = bool(record, "cancelledFlag", "cancelled");
  if (cancelled !== undefined) agreement.cancelled = cancelled;
  const link = cwRecordLink(site, "AgreementFv", agreementId);
  if (link) agreement.link = link;
  return agreement;
}
