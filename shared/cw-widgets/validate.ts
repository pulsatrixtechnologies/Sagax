// A widget that arrives as text (a ```cw fence, a Claude-style artifact of
// type application/vnd.sagax.cw+json, a stored message) is read field by
// field: only the known fields, with their types, clipped. Anything else is
// dropped, so a model's output can never put markup, a script or a foreign
// link in a widget.

import {
  CW_MAX_NOTES,
  CW_MAX_RECORDS,
  CW_NOTE_MAX,
  CW_WIDGET_VERSION,
  type CwAgreement,
  type CwCompany,
  type CwScheduleEntry,
  type CwSite,
  type CwTicket,
  type CwTicketNote,
  type CwTimeEntry,
  type CwWidget,
} from "./types.ts";
import { bool, clipBlock, date, id, isRecord, num, text, type CwRecord } from "./read.ts";
import { cwRecordLink, cwSite, safeCwLink, type CwRecordType } from "./links.ts";
import { looksLikeTicket, orderNotes, ticketFrom } from "./ticket.ts";
import { looksLikeTime, timeFrom } from "./time.ts";
import { looksLikeSchedule, scheduleFrom } from "./schedule.ts";
import { agreementFrom, looksLikeAgreement } from "./agreement.ts";
import { companyFrom, looksLikeCompany, safeWebsite } from "./company.ts";
import { CW_BILLABLE } from "./actions.ts";
import { CW_FAMILIES, CW_REQUIRED_FIELDS, cwOrList, isCwFamily } from "./schema.ts";

function siteOf(value: unknown): CwSite | undefined {
  return isRecord(value) ? cwSite(value.host, value.company) : undefined;
}

function noteOf(value: unknown): CwTicketNote | undefined {
  if (!isRecord(value) || typeof value.text !== "string") return undefined;
  const body = clipBlock(value.text, CW_NOTE_MAX);
  if (!body) return undefined;
  const note: CwTicketNote = { text: body };
  const noteId = id(value);
  if (noteId) note.id = noteId;
  const by = text(value, "by");
  if (by) note.by = by;
  const at = date(value, "at");
  if (at) note.at = at;
  if (bool(value, "internal")) note.internal = true;
  if (bool(value, "resolution")) note.resolution = true;
  return note;
}

const TICKET_TEXT = ["status", "priority", "company", "contact", "board", "type", "owner", "resources"] as const;
const TICKET_DATES = ["entered", "updated", "due"] as const;

export function sanitizeTicket(value: unknown, site: CwSite | undefined): CwTicket | undefined {
  if (!isRecord(value)) return undefined;
  const record: CwRecord = value;
  // Raw ConnectWise records are welcome too: the normalizer reads them.
  if (looksLikeTicket(record) && (isRecord(record.status) || isRecord(record.board) || isRecord(record.company))) {
    return ticketFrom(record, site);
  }
  const ticketId = id(record);
  if (!ticketId) return undefined;
  const ticket: CwTicket = { id: ticketId, summary: text(record, "summary") ?? "" };
  for (const key of TICKET_TEXT) {
    const found = text(record, key);
    if (found) ticket[key] = found;
  }
  for (const key of TICKET_DATES) {
    const found = date(record, key);
    if (found) ticket[key] = found;
  }
  const budget = num(record, "budgetHours");
  if (budget !== undefined && budget >= 0) ticket.budgetHours = budget;
  const actual = num(record, "actualHours");
  if (actual !== undefined && actual >= 0) ticket.actualHours = actual;
  const closed = bool(record, "closed");
  if (closed !== undefined) ticket.closed = closed;
  if (record.recordType === "ServiceTicket" || record.recordType === "ProjectTicket") ticket.recordType = record.recordType;
  if (Array.isArray(record.notes)) {
    const notes = record.notes.slice(0, CW_MAX_NOTES * 2).map(noteOf).filter((note): note is CwTicketNote => Boolean(note));
    if (notes.length) ticket.notes = orderNotes(notes);
  }
  const link = keptLink(record.link, site, "ServiceFv", ticketId);
  if (link) ticket.link = link;
  return ticket;
}

const BILLABLE = new Set<string>(CW_BILLABLE);

function keptLink(value: unknown, site: CwSite | undefined, recordType: CwRecordType, recordId: number): string | undefined {
  return safeCwLink(value) ?? cwRecordLink(site, recordType, recordId);
}

function hoursOf(record: CwRecord, ...paths: string[]): number | undefined {
  const hours = num(record, ...paths);
  return hours !== undefined && hours >= 0 && hours < 1000 ? hours : undefined;
}

