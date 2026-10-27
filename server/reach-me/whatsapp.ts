// "Me joindre" by WhatsApp (2026-10-27), with the person's OWN WhatsApp
// Business number (WhatsApp Cloud API, Meta): they paste their access token
// and their number's Phone Number ID on the bot page; no account of ours,
// no admin.
//
// - Connect: the token and the Phone Number ID are checked with Meta (the
//   number's display number and verified name, shown) and the token is
//   sealed (./secrets.ts), with the app secret when the person gives it.
// - The person's own number is proven by a code, like Telegram's /start:
//   either they send `SAGAX <code>` from their WhatsApp (the wa.me link
//   Sagax shows; it reaches Sagax through the webhook), or Sagax sends the
//   code by their message template to the number they typed and they type
//   it back on the bot page. Only that number is ever written to or read.
// - Out: inside WhatsApp's 24 hour window (the person wrote last less than
//   a day ago) a plain text; outside it, the person's own approved message
//   template (its name and language set on the bot page, one body
//   parameter {{1}} that carries the card's words). Every message is billed
//   by Meta to the person's account: no retry.
// - Back: Meta posts the person's messages to the webhook receiver
//   (`/reach-me/whatsapp/<endpoint>`, server/webhook-ingress.ts). The
//   subscription check answers the verify token; every message must carry
//   Meta's signature with the person's app secret (X-Hub-Signature-256), be
//   for their Phone Number ID and come from their proven number. It goes to
//   `onReply` (the reach-me service answers the card when it starts with an
//   open code sent to that number) and the person gets a short
//   acknowledgement, inside the window their message opened.
// - The token and the app secret are never logged, never in an answer, an
//   audit row or a prompt; a log line has a masked number at most.
import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

import { maskNumber, normalizePhone, REACH_CODE_ALPHABET } from "../../shared/reach-me.ts";
import { composeReachText, reachAckText, type ReachChannel, type ReachOutbound, type ReachSendResult } from "./channel.ts";
import type { ReachMeSecrets } from "./secrets.ts";
import type { ReachReplyOutcome } from "./service.ts";
import type { ReachMeStore, ReachWhatsAppLink } from "./store.ts";

export const WHATSAPP_GRAPH = "https://graph.facebook.com/v21.0";
/** The code that proves the person's number lives this long. */
export const WHATSAPP_LINK_TTL_MS = 15 * 60_000;
/** WhatsApp's customer service window: free text only this long after the
 * person's last message (a few minutes of margin kept). */
export const WHATSAPP_WINDOW_MS = 24 * 60 * 60_000 - 10 * 60_000;
/** Wrong codes typed on the bot page before the code is dropped. */
export const WHATSAPP_CONFIRM_TRIES = 5;
export const WHATSAPP_PHONE_NUMBER_ID = /^\d{5,30}$/;
export const WHATSAPP_TEMPLATE_NAME = /^[a-z0-9_]{1,512}$/;
export const WHATSAPP_TEMPLATE_LANGUAGE = /^[a-z]{2,3}(_[A-Z]{2})?$/;
/** The webhook path id. */
export const WHATSAPP_ENDPOINT = /^rmwa_[A-Za-z0-9_-]{16,64}$/;
const LINK_CODE_LENGTH = 6;
const TEMPLATE_TEXT_MAX = 1_000;

export interface ReachWhatsAppDeps {
  settings: ReachMeStore;
  secrets: Pick<ReachMeSecrets, "whatsApp" | "setWhatsApp">;
  onReply(person: string, text: string, from: string): Promise<{ handled: boolean; outcome: ReachReplyOutcome }>;
  language(person: string): "fr" | "en";
  /** The webhook receiver's base URL, and whether Meta can reach it (a public URL). */
  webhookBase(): { url: string; public: boolean } | null;
  fetch?: typeof fetch;
  now?(): number;
  log?(line: string): void;
}

export interface WhatsAppConnectInput {
  accessToken: string;
  phoneNumberId: string;
  appSecret?: string;
  templateName?: string;
  templateLanguage?: string;
}

