// Email drafts sent from their card: validation, the one-shot pass a bot's
// mail connector uses after the person's Allow, and the server's own send
// through a mocked mailer (nothing leaves the machine).
import { describe, expect, it, vi } from "vitest";

import { createEmailSendPasses, emailSendCard, sendWithMailer } from "./email-draft-send.ts";
import { createMailer, type Mailer } from "./mailer.ts";
import {
  EMAIL_SEND_PASS_MS,
  emailDraftKey,
  emailSendCallMatches,
  emailSendInstruction,
  emailSendSummary,
  mailConnectorsOf,
  normalizeDraftForSend,
  type EmailDraftToSend,
} from "../shared/email-draft-send.ts";

const draft: EmailDraftToSend = { to: ["marie@example.com"], cc: ["luc@example.com"], bcc: [], subject: "Suivi du billet 48213", body: "Bonjour Marie,\n\nC'est réglé.\n" };

describe("normalizeDraftForSend", () => {
  it("keeps plain addresses and refuses header injection or no recipient", () => {
    expect(normalizeDraftForSend({ to: ["Marie <marie@example.com>", "marie@example.com"], cc: "luc@example.com; ", subject: "Hi\r\nBcc: evil@x.com", body: "x" })).toEqual({
      draft: { to: ["marie@example.com"], cc: ["luc@example.com"], bcc: [], subject: "Hi Bcc: evil@x.com", body: "x" },
    });
    expect(normalizeDraftForSend({ to: [], subject: "x", body: "y" })).toEqual({ problems: ["to needs at least one address"] });
    expect("problems" in normalizeDraftForSend({ to: ["not an address"], subject: "x" })).toBe(true);
    expect("problems" in normalizeDraftForSend({ to: ["a@b.ca"], subject: "", body: " " })).toBe(true);
  });

  it("gives the same key for the same draft", () => {
    expect(emailDraftKey(draft)).toBe(emailDraftKey({ ...draft }));
    expect(emailDraftKey(draft)).not.toBe(emailDraftKey({ ...draft, subject: "Autre" }));
  });

  it("says who it goes to and through what, in the person's language", () => {
    expect(emailSendSummary(draft, { kind: "smtp", label: "le courriel du serveur" }, "fr")).toBe("Envoyer le courriel « Suivi du billet 48213 » à marie@example.com, luc@example.com avec le courriel du serveur");
    expect(emailSendInstruction(draft, { kind: "bot", label: "outlook", id: "outlook" }, "fr")).toContain("une seule fois, tel quel");
  });
});

describe("mail connectors", () => {
  it("finds a bot's Microsoft 365, Outlook or Gmail connector, nothing else", () => {
    expect(mailConnectorsOf({ mcpServers: ["outlook", "github", "m365-mail"], connectorTools: { gmail: {}, slack: {} } })).toEqual([
      { kind: "bot", id: "outlook", label: "outlook" },
      { kind: "bot", id: "m365-mail", label: "m365-mail" },
      { kind: "bot", id: "gmail", label: "Gmail" },
    ]);
    expect(mailConnectorsOf({ mcpServers: ["github"] })).toEqual([]);
  });
});

