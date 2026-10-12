// Local preview of the ConnectWise widgets. Actions stay on the page.
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

import "./styles.css";
import { CwWidgetView } from "./components/cw/CwWidgetView";
import type { CwPoster } from "./lib/cw-widgets";
import { cwWidgetFromToolCall } from "../shared/cw-widgets/tool-call.ts";
import { noteFrom, orderNotes } from "../shared/cw-widgets/ticket.ts";
import {
  FIXTURE_AGREEMENTS,
  FIXTURE_COMPANIES,
  FIXTURE_SCHEDULE,
  FIXTURE_TICKETS,
  FIXTURE_TICKET_NOTES,
  FIXTURE_TIME,
  fixtureQueryResult,
} from "../shared/cw-widgets/fixtures.ts";

function ticketCard() {
  const mapped = widget("service/tickets/48213", [FIXTURE_TICKETS[0]]);
  if (mapped.family !== "ticket") throw new Error("ticket");
  const notes = orderNotes(FIXTURE_TICKET_NOTES.flatMap((note) => {
    const mapped = noteFrom(note);
    return mapped ? [mapped] : [];
  }));
  mapped.records[0] = { ...mapped.records[0], notes };
  return mapped;
}

function widget(resource: string, records: unknown[]) {
  const mapped = cwWidgetFromToolCall("cw_psa__query", JSON.stringify({ resource }), fixtureQueryResult(records));
  if (!mapped) throw new Error(resource);
  return mapped;
}

const boards = [
  { skin: "pulsatrix", label: "Pulsatrix" },
  { skin: "linen", label: "Linen" },
  { skin: "foundry", label: "Foundry" },
] as const;

const askedSkin = new URLSearchParams(location.search).get("skin");
const shownBoards = boards.filter((board) => !askedSkin || board.skin === askedSkin);

function Board({ skin, label }: { skin: string; label: string }) {
  const [asked, setAsked] = useState<string[]>([]);
  const poster: CwPoster = async (_path, body) => {
    setAsked((current) => [...current, JSON.stringify(body)]);
    return { requestId: "preview" };
  };
  return (
    <section data-skin={skin} data-preview-skin={skin} className="bg-app text-ink" style={{ padding: "36px 28px 48px" }}>
      <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-tertiary">Camille · Service</div>
            <h1 className="text-[20px] font-semibold tracking-tight text-ink">Open tickets this week</h1>
          </div>
          <span className="rounded-full border border-hairline/50 bg-panel px-3 py-1 text-[11px] font-medium text-ink-secondary">{label}</span>
        </div>
        <div className="ms-auto max-w-[32rem] rounded-2xl rounded-br-md bg-bubble-user px-4 py-2.5 text-[14px] leading-snug text-ink shadow-md shadow-black/10">
          What’s open at the clinic, and who is on site this afternoon?
        </div>
        <CwWidgetView widget={widget("service/tickets", FIXTURE_TICKETS)} threadId="preview" poster={poster} />
        <div className="grid items-start gap-4" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)" }}>
          <div className="flex flex-col gap-3">
            <CwWidgetView widget={widget("time/entries", FIXTURE_TIME)} threadId="preview" poster={poster} />
            <CwWidgetView widget={widget("finance/agreements/704", [FIXTURE_AGREEMENTS[0]!])} threadId="preview" poster={poster} />
            <CwWidgetView widget={widget("company/companies/250", [FIXTURE_COMPANIES[0]!])} threadId="preview" poster={poster} />
          </div>
          <div className="flex flex-col gap-3">
            <CwWidgetView widget={ticketCard()} threadId="preview" poster={poster} />
            <CwWidgetView widget={widget("time/entries/88021", [FIXTURE_TIME[0]!])} threadId="preview" poster={poster} />
            <CwWidgetView widget={widget("schedule/entries/33011", [FIXTURE_SCHEDULE[0]!])} threadId="preview" poster={poster} />
          </div>
        </div>
        {asked.length > 0 && (
          <p data-preview-asked className="text-[12px] text-ink-secondary">{asked.length} waiting for approval</p>
        )}
      </div>
    </section>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div>
      {shownBoards.map((board) => <Board key={board.skin} skin={board.skin} label={board.label} />)}
    </div>
  </StrictMode>,
);