export function sanitizeTimeEntry(value: unknown, site: CwSite | undefined): CwTimeEntry | undefined {
  if (!isRecord(value)) return undefined;
  const record: CwRecord = value;
  if (looksLikeTime(record) && ("billableOption" in record || "timeStart" in record || "chargeToId" in record || isRecord(record.company) || isRecord(record.member))) {
    return timeFrom(record, site);
  }
  const entryId = id(record);
  if (!entryId) return undefined;
  const entry: CwTimeEntry = { id: entryId };
  const charge = text(record, "charge");
  if (charge) entry.charge = charge;
  const chargeToId = id(record, "chargeToId");
  if (chargeToId) entry.chargeToId = chargeToId;
  for (const key of ["company", "member", "workType", "workRole", "status", "agreement"] as const) {
    const found = text(record, key);
    if (found) entry[key] = found;
  }
  const billable = text(record, "billable");
  if (billable && BILLABLE.has(billable)) entry.billable = billable;
  const hours = hoursOf(record, "hours");
  if (hours !== undefined) entry.hours = hours;
  const notes = typeof record.notes === "string" ? clipBlock(record.notes, CW_NOTE_MAX) : text(record, "notes");
  if (notes) entry.notes = notes;
  const start = date(record, "start");
  if (start) entry.start = start;
  const end = date(record, "end");
  if (end) entry.end = end;
  const link = keptLink(record.link, site, "TimeEntry", entryId);
  if (link) entry.link = link;
  return entry;
}

export function sanitizeScheduleEntry(value: unknown, site: CwSite | undefined): CwScheduleEntry | undefined {
  if (!isRecord(value)) return undefined;
  const record: CwRecord = value;
  if (looksLikeSchedule(record) && ("dateStart" in record || "doneFlag" in record || isRecord(record.where) || isRecord(record.member))) {
    return scheduleFrom(record, site);
  }
  const entryId = id(record);
  const name = text(record, "name");
  if (!entryId || !name) return undefined;
  const entry: CwScheduleEntry = { id: entryId, name };
  const objectId = id(record, "objectId");
  if (objectId) entry.objectId = objectId;
  for (const key of ["member", "company", "type", "where", "status"] as const) {
    const found = text(record, key);
    if (found) entry[key] = found;
  }
  const start = date(record, "start");
  if (start) entry.start = start;
  const end = date(record, "end");
  if (end) entry.end = end;
  const hours = hoursOf(record, "hours");
  if (hours !== undefined) entry.hours = hours;
  const done = bool(record, "done");
  if (done !== undefined) entry.done = done;
  const link = keptLink(record.link, site, "ActivityFv", entryId);
  if (link) entry.link = link;
  return entry;
}

export function sanitizeAgreement(value: unknown, site: CwSite | undefined): CwAgreement | undefined {
  if (!isRecord(value)) return undefined;
  const record: CwRecord = value;
  if (looksLikeAgreement(record) && ("agreementStatus" in record || "cancelledFlag" in record || "startDate" in record || isRecord(record.company))) {
    return agreementFrom(record, site);
  }
  const agreementId = id(record);
  const name = text(record, "name");
  if (!agreementId || !name) return undefined;
  const agreement: CwAgreement = { id: agreementId, name };
  for (const key of ["company", "type", "status", "cycle"] as const) {
    const found = text(record, key);
    if (found) agreement[key] = found;
  }
  const start = date(record, "start");
  if (start) agreement.start = start;
  const end = date(record, "end");
  if (end) agreement.end = end;
  const amount = num(record, "billAmount");
  if (amount !== undefined && amount >= 0 && amount < 1e12) agreement.billAmount = amount;
  const cancelled = bool(record, "cancelled");
  if (cancelled !== undefined) agreement.cancelled = cancelled;
  const link = keptLink(record.link, site, "AgreementFv", agreementId);
  if (link) agreement.link = link;
  return agreement;
}

export function sanitizeCompany(value: unknown, site: CwSite | undefined): CwCompany | undefined {
  if (!isRecord(value)) return undefined;
  const record: CwRecord = value;
  if (looksLikeCompany(record) && ("phoneNumber" in record || isRecord(record.status) || isRecord(record.territory))) {
    return companyFrom(record, site);
  }
  const companyId = id(record);
  const name = text(record, "name");
  if (!companyId || !name) return undefined;
  const company: CwCompany = { id: companyId, name };
  for (const key of ["identifier", "status", "type", "phone", "city", "territory"] as const) {
    const found = text(record, key);
    if (found) company[key] = found;
  }
  const website = safeWebsite(record.website);
  if (website) company.website = website;
  const link = keptLink(record.link, site, "CompanyFv", companyId);
  if (link) company.link = link;
  return company;
}

