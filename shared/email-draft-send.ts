// Sending an email draft from its card (src/components/EmailCard.tsx).
//
// Nothing is ever sent from the card itself. "Envoyer" asks the server for
// an ordinary approval card in the conversation; only the person's Allow on
// that card sends, once, through a connector that can send:
//   - "bot": the bot's own mail connector (a Microsoft 365, Outlook or Gmail
//     MCP server or connected app). Allow asks the bot, as the person, to
//     send exactly this draft, and leaves a one-shot pass: the bot's next
//     outbound call in that thread that names every recipient and the
//     subject is approved without a second card. Any other send still asks.
//   - "smtp": the server's own mail settings (Settings > Email), sent by the
//     server itself.
// Deny closes the card and nothing is sent. A failed send is shown on the
// draft with Retry, and a retry asks again.
//
// Pure: validation, the card's words, the instruction and the pass check.

import { parseArgs } from "./approval-describe.ts";
import { isOutboundTool } from "./outbound.ts";

export const EMAIL_SEND_REQUEST_PREFIX = "maildraft-";
export const EMAIL_SEND_PASS_MS = 10 * 60_000;
const MAX_RECIPIENTS = 50;
const MAX_SUBJECT = 300;
const MAX_BODY = 50_000;
const ADDRESS = /^[^\s@<>(),;:"[\]\\]+@[^\s@<>(),;:"[\]\\]+\.[^\s@<>(),;:"[\]\\]+$/;

export interface EmailDraftToSend {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
}

export type EmailConnectorKind = "bot" | "smtp";

export interface EmailConnector {
  kind: EmailConnectorKind;
  /** What the person reads: the server or app name ("outlook", "Gmail"),
   * or the server's mail. */
  label: string;
  /** bot connectors: the MCP server or connected-app slug. */
  id?: string;
}

export type EmailSendStatus = "pending" | "denied" | "sending" | "handed-off" | "sent" | "failed";

export interface EmailSendRequestCard {
  id: string;
  /** A stable key of the draft as the bot wrote it, so the card in the chat
   * finds its send again after a reload. */
  draftKey: string;
  draft: EmailDraftToSend;
  connector: EmailConnector;
  /** The principal who asked to send. */
  by: string;
  status: EmailSendStatus;
  /** A readable reason, on `failed`. Never a secret. */
  error?: string;
  /** Addresses that already received this draft (a partial send), so a
   * retry of the same draft skips them. */
  sentTo?: string[];
  at: number;
}

function addressOf(value: string): string | null {
  const trimmed = value.trim();
  const angle = /<([^<>]+)>\s*$/.exec(trimmed);
  const address = (angle ? angle[1]! : trimmed).trim();
  return ADDRESS.test(address) ? address : null;
}

function addressList(value: unknown, field: string, problems: string[]): string[] {
  if (value === undefined) return [];
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,;]/) : null;
  if (!raw) {
    problems.push(`${field} must be a list of addresses`);
    return [];
  }
  const list: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string" || !item.trim()) continue;
    const address = addressOf(item);
    if (!address) problems.push(`${field}: "${item.trim().slice(0, 80)}" is not an email address`);
    else if (!list.some((known) => known.toLowerCase() === address.toLowerCase())) list.push(address);
  }
  return list;
}

/** The draft as it may be sent, or the reasons it may not. Header fields
 * never carry a line break (no header injection), addresses are plain. */
export function normalizeDraftForSend(value: unknown): { draft: EmailDraftToSend } | { problems: string[] } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { problems: ["draft must be an object"] };
  const input = value as Record<string, unknown>;
  const problems: string[] = [];
  const to = addressList(input.to, "to", problems);
  const cc = addressList(input.cc, "cc", problems);
  const bcc = addressList(input.bcc, "bcc", problems);
  if (!to.length) problems.push("to needs at least one address");
  if (to.length + cc.length + bcc.length > MAX_RECIPIENTS) problems.push(`at most ${MAX_RECIPIENTS} recipients`);
  const subject = typeof input.subject === "string" ? input.subject.replace(/[\r\n]+/g, " ").trim() : "";
  if (subject.length > MAX_SUBJECT) problems.push(`subject is longer than ${MAX_SUBJECT} characters`);
  const body = typeof input.body === "string" ? input.body.replace(/\r\n/g, "\n") : "";
  if (body.length > MAX_BODY) problems.push(`body is longer than ${MAX_BODY} characters`);
  if (!subject && !body.trim()) problems.push("an email needs a subject or a body");
  return problems.length ? { problems } : { draft: { to, cc, bcc, subject, body } };
}

/** FNV-1a of the draft's fields: the same draft has the same key on every
 * device, without a crypto API. */
