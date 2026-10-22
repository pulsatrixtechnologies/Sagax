import { describe, expect, it } from "vitest";

import {
  ROUTINE_QUIET_MARKER,
  routineReportOutcome,
  routineRunReportable,
} from "./routine-report.ts";

describe("routineReportOutcome", () => {
  it("is quiet when the bot ends with the marker, and keeps the note for the logs", () => {
    expect(routineReportOutcome(`Checked 12 invoices, all have a PO.\n\n${ROUTINE_QUIET_MARKER}`))
      .toEqual({ quiet: true, report: "Checked 12 invoices, all have a PO." });
    expect(routineReportOutcome("NOTHING_TO_REPORT")).toEqual({ quiet: true, report: "" });
    // the shapes a model actually writes it in
    for (const marker of ["`NOTHING_TO_REPORT`", "**nothing_to_report**", "[NOTHING_TO_REPORT]", "nothing_to_report."]) {
      expect(routineReportOutcome(`Done.\n${marker}`).quiet, marker).toBe(true);
    }
  });

  it("is quiet when the final message is a short no-op report (JC's Carnot run)", () => {
    const carnot = "The 8:40 run is the invoicing-days boost. October 22 is outside days 1-5, so this pass ends with nothing to report.";
    expect(routineReportOutcome(carnot)).toEqual({ quiet: true, report: carnot });
    expect(routineReportOutcome("Rien à signaler.").quiet).toBe(true);
    expect(routineReportOutcome("Aucune nouvelle facture, rien à faire aujourd'hui.").quiet).toBe(true);
    expect(routineReportOutcome("No new tickets. Nothing to do.").quiet).toBe(true);
  });

  it("is quiet when nothing was said at all", () => {
    expect(routineReportOutcome(undefined).quiet).toBe(true);
    expect(routineReportOutcome("   ").quiet).toBe(true);
  });

  it("reports a result, a question or a long report even when it mentions nothing to report", () => {
    expect(routineReportOutcome("3 invoices without a PO: #1201, #1207, #1210. I drafted the reminders.")).toEqual({
      quiet: false,
      report: "3 invoices without a PO: #1201, #1207, #1210. I drafted the reminders.",
    });
    // a question needs the person
    expect(routineReportOutcome("Nothing to report on Carnot, but should I also check Alubar?").quiet).toBe(false);
    // a long report that happens to contain the words is still a report
    const long = `${"Ticket #4410 moved to Waiting on client; ".repeat(12)}nothing to report otherwise.`;
    expect(routineReportOutcome(long).quiet).toBe(false);
    // the marker in the middle of a sentence is not the marker
    expect(routineReportOutcome("Found 2 issues. I did not write NOTHING_TO_REPORT because there is work.").quiet).toBe(false);
  });

  it("a routine that asks to stay silent lets a longer no-op report stay quiet", () => {
    const report = `Checked the Carnot board: ${"every open invoice already has a PO, ".repeat(6)}so nothing to report.`;
    expect(report.length).toBeGreaterThan(240);
    expect(routineReportOutcome(report).quiet).toBe(false);
    expect(routineReportOutcome(report, "Run the skill exactly as written ... silent if 0").quiet).toBe(true);
    expect(routineReportOutcome(report, "Vérifie les factures, reste silencieux s'il n'y a rien").quiet).toBe(true);
  });
});

describe("routineRunReportable", () => {
  it("never posts while a run is queued or running, nor when it ends with nothing to report", () => {
    for (const status of ["queued", "running", "cancelled", "missed", "nothing_to_report"] as const) {
      expect(routineRunReportable({ status }), status).toBe(false);
    }
    expect(routineRunReportable({ status: "completed", quiet: true })).toBe(false);
    expect(routineRunReportable({ status: "completed", goalStatus: "completed", quiet: true })).toBe(false);
  });

  it("posts a result, an error, and a wait on the person", () => {
    expect(routineRunReportable({ status: "completed" })).toBe(true);
    expect(routineRunReportable({ status: "failed" })).toBe(true);
    expect(routineRunReportable({ status: "waiting", needsPerson: true })).toBe(true);
    expect(routineRunReportable({ status: "waiting", goalStatus: "needs-input" })).toBe(true);
  });

  it("a wait on delegated work or a usage limit is not the person's", () => {
    expect(routineRunReportable({ status: "waiting" })).toBe(false);
    expect(routineRunReportable({ status: "waiting", goalStatus: "paused" })).toBe(false);
  });
});