function finishFamily<T>(
  family: CwWidget["family"],
  records: T[],
  value: CwRecord,
  site: CwSite | undefined,
): CwWidget | null {
  if (records.length === 0) return null;
  const view = value.view === "card" || value.view === "list" ? value.view : records.length === 1 ? "card" : "list";
  const total = num(value, "total");
  const widget = { v: CW_WIDGET_VERSION, family, view, records, ...(site ? { site } : {}) } as CwWidget;
  if (total !== undefined && Number.isInteger(total) && total > records.length) widget.total = total;
  return widget;
}

export function sanitizeCwWidget(value: unknown): CwWidget | null {
  if (!isRecord(value)) return null;
  if (value.v !== undefined && value.v !== CW_WIDGET_VERSION) return null;
  if (!Array.isArray(value.records)) return null;
  const site = siteOf(value.site);
  switch (value.family) {
    case "ticket":
      return finishFamily("ticket", value.records.slice(0, CW_MAX_RECORDS).map((record) => sanitizeTicket(record, site)).filter((row): row is CwTicket => Boolean(row)), value, site);
    case "time":
      return finishFamily("time", value.records.slice(0, CW_MAX_RECORDS).map((record) => sanitizeTimeEntry(record, site)).filter((row): row is CwTimeEntry => Boolean(row)), value, site);
    case "schedule":
      return finishFamily("schedule", value.records.slice(0, CW_MAX_RECORDS).map((record) => sanitizeScheduleEntry(record, site)).filter((row): row is CwScheduleEntry => Boolean(row)), value, site);
    case "agreement":
      return finishFamily("agreement", value.records.slice(0, CW_MAX_RECORDS).map((record) => sanitizeAgreement(record, site)).filter((row): row is CwAgreement => Boolean(row)), value, site);
    case "company":
      return finishFamily("company", value.records.slice(0, CW_MAX_RECORDS).map((record) => sanitizeCompany(record, site)).filter((row): row is CwCompany => Boolean(row)), value, site);
    default:
      return null;
  }
}

/** A ```cw fence's text, or an artifact's content. */
export function parseCwWidgetText(source: string): CwWidget | null {
  if (source.length > 1_000_000) return null;
  try {
    return sanitizeCwWidget(JSON.parse(source));
  } catch {
    return null;
  }
}

/** Why a ```cw fence's text drew nothing: "json" (not a JSON object),
 * "version", "records" (no records array), "family" (unknown family) or
 * "empty" (no record kept, each needs the family's required fields). */
export interface CwWidgetRejection {
  reason: "json" | "version" | "records" | "family" | "empty";
  /** the family the text named, for "family" and "empty" */
  family?: string;
}

/** The reason parseCwWidgetText returns null for this text, or null when it
 * draws. */
export function cwWidgetRejection(source: string): CwWidgetRejection | null {
  if (parseCwWidgetText(source)) return null;
  let value: unknown;
  try {
    value = source.length > 1_000_000 ? undefined : JSON.parse(source);
  } catch {
    value = undefined;
  }
  if (!isRecord(value)) return { reason: "json" };
  if (value.v !== undefined && value.v !== CW_WIDGET_VERSION) return { reason: "version" };
  const family = typeof value.family === "string" ? value.family.slice(0, 40) : String(value.family ?? "").slice(0, 40);
  if (!isCwFamily(value.family)) return { reason: "family", family };
  if (!Array.isArray(value.records)) return { reason: "records", family };
  return { reason: "empty", family };
}

/** The rejection in English, as the bot should read it. */
export function cwWidgetRejectionText(rejection: CwWidgetRejection): string {
  switch (rejection.reason) {
    case "json":
      return "the fence must hold one JSON object";
    case "version":
      return `only version ${CW_WIDGET_VERSION} is supported`;
    case "records":
      return "records must be an array";
    case "family":
      return `unknown family "${rejection.family ?? ""}"; use ${cwOrList(CW_FAMILIES)}`;
    case "empty": {
      const required = isCwFamily(rejection.family) ? CW_REQUIRED_FIELDS[rejection.family] : ["id"];
      return `no usable record; each ${rejection.family ?? ""} record needs ${cwOrList(required, "and")}`;
    }
  }
}
