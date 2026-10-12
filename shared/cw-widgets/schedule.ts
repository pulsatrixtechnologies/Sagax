// Dispatch calendar blocks.

import type { CwScheduleEntry, CwSite } from "./types.ts";
import { bool, date, id, num, text, type CwRecord } from "./read.ts";
import { cwRecordLink } from "./links.ts";

export function looksLikeSchedule(record: CwRecord): boolean {
  if (!id(record)) return false;
  if ("billableOption" in record || "timeStart" in record || "actualHours" in record || "chargeToId" in record) return false;
  return "dateStart" in record || "doneFlag" in record;
}

export function scheduleFrom(record: CwRecord, site: CwSite | undefined): CwScheduleEntry | undefined {
  const entryId = id(record);
  const name = text(record, "name", "span") ?? (entryId ? `Schedule #${entryId}` : undefined);
  if (!entryId || !name) return undefined;
  const entry: CwScheduleEntry = { id: entryId, name };
  const objectId = id(record, "objectId", "ticket.id");
  if (objectId) entry.objectId = objectId;
  const fields: Array<[keyof CwScheduleEntry, string | undefined]> = [
    ["member", text(record, "member.name", "member")],
    ["company", text(record, "company.name", "company")],
    ["type", text(record, "type.name", "type")],
    ["where", text(record, "where.name", "where")],
    ["status", text(record, "status.name", "status")],
    ["start", date(record, "dateStart")],
    ["end", date(record, "dateEnd")],
  ];
  for (const [key, value] of fields) if (value) (entry as unknown as Record<string, unknown>)[key] = value;
  const hours = num(record, "hours");
  if (hours !== undefined && hours >= 0 && hours < 1000) entry.hours = hours;
  const done = bool(record, "doneFlag", "done");
  if (done !== undefined) entry.done = done;
  const link = cwRecordLink(site, "ActivityFv", entryId);
  if (link) entry.link = link;
  return entry;
}
