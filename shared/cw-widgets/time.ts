// Time entries: hours charged to a ticket, a project or a charge code.

import { CW_NOTE_MAX, type CwSite, type CwTimeEntry } from "./types.ts";
import { clipBlock, date, id, num, text, type CwRecord } from "./read.ts";
import { cwRecordLink } from "./links.ts";

export function looksLikeTime(record: CwRecord): boolean {
  if (!id(record)) return false;
  return "billableOption" in record || "actualHours" in record || "timeStart" in record || "chargeToId" in record;
}

const BILLABLE = new Set(["Billable", "DoNotBill", "NoCharge", "NoDefault"]);

export function timeFrom(record: CwRecord, site: CwSite | undefined): CwTimeEntry | undefined {
  const entryId = id(record);
  if (!entryId) return undefined;
  const entry: CwTimeEntry = { id: entryId };
  const chargeId = id(record, "chargeToId", "ticket.id");
  const chargeType = text(record, "chargeToType");
  if (chargeId) {
    entry.chargeToId = chargeId;
    const kind = chargeType === "ProjectTicket" ? "Project" : chargeType === "ChargeCode" ? "Code" : "Ticket";
    entry.charge = `${kind} #${chargeId}`;
  }
  const fields: Array<[keyof CwTimeEntry, string | undefined]> = [
    ["company", text(record, "company.name", "companyName", "company")],
    ["member", text(record, "member.name", "member", "memberName")],
    ["workType", text(record, "workType.name", "workType")],
    ["workRole", text(record, "workRole.name", "workRole")],
    ["status", text(record, "status.name", "status")],
    ["agreement", text(record, "agreement.name", "agreement")],
    ["start", date(record, "timeStart")],
    ["end", date(record, "timeEnd")],
  ];
  for (const [key, value] of fields) if (value) (entry as unknown as Record<string, unknown>)[key] = value;
  const billable = text(record, "billableOption");
  if (billable && BILLABLE.has(billable)) entry.billable = billable;
  const hours = num(record, "actualHours", "hours");
  if (hours !== undefined && hours >= 0 && hours < 1000) entry.hours = hours;
  const notes = typeof record.notes === "string" ? clipBlock(record.notes, CW_NOTE_MAX) : text(record, "notes");
  if (notes) entry.notes = notes;
  const link = cwRecordLink(site, "TimeEntry", entryId);
  if (link) entry.link = link;
  return entry;
}
