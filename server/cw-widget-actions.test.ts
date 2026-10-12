import { describe, expect, it } from "vitest";

import { autoVerdict } from "./auto-approve.ts";
import { CW_ACTION_PASS_MS, cwActionCard, cwActionLanguage, cwToolWidget, createCwActionPasses } from "./cw-widget-actions.ts";
import { withoutPrivateFields } from "./harness/bus.ts";
import { FIXTURE_TICKETS, fixtureMcpContent, fixtureQueryResult } from "../shared/cw-widgets/fixtures.ts";
import type { CwAction } from "../shared/cw-widgets/actions.ts";
import type { RuntimeEvent } from "../shared/runtime-events.ts";

const status: CwAction = { kind: "ticket.status", ticketId: 48213, status: "Résolu", from: "En cours" };
const note: CwAction = { kind: "ticket.note", ticketId: 48150, text: "Accès créé, mot de passe envoyé par texto.", internal: true };

const writeInput = (value: unknown) => JSON.stringify(value);

describe("ConnectWise widget passes", () => {
  it("lets the allowed write through once, for that record only", () => {
    const passes = createCwActionPasses();
    passes.grant("t1", status);
    expect(passes.take("t1", "mcp__perspicax_x__cw_psa__query", writeInput({ resource: "service/tickets/48213" }))).toBeNull();
    expect(passes.take("t1", "cw_psa__write", writeInput({ resource: "service/tickets/48214", body: [{ path: "status" }] }))).toBeNull();
    expect(passes.take("t2", "cw_psa__write", writeInput({ resource: "service/tickets/48213", body: [{ path: "status" }] }))).toBeNull();
    expect(passes.take("t1", "cw_psa__write", writeInput({ resource: "service/tickets/48213/notes", body: { text: "x" } }))).toBeNull();
    const input = writeInput({ resource: "service/tickets/48213", operation: "patch", body: [{ op: "replace", path: "status", value: { name: "Résolu" } }] });
    expect(passes.take("t1", "mcp__perspicax_x__cw_psa__write", input)).toEqual(status);
    expect(passes.take("t1", "mcp__perspicax_x__cw_psa__write", input)).toBeNull();
  });

  it("does not take a longer number that contains the record id", () => {
    const passes = createCwActionPasses();
    passes.grant("t1", note);
    expect(passes.take("t1", "cw_psa__write", writeInput({ resource: "service/tickets/481501/notes", text: "x" }))).toBeNull();
    expect(passes.take("t1", "cw_psa__write", writeInput({ resource: "service/tickets/48150/notes", text: "x" }))).toEqual(note);
  });

  it("does not spend a time-entry pass on a ticket write that shares the id", () => {
    const passes = createCwActionPasses();
    const billable: CwAction = { kind: "time.billable", entryId: 48213, billable: "DoNotBill", from: "Billable" };
    passes.grant("t1", billable);
    expect(passes.take("t1", "cw_psa__write", writeInput({ resource: "service/tickets/48213", body: [{ path: "status" }] }))).toBeNull();
    expect(passes.take("t1", "cw_psa__write", writeInput({ resource: "time/entries/48213", body: [{ path: "billableOption", value: "DoNotBill" }] }))).toEqual(billable);
  });

  it("lapses after ten minutes and can be withdrawn", () => {
    let clock = 1_000;
    const passes = createCwActionPasses(() => clock);
    passes.grant("t1", status);
    passes.grant("t1", note);
    expect(passes.size()).toBe(2);
    passes.revoke("t1", note);
    expect(passes.size()).toBe(1);
    clock += CW_ACTION_PASS_MS + 1;
    expect(passes.size()).toBe(0);
    expect(passes.take("t1", "cw_psa__write", writeInput({ resource: "service/tickets/48213", path: "status" }))).toBeNull();
  });

  it("is a person's approval: auto-approves even in Ask, never a question", () => {
    expect(autoVerdict("ask", "mcp__perspicax_x__cw_psa__write", { widgetApproved: true })).toMatchObject({ source: "widget-approval" });
    expect(autoVerdict("ask", "mcp__perspicax_x__cw_psa__write", {}).approve).toBeNull();
    expect(autoVerdict("full", "AskUserQuestion", { widgetApproved: true }).approve).toBeNull();
  });
});

describe("ConnectWise widget cards", () => {
  it("describes the write in the person's language", () => {
    const card = cwActionCard(status, "fr", "p-1");
    expect(card.requestId).toMatch(/^cwact-/);
    expect(card.summary).toBe("Changer le statut du billet #48213 de « En cours » à « Résolu »");
    expect(JSON.parse(card.toolInput)).toEqual({
      resource: "service/tickets/48213",
      operation: "patch",
      body: [{ op: "replace", path: "status", value: { name: "Résolu" } }],
    });
    expect(card.cwActionRequest).toEqual({ id: card.requestId, action: status, by: "p-1" });
    expect(cwActionCard(note, "en", "p-1").summary).toBe("Add an internal note to ticket #48150");
    expect(cwActionLanguage("fr-CA")).toBe("fr");
    expect(cwActionLanguage(undefined)).toBe("en");
  });
});

describe("ConnectWise tool results", () => {
  it("maps a completed query to a widget and keeps the raw result out of logs", () => {
    const resultText = fixtureMcpContent(JSON.parse(fixtureQueryResult(FIXTURE_TICKETS.slice(0, 2))));
    const widget = cwToolWidget("mcp__perspicax_x__cw_psa__query", JSON.stringify({ resource: "service/tickets" }), resultText);
    expect(widget).toMatchObject({ family: "ticket", view: "list" });
    expect(widget && widget.records.map((ticket) => ticket.id)).toEqual([48213, 48197]);
    expect(cwToolWidget("Bash", undefined, resultText)).toBeNull();

    const event = {
      type: "item.completed", itemType: "tool", itemId: "i", ok: true, resultText,
      eventId: "e", provider: "claudeAgent", providerInstanceId: "x", threadId: "t", createdAt: "2026-10-12T00:00:00Z",
    } as unknown as RuntimeEvent;
    const logged = withoutPrivateFields(event);
    expect(logged).not.toHaveProperty("resultText");
    expect(event).toHaveProperty("resultText");
  });
});
