// Service tickets: the card, the list and the notes timeline.

import { CW_MAX_NOTES, CW_NOTE_MAX, type CwTicket, type CwTicketNote } from "./types.ts";
import { bool, clipBlock, date, id, isRecord, num, text, type CwRecord } from "./read.ts";
import { cwRecordLink } from "./links.ts";
import type { CwSite } from "./types.ts";

export function looksLikeTicket(record: CwRecord): boolean {
  if (!id(record)) return false;
  if (typeof record.summary !== "string") return false;
  return "board" in record || "status" in record || "priority" in record || "recordType" in record;
}

export function ticketFrom(record: CwRecord, site: CwSite | undefined): CwTicket | undefined {
  const ticketId = id(record);
  const summary = text(record, "summary");
  if (!ticketId || !summary) return undefined;
  const ticket: CwTicket = { id: ticketId, summary };
  const fields: Array<[keyof CwTicket, string | undefined]> = [
    ["status", text(record, "status", "statusName")],
    ["priority", text(record, "priority", "priorityName")],
    ["company", text(record, "company.name", "companyName", "company")],
    ["contact", text(record, "contactName", "contact")],
    ["board", text(record, "board", "boardName")],
    ["type", text(record, "type", "typeName")],
    ["owner", text(record, "owner.name", "owner", "ownerName")],
    ["resources", text(record, "resources")],
    ["entered", date(record, "dateEntered", "_info.dateEntered")],
    ["updated", date(record, "lastUpdated", "_info.lastUpdated")],
    ["due", date(record, "requiredDate")],
  ];
  for (const [key, value] of fields) if (value) (ticket as unknown as Record<string, unknown>)[key] = value;
  const budget = num(record, "budgetHours");
  if (budget !== undefined) ticket.budgetHours = budget;
  const actual = num(record, "actualHours");
  if (actual !== undefined) ticket.actualHours = actual;
  const closed = bool(record, "closedFlag");
  if (closed !== undefined) ticket.closed = closed;
  if (record.recordType === "ProjectTicket" || record.recordType === "ProjectIssue") ticket.recordType = "ProjectTicket";
  else if (record.recordType === "ServiceTicket") ticket.recordType = "ServiceTicket";
  const link = cwRecordLink(site, "ServiceFv", ticketId);
  if (link) ticket.link = link;
  return ticket;
}

export function looksLikeNote(record: CwRecord): boolean {
  return typeof record.text === "string"
    && ("ticketId" in record || "detailDescriptionFlag" in record || "internalAnalysisFlag" in record
      || "resolutionFlag" in record || "noteType" in record || "isInternalFlag" in record);
}

export function noteFrom(record: CwRecord): CwTicketNote | undefined {
  const raw = typeof record.text === "string" ? clipBlock(record.text, CW_NOTE_MAX) : "";
  if (!raw) return undefined;
  const note: CwTicketNote = { text: raw };
  const noteId = id(record);
  if (noteId) note.id = noteId;
  const by = text(record, "member.name", "member", "contact.name", "contact", "createdBy", "_info.updatedBy");
  if (by) note.by = by;
  const when = date(record, "dateCreated", "timeStart", "_info.dateEntered", "_info.lastUpdated");
  if (when) note.at = when;
  if (bool(record, "internalAnalysisFlag", "isInternalFlag", "internalFlag")) note.internal = true;
  if (bool(record, "resolutionFlag")) note.resolution = true;
  return note;
}

export function ticketIdOfNote(record: CwRecord): number | undefined {
  return id(record, "ticketId", "ticket.id");
}

/** Newest first, at most CW_MAX_NOTES, one per id. */
export function orderNotes(notes: CwTicketNote[]): CwTicketNote[] {
  const seen = new Set<number>();
  const kept = notes.filter((note) => {
    if (note.id === undefined) return true;
    if (seen.has(note.id)) return false;
    seen.add(note.id);
    return true;
  });
  return kept
    .map((note, index) => ({ note, index, time: note.at ? Date.parse(note.at) : Number.NaN }))
    .sort((a, b) => {
      const at = Number.isFinite(a.time), bt = Number.isFinite(b.time);
      if (at && bt && a.time !== b.time) return b.time - a.time;
      if (at !== bt) return at ? -1 : 1;
      return a.index - b.index;
    })
    .map((entry) => entry.note)
    .slice(0, CW_MAX_NOTES);
}

export type TicketSortKey = "id" | "summary" | "status" | "priority" | "company" | "updated";

export interface TicketFilter {
  query?: string;
  status?: string;
  priority?: string;
  board?: string;
  company?: string;
  openOnly?: boolean;
}

export interface TicketSort {
  key: TicketSortKey;
  dir: "asc" | "desc";
}

/** "Priority 1 - Critical" sorts before "Priority 3 - Normal". */
function priorityRank(priority: string | undefined): number {
  const match = priority ? /(\d+)/.exec(priority) : null;
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

export function filterSortTickets(tickets: CwTicket[], filter: TicketFilter, sort: TicketSort): CwTicket[] {
  const query = filter.query?.trim().toLocaleLowerCase();
  const kept = tickets.filter((ticket) => {
    if (filter.status && ticket.status !== filter.status) return false;
    if (filter.priority && ticket.priority !== filter.priority) return false;
    if (filter.board && ticket.board !== filter.board) return false;
    if (filter.company && ticket.company !== filter.company) return false;
    if (filter.openOnly && ticket.closed) return false;
    if (query) {
      const haystack = [String(ticket.id), ticket.summary, ticket.company, ticket.contact, ticket.status, ticket.board, ticket.owner]
        .filter(Boolean).join(" ").toLocaleLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
  const sign = sort.dir === "asc" ? 1 : -1;
  const compareText = (a?: string, b?: string) => {
    if (!a && !b) return 0;
    if (!a) return 1;
    if (!b) return -1;
    return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }) * sign;
  };
  return kept
    .map((ticket, index) => ({ ticket, index }))
    .sort((left, right) => {
      const a = left.ticket, b = right.ticket;
      let order = 0;
      switch (sort.key) {
        case "id": order = (a.id - b.id) * sign; break;
        case "summary": order = compareText(a.summary, b.summary); break;
        case "status": order = compareText(a.status, b.status); break;
        case "company": order = compareText(a.company, b.company); break;
        case "priority": order = (priorityRank(a.priority) - priorityRank(b.priority)) * sign; break;
        case "updated": {
          const at = Date.parse(a.updated ?? a.entered ?? ""), bt = Date.parse(b.updated ?? b.entered ?? "");
          if (Number.isFinite(at) && Number.isFinite(bt)) order = (at - bt) * sign;
          else if (Number.isFinite(at) !== Number.isFinite(bt)) order = Number.isFinite(at) ? -1 : 1;
          break;
        }
      }
      return order || left.index - right.index;
    })
    .map((entry) => entry.ticket);
}

/** Distinct values of one field, for the list's filter menus. */
export function ticketFacet(tickets: CwTicket[], key: "status" | "priority" | "board" | "company"): string[] {
  const values = new Set<string>();
  for (const ticket of tickets) {
    const value = ticket[key];
    if (value) values.add(value);
  }
  const list = [...values];
  return key === "priority"
    ? list.sort((a, b) => priorityRank(a) - priorityRank(b) || a.localeCompare(b))
    : list.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }));
}

export function isTicketWidgetRecord(value: unknown): value is CwTicket {
  return isRecord(value) && typeof value.id === "number" && typeof value.summary === "string";
}