export interface WhatsAppView {
  connected: boolean;
  /** The business number Meta names, and its verified name. */
  displayNumber?: string;
  verifiedName?: string;
  /** The person's own number once proven, masked. */
  number?: string;
  /** A code waits: the wa.me link that sends it, and the code itself. */
  linking: boolean;
  linkUrl?: string;
  linkCode?: string;
  /** A code went by template to this number (masked): type it back. */
  codeSentTo?: string;
  /** What the person pastes in their Meta app's webhook settings. */
  webhookUrl?: string;
  verifyToken?: string;
  /** Meta can reach this server (a public webhook URL). */
  webhookPublic: boolean;
  /** Replies are accepted: the app secret is set and the webhook is public. */
  replies: boolean;
  hasAppSecret: boolean;
  templateName?: string;
  templateLanguage?: string;
  /** The person wrote less than a day ago: plain text goes out without the template. */
  windowOpen: boolean;
}

export type WhatsAppResult = { ok: true } | { ok: false; error: string; status: number };

type WebhookMessage = {
  from?: unknown;
  type?: unknown;
  text?: { body?: unknown };
  button?: { text?: unknown };
  interactive?: { button_reply?: { title?: unknown }; list_reply?: { title?: unknown } };
};

/** The digits Meta writes a WhatsApp number with, as E.164 (or null). */
export function whatsappNumber(value: unknown): string | null {
  if (typeof value !== "string" || !/^\+?\d{8,15}$/.test(value.trim())) return null;
  return normalizePhone(value.trim().startsWith("+") ? value.trim() : `+${value.trim()}`);
}

/** The card's words as one template parameter: Meta refuses new lines,
 * tabs and runs of spaces in a parameter. */
export function templateParameter(text: string): string {
  const flat = text.split("\n").map((line) => line.trim()).filter(Boolean).join(" / ").replace(/[\t ]{2,}/g, " ");
  return flat.length > TEMPLATE_TEXT_MAX ? `${flat.slice(0, TEMPLATE_TEXT_MAX - 1).trimEnd()}…` : flat;
}

