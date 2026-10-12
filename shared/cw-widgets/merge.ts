// The widgets of one turn, drawn together: a ticket's notes fetched by a
// second call join that ticket's card, and a record read twice shows once,
// as its latest read.

import type { CwTicket, CwWidget } from "./types.ts";

export interface CwWidgetEntry {
  /** the activity row the widget came from */
  key: string;
  widget: CwWidget;
}

function mergeTicket(base: CwTicket, next: CwTicket): CwTicket {
  const merged: CwTicket = { ...base };
  for (const [key, value] of Object.entries(next) as Array<[keyof CwTicket, unknown]>) {
    if (value === undefined || value === "") continue;
    if (key === "notes") continue;
    (merged as unknown as Record<string, unknown>)[key] = value;
  }
  if (next.notes?.length) merged.notes = next.notes;
  return merged;
}

export function mergeCwWidgets(entries: CwWidgetEntry[]): CwWidgetEntry[] {
  const out: CwWidgetEntry[] = [];
  const cardAt = new Map<number, number>();
  const listed = new Map<number, CwTicket>();
  for (const entry of entries) {
    if (entry.widget.family !== "ticket") { out.push(entry); continue; }
    if (entry.widget.view === "list") {
      for (const ticket of entry.widget.records) listed.set(ticket.id, ticket);
      out.push(entry);
      continue;
    }
    const ticket = entry.widget.records[0];
    if (!ticket) continue;
    const index = cardAt.get(ticket.id);
    if (index === undefined) {
      cardAt.set(ticket.id, out.length);
      out.push({ key: entry.key, widget: { ...entry.widget, records: [ticket] } });
      continue;
    }
    const kept = out[index]!;
    const keptTicket = kept.widget.records[0] as CwTicket;
    out[index] = {
      key: kept.key,
      widget: { ...kept.widget, ...(entry.widget.site ? { site: entry.widget.site } : {}), records: [mergeTicket(keptTicket, ticket)] },
    };
  }
  return out.map((entry) => {
    if (entry.widget.family !== "ticket" || entry.widget.view !== "card") return entry;
    const ticket = entry.widget.records[0];
    const known = ticket && !ticket.summary ? listed.get(ticket.id) : undefined;
    return known ? { ...entry, widget: { ...entry.widget, records: [mergeTicket(known, ticket)] } } : entry;
  });
}
