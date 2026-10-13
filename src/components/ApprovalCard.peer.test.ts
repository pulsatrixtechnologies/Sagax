// The approval card JC reported (2026-10-13): Cryptic asking to use
// agents__coordinate_bots read as the tool id, three UUIDs and raw JSON under
// an amber "The provider requires your approval", and stayed full size once
// answered. It now reads as who the bot writes to and what it says, keeps
// the technical call collapsed, says nothing alarming for a normal
// confirmation, and settles into a one-line receipt.
// @vitest-environment happy-dom
import { createElement, type ReactElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { peerApproval } from "@/lib/peer-approval";
import { BotEditorStore, type Bot, type Message } from "@/state/store";
import { ApprovalCard, heldNoteWorthShowing } from "./ApprovalCard";
import { PendingApprovalActions, PendingApprovalPanel, pendingApprovals } from "./PendingApproval";

afterEach(() => setLocale("en"));

const IDS = ["7669b8f6-1c1e-4f7e-9d61-0a8f4c1b2d01", "870a1c5f-5d2b-4b8a-8e2f-3c4d5e6f7a02", "d48a3619-9e8f-4a7b-b6c5-d4e3f2a1b003"];
const TEAM = [
  { id: IDS[0], name: "Atlas", color: "blue" },
  { id: IDS[1], name: "Nova", color: "purple" },
  { id: IDS[2], name: "Orion", color: "orange" },
] as unknown as Bot[];
const cryptic = { id: "cryptic", name: "Cryptic", color: "green" } as unknown as Bot;
const MESSAGE = "Ping from Cryptic, JC is on a voice call and wants a quick status from each of you.";
const ARGS = JSON.stringify({ bot_ids: IDS, message: MESSAGE });

function coordinate(extra: Record<string, unknown> = {}): Message {
  return {
    id: "m1", role: "bot", kind: "options", at: 1,
    card: {
      title: "Approval needed",
      // the gate's two previews: the subtitle capped at 200, the input at 2,000
      subtitle: `agents__coordinate_bots ${ARGS}`.slice(0, 200),
      toolInput: ARGS,
      options: ["Allow", "Deny"],
      requestId: "r1",
      tool: "other",
      mcpTool: "agents__coordinate_bots",
      allowKey: "mcp:agents__coordinate_bots",
      held: "The provider requires your approval for this action.",
      heldCode: "approval.held.native",
      ...extra,
    },
  } as unknown as Message;
}

function withStore(element: ReactElement, dispatch = vi.fn()) {
  const value = { dispatch, state: { bots: [cryptic, ...TEAM] } } as unknown as Parameters<typeof BotEditorStore>[0]["value"];
  return renderToStaticMarkup(createElement(BotEditorStore, { value, children: element }));
}

/** The text a person reads, without the markup and the attributes. */
const visibleText = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("peerApproval", () => {
  it("reads the teammates and the message from the gate's subtitle, its JSON input, or a preview cut short", () => {
    expect(peerApproval(coordinate().card!)).toEqual({ kind: "write", botIds: IDS, message: MESSAGE });
    // an older card with only the capped subtitle: as much as it holds
    expect(peerApproval({ ...coordinate().card!, toolInput: undefined })).toMatchObject({ botIds: IDS, message: expect.stringMatching(/^Ping from Cryptic.*…$/) });
    const short = JSON.stringify({ bot_ids: [IDS[0]], message: "Hi" });
    expect(peerApproval({ ...coordinate().card!, toolInput: undefined, subtitle: `agents__coordinate_bots ${short}` })).toEqual({ kind: "write", botIds: [IDS[0]], message: "Hi" });
    const cut = `${ARGS.slice(0, ARGS.length - 20)}…`;
    expect(peerApproval({ ...coordinate().card!, toolInput: cut, subtitle: "" })).toMatchObject({ botIds: IDS, message: expect.stringMatching(/^Ping from Cryptic.*…$/) });
    expect(peerApproval({ tool: "other", mcpTool: "agents__ask_bot", subtitle: "", toolInput: JSON.stringify({ bot_id: IDS[1], message: "Status?" }) }))
      .toEqual({ kind: "ask", botIds: [IDS[1]], message: "Status?" });
    // another server's tool of the same name is not a teammate tool
    expect(peerApproval({ tool: "other", mcpTool: "github__coordinate_bots", subtitle: "", toolInput: ARGS })).toBeUndefined();
  });
});

describe("a teammate approval card", () => {
  it("says who the bot writes to, by name, and quotes the message; no UUID, no raw call, no provider note", () => {
    const html = withStore(createElement(ApprovalCard, { bot: cryptic, message: coordinate() }));
    const text = visibleText(html);
    expect(text).toContain("Cryptic wants to write to 3 bots");
    for (const name of ["Atlas", "Nova", "Orion"]) expect(text).toContain(name);
    expect(text).toContain(MESSAGE);
    for (const id of IDS) expect(text).not.toContain(id);
    expect(text).not.toContain("agents__coordinate_bots");
    expect(text).not.toContain("provider");
    expect(html).not.toContain("bg-warning");
  });

  it("names a single teammate in the title", () => {
    const one = coordinate({ toolInput: JSON.stringify({ bot_ids: [IDS[1]], message: "Hi" }) });
    expect(visibleText(withStore(createElement(ApprovalCard, { bot: cryptic, message: one })))).toContain("Cryptic wants to write to Nova");
  });

  it("keeps the technical call one click away in the composer and offers Allow, Always allow and Deny", () => {
    const [pending] = pendingApprovals([coordinate()]);
    const panel = withStore(createElement(PendingApprovalPanel, { pending: pending!, count: 1, index: 0, bot: cryptic }));
    expect(visibleText(panel)).toContain("View the full request");
    expect(visibleText(panel)).not.toContain(IDS[0]);
    const actions = withStore(createElement(PendingApprovalActions, { pending: pending!, threadId: "t", bot: cryptic, onCancelTurn: () => {} }));
    const buttons = [...actions.matchAll(/<button[^>]*>([^<]+)<\/button>/g)].map((match) => match[1]);
    expect(buttons).toEqual(["Cancel turn", "Deny", "Always allow", "Allow"]);
    expect(actions).toMatch(/bg-accent[^"]*">Allow</);
  });

  it("reads in French", () => {
    setLocale("fr");
    const text = visibleText(withStore(createElement(ApprovalCard, { bot: cryptic, message: coordinate() })));
    expect(text).toContain("Cryptic veut écrire à 3 bots");
  });
});

describe("a settled approval", () => {
  it("collapses to one line: status and action, details closed", () => {
    for (const [extra, label] of [
      [{ answered: "allow" }, "Allowed once"],
      [{ answered: "allow", alwaysAllowed: "mcp:agents__coordinate_bots" }, "Always allowed"],
      [{ answered: "deny" }, "Declined"],
      [{ expired: true }, "Expired"],
    ] as const) {
      const html = withStore(createElement(ApprovalCard, { bot: cryptic, message: coordinate(extra) }));
      expect(html).toContain("data-approval-receipt");
      expect(visibleText(html).trim()).toBe(`${label} · Write to 3 bots`);
    }
  });

  it("opens on click on the request, the saved rule and a working Edit rule for the asking bot", () => {
    const dispatch = vi.fn();
    const message = coordinate({ answered: "allow", alwaysAllowed: "mcp:agents__coordinate_bots" });
    const value = { dispatch, state: { bots: [cryptic, ...TEAM] } } as unknown as Parameters<typeof BotEditorStore>[0]["value"];
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      // ChatView passes the name and the id separately
      flushSync(() => root.render(createElement(BotEditorStore, { value, children: createElement(ApprovalCard, { bot: { name: "Cryptic" }, botId: "cryptic", message }) })));
      expect(host.querySelector("[data-allow-rule]")).toBeNull();
      const row = host.querySelector<HTMLButtonElement>("[data-approval-receipt] > button")!;
      expect(row.getAttribute("aria-expanded")).toBe("false");
      flushSync(() => row.click());
      expect(row.getAttribute("aria-expanded")).toBe("true");
      expect(host.textContent).toContain("Added to your Allow rules");
      expect(host.textContent).toContain(MESSAGE);
      const edit = [...host.querySelectorAll<HTMLButtonElement>("[data-allow-rule] button")].find((button) => button.textContent === "Edit rule")!;
      flushSync(() => edit.click());
      expect(dispatch).toHaveBeenCalledWith({ type: "toggleSettings", open: true, section: "access", botId: "cryptic" });
    } finally {
      flushSync(() => root.unmount());
      host.remove();
    }
  });
});

describe("heldNoteWorthShowing", () => {
  it("drops the routine notes and keeps the ones that change the decision", () => {
    expect(heldNoteWorthShowing({ heldCode: "approval.held.native", held: "x" })).toBeUndefined();
    expect(heldNoteWorthShowing({ heldCode: "approval.held.gate", held: "x" })).toBeUndefined();
    expect(heldNoteWorthShowing({ held: "The provider requires your approval for this action." })).toBeUndefined();
    expect(heldNoteWorthShowing({ heldCode: "approval.held.outbound", held: "x" })).toMatch(/on your behalf/);
    expect(heldNoteWorthShowing({ heldCode: "approval.held.safety", held: "x" })).toMatch(/safety review/);
  });
});
