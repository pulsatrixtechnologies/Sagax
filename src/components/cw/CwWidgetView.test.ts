// The widget draws records and asks Sagax for an approval card. It never
// calls ConnectWise.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ChatMarkdown } from "../ChatMarkdown";
import { CwWidgetView } from "./CwWidgetView";
import { postCwWidgetAction } from "@/lib/cw-widgets";
import { cwWidgetFromToolCall } from "../../../shared/cw-widgets/tool-call.ts";
import { FIXTURE_COMPANIES, FIXTURE_TICKETS, fixtureQueryResult } from "../../../shared/cw-widgets/fixtures.ts";
import type { CwAction } from "../../../shared/cw-widgets/actions.ts";

const tickets = cwWidgetFromToolCall(
  "cw_psa__query",
  JSON.stringify({ resource: "service/tickets" }),
  fixtureQueryResult(FIXTURE_TICKETS),
)!;

describe("ConnectWise widget", () => {
  it("draws a ticket table and a card whose changes are approval actions", () => {
    const html = renderToStaticMarkup(createElement(CwWidgetView, { widget: tickets, threadId: "thread-1", botId: "bot-1" }));
    expect(html).toContain('data-cw-widget="ticket"');
    expect(html).toContain("Imprimante du 2e étage hors ligne");
    expect(html).toContain("Open only");
    expect(html).not.toContain("myconnectwise.net/v4_6_release/apis");
    expect(html).not.toContain("<form");

    const card = cwWidgetFromToolCall(
      "cw_psa__query",
      JSON.stringify({ resource: "service/tickets/48213" }),
      fixtureQueryResult([FIXTURE_TICKETS[0]]),
    )!;
    const cardHtml = renderToStaticMarkup(createElement(CwWidgetView, { widget: card, threadId: "thread-1", botId: "bot-1" }));
    expect(cardHtml).toContain("Update status");
    expect(cardHtml).toContain("Add a note");
    expect(cardHtml).not.toContain("<form");
  });

  it("renders a ```cw fence through the chat markdown", () => {
    const company = cwWidgetFromToolCall(
      "cw_psa__query",
      JSON.stringify({ resource: "company/companies/250" }),
      fixtureQueryResult([FIXTURE_COMPANIES[0]]),
    )!;
    const html = renderToStaticMarkup(createElement(ChatMarkdown, {
      text: "Here:\n\n```cw\n" + JSON.stringify(company) + "\n```",
      botId: "bot-1",
      message: { threadId: "thread-1", messageId: "m1" },
    }));
    expect(html).toContain('data-cw-widget="company"');
    expect(html).toContain("Clinique vétérinaire Beauport");
    expect(html).not.toContain("http://bois.example");
  });

  it("posts the approval request to Sagax and nowhere else", async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const action: CwAction = { kind: "schedule.done", entryId: 33011, done: true };
    await postCwWidgetAction("thread 1", action, "bot-1", async (path, body) => {
      calls.push({ path, body });
      if (/connectwise|myconnectwise/i.test(path)) throw new Error("wrote to ConnectWise");
      return { requestId: "cwact-1" };
    });
    expect(calls).toEqual([{
      path: "/api/threads/thread%201/cw-actions",
      body: { action, botId: "bot-1" },
    }]);
  });
});
