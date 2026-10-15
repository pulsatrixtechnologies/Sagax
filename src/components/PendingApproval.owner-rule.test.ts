// 2026-10-14 (bot owner permissions): a card of the owner route offers
// Deny, Always deny, Always allow and Allow once; the two "Always" save the
// owner's rule with the answer.
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Message } from "@/state/store";

const fixture = vi.hoisted(() => ({ admin: true as boolean | null, dispatch: vi.fn() }));
vi.mock("@/state/store", async (original) => ({
  ...await original<typeof import("@/state/store")>(),
  useStore: () => ({ dispatch: fixture.dispatch }),
}));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => fixture.admin }));

import { pendingApprovals, PendingApprovalActions } from "./PendingApproval";
import { approvalPill } from "./ApprovalCard";

const bot = { id: "bot-1", name: "Cora" } as Bot;
const ownerRule = { tool: "perspicax_gox__cw_psa__write", scope: { resource: "service/tickets", operation: "update" }, description: "Update tickets in ConnectWise PSA (service/tickets, update)" };
function message(extra: Partial<NonNullable<Message["card"]>> = {}): Message {
  return {
    id: "approval-1", at: 1, role: "bot", kind: "options",
    card: { title: "Approval needed", subtitle: "{}", options: ["Allow", "Deny"], tool: "mcp__perspicax_gox__cw_psa__write",
      requestId: "request-1", allowKey: "mcp:perspicax_gox__cw_psa__write", ownerRule, ...extra },
  };
}
type Node = ReactElement<{ children?: ReactNode; onClick?: () => void }>;
function nodes(value: ReactNode): Node[] {
  if (!isValidElement(value)) return [];
  const node = value as Node;
  return [node, ...Children.toArray(node.props.children).flatMap(nodes)];
}
function view(extra: Partial<NonNullable<Message["card"]>> = {}) {
  const pending = pendingApprovals([message(extra)])[0]!;
  const tree = PendingApprovalActions({ pending, bot, threadId: "thread-1", onCancelTurn: vi.fn() });
  return { html: renderToStaticMarkup(tree), buttons: nodes(tree).filter((node) => node.type === "button") };
}
const click = (result: ReturnType<typeof view>, label: string) => result.buttons.find((button) => button.props.children === label)!.props.onClick!();

beforeEach(() => { fixture.admin = false; fixture.dispatch.mockReset(); });

describe("owner rule buttons", () => {
  it("offers Deny, Always deny, Always allow and Allow once, and no older grant", () => {
    const result = view();
    const labels = result.buttons.map((button) => button.props.children);
    expect(labels).toEqual(expect.arrayContaining(["Deny", "Always deny", "Always allow", "Allow once"]));
    expect(result.buttons.filter((button) => button.props.children === "Always allow")).toHaveLength(1);
  });

  it("Always allow and Always deny save the rule with the answer; Allow once and Deny save nothing", () => {
    const result = view();
    click(result, "Always allow");
    expect(fixture.dispatch).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: "allow", rule: "allow", alwaysAllow: undefined }));
    click(result, "Always deny");
    expect(fixture.dispatch).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: "deny", rule: "deny" }));
    click(result, "Allow once");
    expect(fixture.dispatch).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: "allow", rule: undefined }));
    click(result, "Deny");
    expect(fixture.dispatch).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: "deny", rule: undefined }));
  });

  it("says a destructive call needs a rule of its own", () => {
    expect(view({ ownerRule: { ...ownerRule, destructive: "delete" } }).html).toContain("only a rule made for it can allow it");
  });

  it("an admin card offers no rule, and its owner only waits", () => {
    const result = view({ adminApproval: true });
    expect(result.buttons.map((button) => button.props.children)).not.toContain("Always deny");
  });

  it("the receipt reads Always allowed or Always denied", () => {
    expect(approvalPill({ answered: "allow", ruleSaved: { id: "r", behavior: "allow", description: "x" } })?.label).toBe("Always allowed");
    expect(approvalPill({ answered: "deny", ruleSaved: { id: "r", behavior: "deny", description: "x" } })?.label).toBe("Always denied");
    expect(approvalPill({ answered: "deny" })?.label).toBe("Declined");
  });
});
