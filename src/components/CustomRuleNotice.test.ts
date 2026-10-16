// 2026-10-16: the rule notice and "Toujours permettre ceci" on the approval
// box (custom auto-review rules, shared/custom-rules.ts).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Bot, Message } from "@/state/store";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock("@/state/store", async (original) => ({
  ...await original<typeof import("@/state/store")>(),
  useStore: () => ({ dispatch: fixture.dispatch }),
}));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => false }));

import { CustomRuleNoticeLine, CustomRuleSavedInset, customRuleNoticeLine } from "./CustomRuleNotice";
import { pendingApprovals, PendingApprovalActions, PendingApprovalPanel } from "./PendingApproval";

const bot = { id: "bot-1", name: "Cora" } as Bot;
const notice = { id: "crule_1", when: "la lecture de fichiers dans ~/Documents", behavior: "allow" as const, botId: null };

function message(extra: Partial<NonNullable<Message["card"]>> = {}): Message {
  return {
    id: "approval-1", at: 1, role: "bot", kind: "options",
    card: { title: "Approval needed", subtitle: "{}", options: ["Allow", "Deny"], tool: "Read", requestId: "request-1", requestType: "permission", toolInput: '{"file_path":"/Users/jc/Documents/a.md"}', ...extra },
  };
}

describe("rule notice", () => {
  it("says which rule decided, in its words, with Edit rule", () => {
    expect(customRuleNoticeLine({ ...notice, outcome: "approved" })).toBe("Approved automatically by your rule");
    expect(customRuleNoticeLine({ ...notice, behavior: "deny", outcome: "denied" })).toBe("Refused by your rule");
    expect(customRuleNoticeLine({ ...notice, behavior: "ask", outcome: "held" })).toBe("Paused by your \"Ask first\" rule");
    expect(customRuleNoticeLine({ ...notice, outcome: "risk", missing: ["external-send", "money"] })).toBe("Your rule matches, but it does not cover external sends, money: approve it yourself or widen the rule.");
    const html = renderToStaticMarkup(createElement(CustomRuleNoticeLine, { notice: { ...notice, outcome: "approved" } }));
    expect(html).toContain("la lecture de fichiers dans ~/Documents");
    expect(html).toContain("Edit rule");
    expect(html).toContain('data-custom-rule-notice="approved"');
  });

  it("the saved inset names the rule", () => {
    const html = renderToStaticMarkup(createElement(CustomRuleSavedInset, { rule: { id: "crule_1", when: notice.when } }));
    expect(html).toContain("Added to your &quot;Allow&quot; rules");
    expect(html).toContain(notice.when);
  });

  it("the approval box shows the rule that held the card", () => {
    const pending = pendingApprovals([message({ customRule: { ...notice, behavior: "ask", outcome: "held" } })])[0]!;
    const html = renderToStaticMarkup(createElement(PendingApprovalPanel, { pending, count: 1, index: 0, bot }));
    expect(html).toContain('data-custom-rule-notice="held"');
  });
});

describe("Toujours permettre ceci", () => {
  const render = (extra: Partial<NonNullable<Message["card"]>> = {}) => {
    const pending = pendingApprovals([message(extra)])[0]!;
    return renderToStaticMarkup(PendingApprovalActions({ pending, bot, threadId: "thread-1", onCancelTurn: vi.fn() }));
  };

  it("is offered when the server proposes a rule for this card", () => {
    const html = render({ customRuleCandidate: { when: notice.when, risks: [] } });
    expect(html).toContain("Always allow this");
    expect(html).toContain("data-always-allow-this-button");
  });

  it("is never offered without a proposal or on an admin card", () => {
    expect(render()).not.toContain("Always allow this");
    expect(render({ adminApproval: true, customRuleCandidate: { when: notice.when, risks: [] } })).not.toContain("Always allow this");
  });
});