function sameSecret(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function linkCode(): string {
  let code = "";
  for (let i = 0; i < LINK_CODE_LENGTH; i += 1) code += REACH_CODE_ALPHABET[randomInt(REACH_CODE_ALPHABET.length)];
  return code;
}

export class ReachWhatsApp {
  private readonly deps: ReachWhatsAppDeps;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private readonly inflight = new Set<Promise<unknown>>();
  private readonly confirmTries = new Map<string, number>();

  constructor(deps: ReachWhatsAppDeps) {
    this.deps = deps;
    this.fetcher = deps.fetch ?? fetch;
    this.now = deps.now ?? Date.now;
    this.log = deps.log ?? ((line) => console.log(line));
  }

  private async graph(token: string, path: string, init: { method: "GET" | "POST"; body?: Record<string, unknown> }): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
    try {
      const response = await this.fetcher(`${WHATSAPP_GRAPH}/${path}`, {
        method: init.method,
        headers: { authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}) },
        ...(init.body ? { body: JSON.stringify(init.body) } : {}),
        signal: AbortSignal.timeout(15_000),
        redirect: "error",
      });
      const body = await response.json().catch(() => ({})) as Record<string, unknown>;
      return { ok: response.ok && !body.error, status: response.status, body };
    } catch {
      return { ok: false, status: 502, body: {} };
    }
  }

  private webhookUrl(link: ReachWhatsAppLink): { url?: string; public: boolean } {
    const base = this.deps.webhookBase();
    if (!base) return { public: false };
    return { url: `${base.url.replace(/\/+$/, "")}/reach-me/whatsapp/${link.endpointId}`, public: base.public };
  }

  private template(input: { templateName?: string; templateLanguage?: string }): { templateName?: string; templateLanguage?: string } | { error: string } {
    const name = input.templateName?.trim() ?? "";
    const language = input.templateLanguage?.trim() ?? "";
    if (name && !WHATSAPP_TEMPLATE_NAME.test(name)) return { error: "The template name is the one in your Meta account: lower case letters, digits and underscores." };
    if (language && !WHATSAPP_TEMPLATE_LANGUAGE.test(language)) return { error: "The template language is a code such as fr, en or en_US." };
    return { ...(name ? { templateName: name } : {}), ...(language ? { templateLanguage: language } : {}) };
  }

  /** The person pastes their access token and Phone Number ID: checked with
   * Meta, sealed, and a code to prove their own number. */
  async connect(person: string, botId: string, input: WhatsAppConnectInput): Promise<WhatsAppResult> {
    const token = input.accessToken.trim();
    const phoneNumberId = input.phoneNumberId.trim();
    if (!WHATSAPP_PHONE_NUMBER_ID.test(phoneNumberId)) return { ok: false, status: 400, error: "The Phone Number ID is the number Meta shows under your WhatsApp number (digits only), not the phone number itself." };
    const template = this.template(input);
    if ("error" in template) return { ok: false, status: 400, error: template.error };
    const appSecret = input.appSecret?.trim() || undefined;
    const checked = await this.graph(token, `${phoneNumberId}?fields=display_phone_number,verified_name`, { method: "GET" });
    if (!checked.ok) {
      const refused = checked.status === 400 || checked.status === 401 || checked.status === 403 || checked.status === 404;
      return { ok: false, status: refused ? 400 : 502, error: refused ? "Meta refused this access token or Phone Number ID. Copy them again from your Meta app (WhatsApp > API Setup)." : "Meta could not be reached. Try again." };
    }
    const displayNumber = typeof checked.body.display_phone_number === "string" ? checked.body.display_phone_number.slice(0, 40) : "";
    if (!displayNumber) return { ok: false, status: 502, error: "Meta did not name this WhatsApp number." };
    const verifiedName = typeof checked.body.verified_name === "string" ? checked.body.verified_name.slice(0, 120) : undefined;
    try {
      this.deps.secrets.setWhatsApp(person, botId, { token, ...(appSecret ? { appSecret } : {}) });
    } catch (error) {
      return { ok: false, status: (error as { status?: number }).status ?? 500, error: error instanceof Error ? error.message : "The token could not be saved." };
    }
    const previous = this.deps.settings.whatsapp(person, botId);
    this.deps.settings.setWhatsApp(person, botId, {
      phoneNumberId,
      displayNumber,
      ...(verifiedName ? { verifiedName } : {}),
      // the same webhook keeps working when the person connects again
      endpointId: previous?.endpointId ?? `rmwa_${randomBytes(18).toString("base64url")}`,
      verifyToken: previous?.verifyToken ?? randomBytes(18).toString("base64url"),
      linkCode: linkCode(),
      linkExpiresAt: this.now() + WHATSAPP_LINK_TTL_MS,
      ...template,
    });
    return { ok: true };
  }

  /** The template, its language and the app secret, without pasting the token again. */
  update(person: string, botId: string, input: { templateName?: string; templateLanguage?: string; appSecret?: string }): WhatsAppResult {
    const link = this.deps.settings.whatsapp(person, botId);
    const secret = this.deps.secrets.whatsApp(person, botId);
    if (!link || !secret) return { ok: false, status: 409, error: "Connect your WhatsApp Business number first." };
    const template = this.template({ templateName: input.templateName ?? link.templateName, templateLanguage: input.templateLanguage ?? link.templateLanguage });
    if ("error" in template) return { ok: false, status: 400, error: template.error };
    if (input.appSecret !== undefined) {
      try {
        this.deps.secrets.setWhatsApp(person, botId, { token: secret.token, ...(input.appSecret.trim() ? { appSecret: input.appSecret.trim() } : {}) });
      } catch (error) {
        return { ok: false, status: (error as { status?: number }).status ?? 500, error: error instanceof Error ? error.message : "The app secret could not be saved." };
      }
    }
    const next: ReachWhatsAppLink = { ...link };
    delete next.templateName;
    delete next.templateLanguage;
    this.deps.settings.setWhatsApp(person, botId, { ...next, ...template });
    return { ok: true };
  }

  /** A fresh code for the wa.me link (the person sends it from WhatsApp). */
  renewLink(person: string, botId: string): WhatsAppResult {
    const link = this.deps.settings.whatsapp(person, botId);
    if (!link || !this.deps.secrets.whatsApp(person, botId)) return { ok: false, status: 409, error: "Connect your WhatsApp Business number first." };
    const next: ReachWhatsAppLink = { ...link, linkCode: linkCode(), linkExpiresAt: this.now() + WHATSAPP_LINK_TTL_MS };
    delete next.pendingNumber;
    this.confirmTries.delete(`${person}\u0000${botId}`);
    this.deps.settings.setWhatsApp(person, botId, next);
    return { ok: true };
  }

  /** Sagax sends the code by the person's template to the number they typed
   * (outside the 24 hour window, a plain text would be refused). */
  async sendCode(person: string, botId: string, rawNumber: string): Promise<WhatsAppResult> {
    const link = this.deps.settings.whatsapp(person, botId);
    const secret = this.deps.secrets.whatsApp(person, botId);
    if (!link || !secret) return { ok: false, status: 409, error: "Connect your WhatsApp Business number first." };
    const number = normalizePhone(rawNumber);
    if (!number) return { ok: false, status: 400, error: "Enter your WhatsApp number in international form, like +1 514 555 0123." };
    if (!link.templateName) return { ok: false, status: 400, error: "Set your approved message template first: WhatsApp only lets a business write first with one." };
    const code = linkCode();
    const fr = this.deps.language(person) === "fr";
    const sent = await this.sendTemplate(secret.token, link, number, fr ? `Votre code Sagax : ${code}` : `Your Sagax code: ${code}`, fr ? "fr" : "en");
    if (!sent.ok) return { ok: false, status: 502, error: `WhatsApp refused the message (${sent.status}). Check the template name and language in your Meta account.` };
    this.confirmTries.delete(`${person}\u0000${botId}`);
    this.deps.settings.setWhatsApp(person, botId, { ...link, linkCode: code, linkExpiresAt: this.now() + WHATSAPP_LINK_TTL_MS, pendingNumber: number });
    return { ok: true };
  }

  /** The code the person typed back on the bot page. */
  confirm(person: string, botId: string, typed: string): WhatsAppResult {
    const link = this.deps.settings.whatsapp(person, botId);
    if (!link?.pendingNumber || !link.linkCode || (link.linkExpiresAt ?? 0) <= this.now()) return { ok: false, status: 409, error: "No code is waiting. Send a new one." };
    const key = `${person}\u0000${botId}`;
    if (!sameSecret(typed.trim().toUpperCase(), link.linkCode)) {
      const tries = (this.confirmTries.get(key) ?? 0) + 1;
      this.confirmTries.set(key, tries);
      if (tries >= WHATSAPP_CONFIRM_TRIES) {
        const next: ReachWhatsAppLink = { ...link };
        delete next.linkCode; delete next.linkExpiresAt; delete next.pendingNumber;
        this.deps.settings.setWhatsApp(person, botId, next);
        this.confirmTries.delete(key);
        return { ok: false, status: 400, error: "Too many wrong codes. Send a new one." };
      }
      return { ok: false, status: 400, error: "That is not the code. Check the WhatsApp message and try again." };
    }
    this.confirmTries.delete(key);
    this.linkNumber(person, botId, link, link.pendingNumber, false);
    return { ok: true };
  }

  private linkNumber(person: string, botId: string, link: ReachWhatsAppLink, number: string, wrote: boolean): void {
    const next: ReachWhatsAppLink = { ...link, number, ...(wrote ? { lastInboundAt: this.now() } : {}) };
    delete next.linkCode; delete next.linkExpiresAt; delete next.pendingNumber;
    if (!wrote) delete next.lastInboundAt;
    this.deps.settings.setWhatsApp(person, botId, next);
  }

  /** The person disconnects WhatsApp for this bot: token, app secret and number forgotten. */
  disconnect(person: string, botId: string): void {
    try { this.deps.secrets.setWhatsApp(person, botId, undefined); } catch { /* already gone */ }
    this.deps.settings.setWhatsApp(person, botId, undefined);
  }

  /** What the screen shows. Never the token, the app secret or the Phone Number ID. */
  view(person: string, botId: string): WhatsAppView {
    const link = this.deps.settings.whatsapp(person, botId);
    const secret = this.deps.secrets.whatsApp(person, botId);
    if (!link || !secret) return { connected: false, linking: false, webhookPublic: Boolean(this.deps.webhookBase()?.public), replies: false, hasAppSecret: false, windowOpen: false };
    const at = this.now();
    const linking = !link.number && Boolean(link.linkCode) && (link.linkExpiresAt ?? 0) > at;
    const webhook = this.webhookUrl(link);
    const digits = link.displayNumber.replace(/\D/g, "");
    return {
      connected: Boolean(link.number),
      displayNumber: link.displayNumber,
      ...(link.verifiedName ? { verifiedName: link.verifiedName } : {}),
      ...(link.number ? { number: maskNumber(link.number) } : {}),
      linking,
      ...(linking && !link.pendingNumber && digits ? { linkUrl: `https://wa.me/${digits}?text=${encodeURIComponent(`SAGAX ${link.linkCode}`)}`, linkCode: link.linkCode } : {}),
      ...(linking && link.pendingNumber ? { codeSentTo: maskNumber(link.pendingNumber) } : {}),
      ...(webhook.url ? { webhookUrl: webhook.url, verifyToken: link.verifyToken } : {}),
      webhookPublic: webhook.public,
      replies: webhook.public && Boolean(secret.appSecret),
      hasAppSecret: Boolean(secret.appSecret),
      ...(link.templateName ? { templateName: link.templateName } : {}),
      ...(link.templateLanguage ? { templateLanguage: link.templateLanguage } : {}),
      windowOpen: link.lastInboundAt !== undefined && at - link.lastInboundAt < WHATSAPP_WINDOW_MS,
    };
  }

  private async sendText(token: string, link: ReachWhatsAppLink, to: string, text: string) {
    return this.graph(token, `${link.phoneNumberId}/messages`, { method: "POST", body: { messaging_product: "whatsapp", recipient_type: "individual", to: to.replace(/\D/g, ""), type: "text", text: { body: text, preview_url: false } } });
  }

  private async sendTemplate(token: string, link: ReachWhatsAppLink, to: string, text: string, fallbackLanguage: "fr" | "en") {
    return this.graph(token, `${link.phoneNumberId}/messages`, {
      method: "POST",
      body: {
        messaging_product: "whatsapp", recipient_type: "individual", to: to.replace(/\D/g, ""), type: "template",
        template: { name: link.templateName, language: { code: link.templateLanguage ?? fallbackLanguage }, components: [{ type: "body", parameters: [{ type: "text", text: templateParameter(text) }] }] },
      },
    });
  }

  channel(): ReachChannel {
    return {
      id: "whatsapp",
      status: (person, botId) => {
        const view = this.view(person, botId);
        if (view.connected && (view.windowOpen || view.templateName)) return { ready: true };
        if (view.connected) return { ready: false, reason: "Set your approved message template: outside WhatsApp's 24 hour window a business writes only with one." };
        return { ready: false, reason: view.linking ? "Send the code from your WhatsApp to finish." : "Connect your own WhatsApp Business number first." };
      },
      send: async (out: ReachOutbound): Promise<ReachSendResult> => {
        const link = this.deps.settings.whatsapp(out.person, out.botId);
        const secret = this.deps.secrets.whatsApp(out.person, out.botId);
        if (!link?.number || !secret) return { ok: false, reason: "WhatsApp is not connected" };
        const text = composeReachText(out);
        const inWindow = link.lastInboundAt !== undefined && this.now() - link.lastInboundAt < WHATSAPP_WINDOW_MS;
        if (!inWindow && !link.templateName) return { ok: false, reason: "outside WhatsApp's 24 hour window and no message template set" };
        const sent = inWindow ? await this.sendText(secret.token, link, link.number, text) : await this.sendTemplate(secret.token, link, link.number, text, out.language);
        if (!sent.ok) return { ok: false, reason: `WhatsApp refused the message (${sent.status})` };
        return { ok: true, detail: { to: link.number } };
      },
    };
  }

  /** One request on `/reach-me/whatsapp/<endpoint>` of the webhook receiver.
   * Answers at once; the messages are read after (`drain` waits for them). */
  async webhook(endpointId: string, request: { method: string; query: URLSearchParams; headers: Record<string, string | undefined>; rawBody: string }): Promise<{ status: number; contentType: string; body: string }> {
    const text = (status: number, body: string) => ({ status, contentType: "text/plain; charset=utf-8", body });
    const entry = WHATSAPP_ENDPOINT.test(endpointId) ? this.deps.settings.whatsappByEndpoint(endpointId) : undefined;
    if (!entry) return text(404, "Unknown endpoint");
    if (request.method === "GET") {
      // Meta's subscription check: the verify token the person pasted
      const challenge = request.query.get("hub.challenge") ?? "";
      if (request.query.get("hub.mode") === "subscribe" && sameSecret(request.query.get("hub.verify_token") ?? "", entry.link.verifyToken) && /^[A-Za-z0-9_-]{1,128}$/.test(challenge)) {
        return text(200, challenge);
      }
      return text(403, "Forbidden");
    }
    if (request.method !== "POST") return text(405, "GET or POST");
    const secret = this.deps.secrets.whatsApp(entry.person, entry.botId);
    if (!secret?.appSecret) {
      this.log("reach-me: a WhatsApp message arrived but no app secret is set to check it; ignored");
      return text(401, "Unauthorized");
    }
    const signature = /^sha256=([a-f0-9]{64})$/i.exec(request.headers["x-hub-signature-256"] ?? "")?.[1]?.toLowerCase() ?? "";
    const expected = createHmac("sha256", secret.appSecret).update(request.rawBody, "utf8").digest("hex");
    if (!signature || !sameSecret(signature, expected)) return text(401, "Unauthorized");
    let payload: unknown;
    try {
      payload = JSON.parse(request.rawBody);
    } catch {
      return text(400, "Invalid JSON");
    }
    const messages: Array<{ from: string; text: string }> = [];
    const entries = Array.isArray((payload as { entry?: unknown })?.entry) ? (payload as { entry: unknown[] }).entry : [];
    for (const item of entries.slice(0, 20)) {
      const changes = Array.isArray((item as { changes?: unknown })?.changes) ? (item as { changes: unknown[] }).changes : [];
      for (const change of changes.slice(0, 20)) {
        const value = (change as { value?: { metadata?: { phone_number_id?: unknown }; messages?: unknown } })?.value;
        // only messages to the person's own business number
        if (value?.metadata?.phone_number_id !== entry.link.phoneNumberId || !Array.isArray(value.messages)) continue;
        for (const message of (value.messages as WebhookMessage[]).slice(0, 20)) {
          const from = whatsappNumber(message?.from);
          const body = message?.type === "text" ? message.text?.body
            : message?.type === "button" ? message.button?.text
              : message?.type === "interactive" ? message.interactive?.button_reply?.title ?? message.interactive?.list_reply?.title
                : undefined;
          if (from && typeof body === "string" && body.trim()) messages.push({ from, text: body.slice(0, 4_000) });
        }
      }
    }
    if (messages.length) this.track(this.receive(entry.person, entry.botId, messages));
    return text(200, "OK");
  }

  private track(work: Promise<unknown>): void {
    const run = work.catch((error) => this.log(`reach-me: a WhatsApp message could not be read (${error instanceof Error ? error.name : "error"})`));
    this.inflight.add(run);
    void run.finally(() => this.inflight.delete(run));
  }

  /** Waits for every message read so far (tests, shutdown). */
  async drain(): Promise<void> {
    while (this.inflight.size) await Promise.allSettled(this.inflight);
  }

  private async receive(person: string, botId: string, messages: Array<{ from: string; text: string }>): Promise<void> {
    for (const message of messages) {
      const link = this.deps.settings.whatsapp(person, botId);
      const secret = this.deps.secrets.whatsApp(person, botId);
      if (!link || !secret) return;
      const fr = this.deps.language(person) === "fr";
      if (!link.number) {
        // only `SAGAX <the code>` from WhatsApp proves a number, before it expires
        const sent = /^\s*sagax\s+([A-Za-z0-9]{6})\s*$/i.exec(message.text)?.[1]?.toUpperCase();
        if (sent && link.linkCode && !link.pendingNumber && sameSecret(sent, link.linkCode) && (link.linkExpiresAt ?? 0) > this.now()) {
          this.linkNumber(person, botId, link, message.from, true);
          this.log(`reach-me: WhatsApp linked to ${maskNumber(message.from)}`);
          await this.sendText(secret.token, link, message.from, fr ? "Connecté à Sagax. Les questions et approbations de ce bot arriveront ici." : "Connected to Sagax. This bot's questions and approvals will arrive here.");
        }
        continue;
      }
      // anyone else who writes to the business number is not the person
      if (message.from !== link.number) continue;
      this.deps.settings.setWhatsApp(person, botId, { ...link, lastInboundAt: this.now() });
      const result = await this.deps.onReply(person, message.text, message.from);
      // a message that answers no card is the person's, not ours to
      // acknowledge; a code that is no code of theirs is said plainly
      if (!result.handled && result.outcome !== "unknown_code") continue;
      await this.sendText(secret.token, link, link.number, reachAckText(result.outcome === "no_code" ? "unknown_code" : result.outcome, this.deps.language(person)));
    }
  }
}
