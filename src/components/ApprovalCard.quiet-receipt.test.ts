// 2026-10-28: an ask nobody had to answer by hand at that moment reads as
// the call's ordinary step line ("Always allowed" and its check only in the
// details), and a card an "Ask first" rule held names that rule.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ApprovalCard, heldByRuleLine, quietApprovalReceipt } from "./ApprovalCard";
import { BotEditorStore, type Message } from "@/state/store";

const store = { dispatch: () => {} } as unknown as Parameters<typeof BotEditorStore>[0]["value"];
const render = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(createElement(BotEditorStore, { value: store, children: el }));

const card = {
  title: "Approval needed",
  options: [],
  requestId: "r1",
  requestType: "permission" as const,
  tool: "mcp__desk__view_tickets",
  mcpTool: "mcp__desk__view_tickets",
  toolInput: "{}",
};
const message = (over: Record<string, unknown>) => ({ id: "m1", role: "bot", kind: "options", card: { ...card, ...over } }) as unknown as Message;

describe("quiet approval receipt", () => {
  it("is an Always allow, a saved allow rule or the model reviewer's allow; never a person's one-time answer", () => {
    expect(quietApprovalReceipt({ answered: "allow", alwaysAllowed: "mcp:desk__view_tickets" })).toBe(true);
    expect(quietApprovalReceipt({ answered: "allow", ruleSaved: { id: "r", behavior: "allow", description: "View tickets" } })).toBe(true);
    expect(quietApprovalReceipt({ answered: "allow", answeredBy: { kind: "worker", via: "auto-review" } as never })).toBe(true);
    expect(quietApprovalReceipt({ answered: "allow" })).toBe(false);
    expect(quietApprovalReceipt({ answered: "deny", ruleSaved: { id: "r", behavior: "deny", description: "x" } })).toBe(false);
    expect(quietApprovalReceipt({ answered: "allow", alwaysAllowed: "mcp:x", undone: true })).toBe(false);
  });

  it("draws the call's own words on the line, with no Always allowed and no check; both open in the details", () => {
    const closed = render(createElement(ApprovalCard, { bot: { name: "Scout" }, message: message({ answered: "allow", ruleSaved: { id: "r", behavior: "allow", description: "View tickets" } }) }));
    expect(closed).toContain('data-testid="approval-receipt-quiet"');
    expect(closed).not.toContain("Always allowed");
    expect(closed).not.toContain("text-success");
    expect(closed).not.toContain("data-status-pill");
  });

  it("keeps the pill for a person's own answer, a refusal and an expiry", () => {
    expect(render(createElement(ApprovalCard, { bot: { name: "Scout" }, message: message({ answered: "allow" }) }))).toContain("Allowed once");
    expect(render(createElement(ApprovalCard, { bot: { name: "Scout" }, message: message({ answered: "deny" }) }))).toContain('data-status-pill="danger"');
    expect(render(createElement(ApprovalCard, { bot: { name: "Scout" }, message: message({ expired: true }) }))).toContain('data-testid="approval-receipt"');
  });
});

describe("a card an Ask first rule held", () => {
  it("names the organization's rule on its waiting line", () => {
    const notice = { id: "orule_1", when: "anything that reads the help desk", behavior: "ask" as const, botId: null, outcome: "held" as const, org: true as const };
    expect(heldByRuleLine({ customRule: notice })).toEqual({ label: "Paused by your organization's \"Ask first\" rule", target: "« anything that reads the help desk »" });
    const html = render(createElement(ApprovalCard, { bot: { name: "Scout" }, message: message({ customRule: notice }) }));
    expect(html).toContain("data-held-by-rule");
    expect(html).toContain("Paused by your organization");
    expect(html).toContain("anything that reads the help desk");
  });

  it("names the person's own Ask first rule; a plain card keeps its usual line", () => {
    const html = render(createElement(ApprovalCard, { bot: { name: "Scout" }, message: message({ heldRule: { description: "View tickets" } }) }));
    expect(html).toContain("Paused by your");
    expect(html).toContain("« View tickets »");
    expect(render(createElement(ApprovalCard, { bot: { name: "Scout" }, message: message({}) }))).toContain("Waiting for your approval");
  });
});