export function emailDraftKey(draft: Pick<EmailDraftToSend, "to" | "cc" | "subject" | "body">): string {
  const text = [draft.to.join(","), draft.cc.join(","), draft.subject, draft.body].join("\u0000");
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** The card's one line: who it goes to and its subject. */
export function emailSendSummary(draft: EmailDraftToSend, connector: EmailConnector, language = "fr"): string {
  const fr = language.toLowerCase().startsWith("fr");
  const subject = draft.subject || (fr ? "(sans objet)" : "(no subject)");
  const recipients = [...draft.to, ...draft.cc].join(", ");
  return fr
    ? `Envoyer le courriel « ${subject} » à ${recipients} avec ${connector.label}`
    : `Send the email "${subject}" to ${recipients} with ${connector.label}`;
}

/** What the person's Allow asks their bot: send exactly this, once. */
export function emailSendInstruction(draft: EmailDraftToSend, connector: EmailConnector, language = "fr"): string {
  const fr = language.toLowerCase().startsWith("fr");
  const lines = fr
    ? [
      `J'ai approuvé l'envoi de ce courriel. Envoie-le maintenant, une seule fois, tel quel, avec ton connecteur ${connector.label}. Ne change ni les destinataires, ni l'objet, ni le corps. Si l'envoi échoue, dis-moi pourquoi sans réessayer.`,
      `À : ${draft.to.join(", ")}`,
      ...(draft.cc.length ? [`Cc : ${draft.cc.join(", ")}`] : []),
      ...(draft.bcc.length ? [`Cci : ${draft.bcc.join(", ")}`] : []),
      `Objet : ${draft.subject}`,
      "Corps :",
      draft.body,
    ]
    : [
      `I approved sending this email. Send it now, once, exactly as is, with your ${connector.label} connector. Do not change the recipients, the subject or the body. If sending fails, tell me why and do not retry.`,
      `To: ${draft.to.join(", ")}`,
      ...(draft.cc.length ? [`Cc: ${draft.cc.join(", ")}`] : []),
      ...(draft.bcc.length ? [`Bcc: ${draft.bcc.join(", ")}`] : []),
      `Subject: ${draft.subject}`,
      "Body:",
      draft.body,
    ];
  return lines.join("\n");
}

type RecipientField = "to" | "cc" | "bcc";
const RECIPIENT_FIELD: Record<string, RecipientField> = {
  to: "to", torecipients: "to", recipients: "to", recipient: "to", toemail: "to", emailto: "to", recipientemail: "to", toaddress: "to", toaddresses: "to",
  cc: "cc", ccrecipients: "cc", ccemail: "cc", ccaddresses: "cc",
  bcc: "bcc", bccrecipients: "bcc", bccemail: "bcc", bccaddresses: "bcc",
};
/** Keys an address may sit under inside a recipient (Microsoft Graph's
 * `{ emailAddress: { address, name } }`). */
const ADDRESS_KEYS = new Set(["emailaddress", "address", "email", "name"]);
const BODY_KEYS = new Set(["body", "content", "text", "html", "bodytext", "bodyhtml", "message"]);
/** Every other key a send call may carry. Anything not here (attachments,
 * reply-to, from, sender, headers, an extra field) is not the approved draft. */
const NEUTRAL_KEYS = new Set(["subject", "contenttype", "content_type", "ishtml", "is_html", "mimetype", "format", "savetosentitems", "save_to_sent_items", "userid", "user_id", "importance"]);
const ADDRESS_IN_TEXT = /^[^\s@<>(),;:"'[\]\\{}]+@[^\s@<>(),;:"'[\]\\{}]+\.[a-z]{2,}$/i;

function keyOf(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, "");
}

/** The body as text: tags and the common entities of an HTML body removed,
 * line endings and runs of white space folded. */
export function normalizeEmailBody(body: string): string {
  let text = body.replace(/\r\n?/g, "\n");
  if (/<[a-z][\s\S]*>/i.test(text)) {
    text = text
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&");
  }
  return text.replace(/\s+/g, " ").trim();
}

/** FNV-1a of the normalized body: the approved body, bound to the pass. */
export function emailBodyHash(body: string): string {
  const text = normalizeEmailBody(body);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(16).padStart(8, "0")}:${text.length}`;
}

interface CallReading {
  recipients: Record<RecipientField, Set<string>>;
  subjects: string[];
  bodies: string[];
  /** a key or a value outside the approved shape */
  extra: boolean;
}

function readAddresses(value: unknown, into: Set<string>, reading: CallReading): void {
  if (typeof value === "string") {
    for (const part of value.split(/[,;]/)) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const angle = /<([^<>]+)>\s*$/.exec(trimmed);
      const address = (angle ? angle[1]! : trimmed).trim().toLowerCase();
      if (ADDRESS_IN_TEXT.test(address)) into.add(address);
      else if (!angle) reading.extra = true;
    }
  } else if (Array.isArray(value)) {
    for (const item of value) readAddresses(item, into, reading);
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (!ADDRESS_KEYS.has(keyOf(key))) reading.extra = true;
      else if (keyOf(key) !== "name") readAddresses(item, into, reading);
    }
  } else if (value !== null && value !== undefined) {
    reading.extra = true;
  }
}

function readCall(value: unknown, reading: CallReading): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    reading.extra = true;
    return;
  }
  for (const [rawKey, item] of Object.entries(value)) {
    const key = keyOf(rawKey);
    const field = RECIPIENT_FIELD[key];
    if (field) {
      readAddresses(item, reading.recipients[field], reading);
    } else if (key === "subject") {
      if (typeof item === "string") reading.subjects.push(item.trim());
      else reading.extra = true;
    } else if (BODY_KEYS.has(key)) {
      if (typeof item === "string") reading.bodies.push(item);
      else readCall(item, reading);
    } else if (NEUTRAL_KEYS.has(key) || NEUTRAL_KEYS.has(rawKey.toLowerCase())) {
      if (item !== null && typeof item === "object") reading.extra = true;
    } else {
      reading.extra = true;
    }
  }
}

function sameSet(have: Set<string>, want: readonly string[]): boolean {
  const expected = new Set(want.map((address) => address.toLowerCase()));
  return have.size === expected.size && [...expected].every((address) => have.has(address));
}

/** Whether one outbound call is the approved draft, through the approved
 * connector: an outbound tool of that connector whose To, Cc and Bcc are
 * exactly the draft's, whose subject is the draft's, whose body is the
 * approved body (same normalized hash), and which carries no other field
 * (no attachment, reply-to, from, sender or header). Anything else keeps
 * its card. */
export function emailSendCallMatches(draft: EmailDraftToSend, tool: string, input: string | undefined, connector?: EmailConnector): boolean {
  const qualified = tool.startsWith("mcp__") || !tool.includes("__") ? tool : `mcp__${tool}`;
  if (!isOutboundTool(tool) && !isOutboundTool(qualified)) return false;
  if (connector && !connectorOwnsTool(connector, tool)) return false;
  const args = parseArgs(input);
  if (!args) return false;
  const reading: CallReading = { recipients: { to: new Set(), cc: new Set(), bcc: new Set() }, subjects: [], bodies: [], extra: false };
  readCall(args, reading);
  if (reading.extra) return false;
  if (!sameSet(reading.recipients.to, draft.to) || !sameSet(reading.recipients.cc, draft.cc) || !sameSet(reading.recipients.bcc, draft.bcc)) return false;
  if (reading.subjects.length > 1 || (reading.subjects[0] ?? "") !== draft.subject.trim()) return false;
  const approved = emailBodyHash(draft.body);
  if (draft.body.trim() && !reading.bodies.length) return false;
  return reading.bodies.every((body) => emailBodyHash(body) === approved);
}

/** Whether a tool belongs to the connector the person approved: the MCP
 * server of that name, or the connected app's own actions. */
export function connectorOwnsTool(connector: EmailConnector, tool: string): boolean {
  if (connector.kind !== "bot" || !connector.id) return false;
  const id = connector.id.toLowerCase();
  const match = /^(?:mcp__)?([A-Za-z0-9][A-Za-z0-9_.-]*?)__([A-Za-z0-9][A-Za-z0-9_.-]*)$/.exec(tool);
  if (match) {
    const server = match[1]!.toLowerCase();
    if (server === id) return true;
    // a connected app runs through the composio server: GMAIL_SEND_EMAIL
    return server === "composio" && match[2]!.toLowerCase().startsWith(`${id}_`);
  }
  return tool.toLowerCase().startsWith(`${id}_`);
}

/** A mail connector a bot has, from its MCP servers and connected apps. */
export function mailConnectorsOf(bot: { mcpServers?: readonly string[]; connectorTools?: Record<string, unknown> }): EmailConnector[] {
  const found: EmailConnector[] = [];
  const MAIL = /outlook|microsoft|m365|office365|gmail|google[-_ ]?mail|exchange|(^|[-_ ])mail([-_ ]|$)|email/i;
  for (const server of bot.mcpServers ?? []) {
    if (MAIL.test(server)) found.push({ kind: "bot", id: server, label: server });
  }
  for (const slug of Object.keys(bot.connectorTools ?? {})) {
    if (/^(gmail|outlook|microsoft_outlook|office365)$/i.test(slug)) found.push({ kind: "bot", id: slug, label: slug.charAt(0).toUpperCase() + slug.slice(1).toLowerCase() });
  }
  return found;
}