describe("the one-shot pass after Allow", () => {
  const send = (input: unknown, tool = "mcp__outlook__send_mail") => [tool, JSON.stringify(input)] as const;

  it("matches only the approved draft: same recipients, same subject, an outbound tool", () => {
    expect(emailSendCallMatches(draft, ...send({ to: ["marie@example.com"], cc: ["luc@example.com"], subject: draft.subject, body: draft.body }))).toBe(true);
    expect(emailSendCallMatches(draft, ...send({ message: { toRecipients: [{ emailAddress: { address: "marie@example.com" } }], ccRecipients: [{ emailAddress: { address: "LUC@example.com" } }], subject: draft.subject } }))).toBe(true);
    // one more recipient, one missing, another subject, not a send
    expect(emailSendCallMatches(draft, ...send({ to: ["marie@example.com", "x@evil.com"], cc: ["luc@example.com"], subject: draft.subject }))).toBe(false);
    expect(emailSendCallMatches(draft, ...send({ to: ["marie@example.com"], subject: draft.subject }))).toBe(false);
    expect(emailSendCallMatches(draft, ...send({ to: ["marie@example.com"], cc: ["luc@example.com"], subject: "Autre chose" }))).toBe(false);
    expect(emailSendCallMatches(draft, ...send({ to: ["marie@example.com"], cc: ["luc@example.com"], subject: draft.subject }, "mcp__outlook__list_messages"))).toBe(false);
  });

  it("is used once, lapses after ten minutes, and can be withdrawn", () => {
    let now = 1_000;
    const passes = createEmailSendPasses(() => now);
    const [tool, input] = send({ to: ["marie@example.com"], cc: ["luc@example.com"], subject: draft.subject });
    passes.grant("t1", "maildraft-1", draft);
    expect(passes.matches("t2", tool, input)).toBe(false);
    expect(passes.matches("t1", tool, input)).toBe(true);
    expect(passes.take("t1", tool, input)).toEqual({ requestId: "maildraft-1" });
    expect(passes.take("t1", tool, input)).toBeNull();
    passes.grant("t1", "maildraft-2", draft);
    expect(passes.waiting("t1", "maildraft-2")).toBe(true);
    now += EMAIL_SEND_PASS_MS + 1;
    expect(passes.waiting("t1", "maildraft-2")).toBe(false);
    expect(passes.take("t1", tool, input)).toBeNull();
    passes.grant("t1", "maildraft-3", draft);
    passes.revoke("t1", "maildraft-3");
    expect(passes.matches("t1", tool, input)).toBe(false);
  });
});

describe("the server's own mail sends the approved draft", () => {
  it("sends once with To, Cc and the body through a mocked connector", async () => {
    const sent: unknown[] = [];
    const mailer: Mailer = { send: vi.fn(async (message) => { sent.push(message); }) };
    expect(await sendWithMailer(mailer, draft)).toEqual({ ok: true });
    expect(sent).toEqual([{ to: "marie@example.com", subject: draft.subject, text: draft.body, cc: ["luc@example.com"] }]);
  });

  it("returns the refusal readable, without the credential, and fails when no mail is set up", async () => {
    const mailer: Mailer = { send: async () => { throw new Error("the mail server refused the message: 535 auth failed for token sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789"); } };
    const failed = await sendWithMailer(mailer, draft);
    expect(failed.ok).toBe(false);
    expect(!failed.ok && failed.error).toContain("535 auth failed");
    expect(!failed.ok && failed.error).not.toContain("abcdefghijklmnopqrstuvwxyz0123456789");
    expect(await sendWithMailer(null, draft)).toEqual({ ok: false, error: "The server's mail is not set up (Settings > Email)." });
  });

  it("SMTP passes Cc and Bcc to the transport", async () => {
    const sendMail = vi.fn(async () => ({}));
    const mailer = createMailer(
      { provider: "smtp", from: "bot@example.com", smtp: { host: "smtp.example.com", port: 587, secure: "starttls", user: "u", password: "p" } } as never,
      { smtpTransport: () => ({ sendMail }) },
    )!;
    await sendWithMailer(mailer, { ...draft, bcc: ["archive@example.com"] });
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: "marie@example.com", cc: ["luc@example.com"], bcc: ["archive@example.com"], subject: draft.subject }));
  });

  it("a card starts pending, with a request id the answer route recognizes", () => {
    const card = emailSendCard({ draft, draftKey: emailDraftKey(draft), connector: { kind: "smtp", label: "x" }, by: "jc", now: 5 });
    expect(card).toMatchObject({ status: "pending", at: 5, by: "jc", draftKey: emailDraftKey(draft) });
    expect(card.id).toMatch(/^maildraft-[0-9a-f-]{36}$/);
  });
});
