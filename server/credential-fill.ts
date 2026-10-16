// Secure form fill: a bot fills a saved login into its browser by reference.
//
// The bot calls fill_credential with an opaque handle (cred_...), a field
// and, optionally, the input's @eN ref or a CSS selector. The browser runtime
// (server/browser-runtime.ts) then, holding the browser session alone:
//
//   1. reads the page's URL through the engine (location.href, which a page
//      cannot redefine), never from a page script's own answer,
//   2. focuses the ref (a click) when one is given,
//   3. probes with a script that carries no secret and starts with an
//      origin and top-frame guard: a fillable input of the top document,
//      where its form posts; it marks the target with a one-time attribute,
//   4. asks the vault for the value (server/credential-vault.ts): only for a
//      granted bot and a URL on one of the item's sites,
//   5. writes with a strict-mode script whose first statement is the same
//      guard, then the marked element, focused, gets the value. The script
//      reaches the engine over stdin (agent_browser_eval), never argv.
//
// The bot's result names the item and the field, never the value; every
// later browser result of that session is redacted (SecretRedactor), as are
// the common encodings of the value; scripts are refused in that browser
// after a fill. Residual risks: SECURITY.md (Credential vault) and AGENTS.md.
import {
  VAULT_FILL_FIELDS,
  isVaultFillField,
  type VaultFillField,
} from "../shared/credential-vault.ts";

export const FILL_CREDENTIAL_TOOL = "fill_credential";
export const REDACTED_CREDENTIAL = "[credential]";

export const FILL_CREDENTIAL_TOOL_SPEC = {
  name: FILL_CREDENTIAL_TOOL,
  description:
    "Fill a login the person saved in Sagax into the current page, without ever seeing it. credential is the handle request_login gave you (cred_...). field is username, password, totp (the current one-time code) or apiKey. target is the input's @eN ref from a snapshot or a CSS selector; omit it to let Sagax find the field (required for apiKey). The value is typed only when the page's top-level address is on the credential's sites over https, never into a frame. You never receive the value: later page reads show it as [credential], and page scripts are turned off in this browser until it restarts. Submit the form yourself with a click afterwards.",
  inputSchema: {
    type: "object",
    properties: {
      credential: { type: "string", description: "The handle request_login gave you, cred_..." },
      field: { type: "string", enum: [...VAULT_FILL_FIELDS] },
      target: { type: "string", maxLength: 500, description: "The input's @eN ref or a CSS selector. Optional." },
    },
    required: ["credential", "field"],
    additionalProperties: false,
  },
} as const;

export interface FillRequest {
  credential: string;
  field: VaultFillField;
  /** An @eN ref the runtime focuses first, or a CSS selector. */
  ref?: string;
  selector?: string;
}

/** Validate a fill_credential call's arguments. A string is the refusal. */
export function parseFillArguments(params: unknown): FillRequest | string {
  const args = (params as { arguments?: unknown } | null)?.arguments;
  if (!args || typeof args !== "object" || Array.isArray(args)) return "fill_credential needs credential and field.";
  const { credential, field, target } = args as Record<string, unknown>;
  if (typeof credential !== "string" || !credential.trim()) return "fill_credential needs the credential handle request_login gave you.";
  if (!isVaultFillField(field)) return `field must be one of ${VAULT_FILL_FIELDS.join(", ")}.`;
  if (target !== undefined && (typeof target !== "string" || target.length > 500)) return "target must be an @eN ref or a CSS selector.";
  const trimmed = typeof target === "string" ? target.trim() : "";
  if (field === "apiKey" && !trimmed) return "An apiKey fill needs a target: the input's @eN ref or a CSS selector.";
  if (/^@?e\d{1,6}$/.test(trimmed)) return { credential: credential.trim(), field, ref: trimmed.startsWith("@") ? trimmed : `@${trimmed}` };
  return { credential: credential.trim(), field, ...(trimmed ? { selector: trimmed } : {}) };
}

/** Which element a page script aims at: the focused one (after a ref was
 * clicked), a selector, or the best guess for the field. */
type Aim = { mode: "focused" } | { mode: "selector"; selector: string } | { mode: "auto" };

export function aimOf(request: FillRequest): Aim {
  if (request.ref) return { mode: "focused" };
  if (request.selector) return { mode: "selector", selector: request.selector };
  return { mode: "auto" };
}

// The in-page finder, shared by the probe and the fill so both judge the
// same element. It never crosses into a frame: a selector only searches the
// top document, and a focused iframe is reported as one.
const FINDER = String.raw`
const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
const usable = (el) => (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && !el.disabled && !el.readOnly && el.type !== 'hidden';
const textLike = (el) => el instanceof HTMLInputElement && ['text','email','tel','number','search',''].includes(el.type);
const hint = (el) => [el.name, el.id, el.autocomplete, el.placeholder, el.getAttribute('aria-label')].join(' ');
function pick(aim, field) {
  if (aim.mode === 'focused') { const el = document.activeElement; if (el && el.tagName === 'IFRAME') return { frame: true }; return { el }; }
  if (aim.mode === 'selector') { let el = null; try { el = document.querySelector(aim.selector); } catch (e) { return { bad: true }; } if (el && el.tagName === 'IFRAME') return { frame: true }; return { el }; }
  const inputs = Array.from(document.querySelectorAll('input,textarea')).filter((el) => usable(el) && visible(el));
  if (field === 'password') return { el: inputs.find((el) => el.type === 'password') };
  if (field === 'totp') return { el: inputs.find((el) => el.autocomplete === 'one-time-code') || inputs.find((el) => textLike(el) && /otp|totp|2fa|mfa|one.?time|verification|security.?code|auth.?code/i.test(hint(el))) };
  if (field === 'username') {
    const named = inputs.find((el) => el.autocomplete === 'username' || el.autocomplete === 'email' || (el instanceof HTMLInputElement && el.type === 'email'));
    if (named) return { el: named };
    const password = inputs.findIndex((el) => el.type === 'password');
    const before = password > 0 ? inputs.slice(0, password).reverse().find(textLike) : undefined;
    return { el: before || inputs.find((el) => textLike(el) && /user|login|email|account|identifiant|courriel/i.test(hint(el))) };
  }
  return {};
}
function judge(found, field) {
  if (found.bad) return 'selector';
  if (found.frame) return 'frame';
  const el = found.el;
  if (!el) return 'missing';
  if (el.ownerDocument !== document) return 'frame';
  if (!usable(el)) return 'not_input';
  if (field === 'password' && el.type !== 'password') return 'not_password';
  if (field !== 'password' && el.type === 'password' && field !== 'apiKey') return 'password_box';
  return null;
}`;

/** The guard every script of the fill starts with, before anything else
 * runs: the top frame of the expected origin. window.top and location are
 * unforgeable, so a page cannot answer for another one. */
function originGuard(origin: string, failure: string): string {
  return `if (window.top !== window || location.origin !== ${JSON.stringify(origin)}) return ${JSON.stringify(failure)};`;
}

/** The probe: carries no secret. It answers whether it runs in the top
 * frame of the expected origin, why the target would be refused, and where
 * the target's form posts; it marks the target with a one-time attribute so
 * the write reaches that exact element of the top document. */
export function probeScript(aim: Aim, field: VaultFillField, nonce: string, origin: string): string {
  return `(() => {'use strict';${originGuard(origin, '{"top":true,"problem":"moved","targets":[]}')}${FINDER}
const found = pick(${JSON.stringify(aim)}, ${JSON.stringify(field)});
const problem = judge(found, ${JSON.stringify(field)});
const targets = [];
if (!problem) {
  const el = found.el;
  el.setAttribute('data-sagax-fill', ${JSON.stringify(nonce)});
  const form = el.form;
  if (form) {
    targets.push(new URL(form.getAttribute('action') || location.href, location.href).href);
    for (const button of Array.from(form.querySelectorAll('[formaction]'))) targets.push(new URL(button.getAttribute('formaction'), location.href).href);
  }
}
return JSON.stringify({ top: true, problem, targets });
})()`;
}

/** The write: strict mode, the origin guard first, then the marked element
 * of the top document, still the right kind, focused, gets the value. The
 * answer is a bare word, never the value. */
export function writeScript(nonce: string, field: VaultFillField, origin: string, value: string): string {
  return `(() => {'use strict';${originGuard(origin, "moved")}${FINDER}
const el = document.querySelector(${JSON.stringify(nonceSelector(nonce))});
if (!el || !el.isConnected || el.ownerDocument !== document) return 'moved';
const problem = judge({ el }, ${JSON.stringify(field)});
if (problem) return problem;
if (document.activeElement !== el) el.focus();
if (document.activeElement !== el) return 'focus';
const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
el.dispatchEvent(new Event('input', { bubbles: true }));
el.dispatchEvent(new Event('change', { bubbles: true }));
return 'ok';
})()`;
}

/** The write's bare answer, or null when the result is anything else. */
export function parseWrite(result: unknown): string | null {
  const content = (result as { content?: unknown; isError?: unknown } | null);
  if (!content || content.isError === true || !Array.isArray(content.content)) return null;
  const part = (content.content as unknown[]).find((item) => typeof (item as { text?: unknown } | null)?.text === "string") as { text: string } | undefined;
  try {
    const value: unknown = JSON.parse(part?.text ?? "");
    return typeof value === "string" && /^[a-z_]{1,20}$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

export interface ProbeResult { top: boolean; problem: string | null; targets: string[] }

/** The selector of the element a probe marked. */
export function nonceSelector(nonce: string): string {
  return `[data-sagax-fill="${nonce}"]`;
}

/** An eval result's JSON object: agent-browser returns the script's string
 * as a JSON string inside the text part. Null when it is anything else. */
export function parseEvalObject(result: unknown): Record<string, unknown> | null {
  const content = (result as { content?: unknown; isError?: unknown } | null);
  if (!content || content.isError === true || !Array.isArray(content.content)) return null;
  const part = (content.content as unknown[]).find((item) => typeof (item as { text?: unknown } | null)?.text === "string") as { text: string } | undefined;
  if (!part) return null;
  try {
    let value: unknown = JSON.parse(part.text);
    if (typeof value === "string") value = JSON.parse(value);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export function parseProbe(result: unknown): ProbeResult | null {
  const value = parseEvalObject(result);
  if (!value || typeof value.top !== "boolean") return null;
  const targets = Array.isArray(value.targets) ? value.targets.filter((target): target is string => typeof target === "string").slice(0, 20) : [];
  return { top: value.top, problem: typeof value.problem === "string" ? value.problem : null, targets };
}

/** Whether every place the form posts to stays on the page's own origin. A
 * javascript: or data: action, or another origin, refuses the fill. */
export function formStaysOnOrigin(targets: readonly string[], origin: string): boolean {
  return targets.every((target) => {
    try {
      return new URL(target).origin === origin;
    } catch {
      return false;
    }
  });
}

/** What the bot hears when the target is refused. Never a value. */
export function problemText(problem: string, field: VaultFillField): string {
  switch (problem) {
    case "frame": return "The target is inside a frame. Sagax only fills the page's own top-level form; nothing was filled. If the site signs in inside a frame, ask the person to sign in on the visible browser.";
    case "selector": return "target is not a valid CSS selector; nothing was filled.";
    case "missing": return `No ${field === "totp" ? "one-time code" : field} field was found on this page; nothing was filled. Pass target with the input's @eN ref.`;
    case "not_input": return "The target is not a text field that can be filled; nothing was filled.";
    case "not_password": return "A password is only typed into a password field (type=password); nothing was filled.";
    case "password_box": return "This is a password field; fill it with field password. Nothing was filled.";
    case "moved": return "The page changed before the value was typed; nothing was filled. Check the page and try again.";
    case "cross_origin_form": return "This form sends to another site than the page; Sagax does not fill a login into it. Nothing was filled.";
    case "scripted": return "You ran a script on this site in this browser, so Sagax will not fill a saved login here. Call restart_browser, open the page again, then fill without running scripts.";
    case "fill_failed": return "The browser could not type into the field; nothing was filled. Take a new snapshot and pass the input's current ref.";
    case "focus": return "Another part of the page took the focus from the field; nothing was filled. Try again.";
    default: return "The field could not be filled; nothing was typed.";
  }
}


// ---------------------------------------------------------------- redaction

const MIN_REDACT_LENGTH = 4;
const SHORT_LIVED_MS = 5 * 60_000;

function htmlEntities(value: string, hex: boolean): string {
  return [...value].map((char) => hex ? `&#x${char.codePointAt(0)!.toString(16)};` : `&#${char.codePointAt(0)};`).join("");
}

function htmlEscaped(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function unicodeEscaped(value: string): string {
  return [...value].map((char) => {
    const code = char.codePointAt(0)!;
    return code > 0xffff ? char : `\\u${code.toString(16).padStart(4, "0")}`;
  }).join("");
}

/** The value as a page, a log or a request could show it: itself, base64
 * (padded or not, url-safe), hex in both cases, reversed, URL and form
 * encoded, JSON, HTML (named, decimal and hex entities) and unicode escapes. */
export function variants(value: string): string[] {
  const out = new Set<string>([value]);
  const bytes = Buffer.from(value, "utf8");
  out.add(bytes.toString("base64"));
  out.add(bytes.toString("base64").replace(/=+$/, ""));
  out.add(bytes.toString("base64url"));
  out.add(bytes.toString("hex"));
  out.add(bytes.toString("hex").toUpperCase());
  out.add([...value].reverse().join(""));
  out.add(encodeURIComponent(value));
  out.add(encodeURIComponent(value).replace(/%20/g, "+"));
  out.add(encodeURIComponent(value).replace(/%[0-9A-F]{2}/g, (escape) => escape.toLowerCase()));
  out.add(JSON.stringify(value).slice(1, -1));
  out.add(htmlEscaped(value));
  out.add(htmlEntities(value, false));
  out.add(htmlEntities(value, true));
  out.add(unicodeEscaped(value));
  return [...out].filter((variant) => variant.length >= MIN_REDACT_LENGTH);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Values filled in each browser session, removed from every later result of
 * that session (and from anything else handed to redact): the value itself
 * and its common encodings. A one-time code is forgotten after a while. */
export class SecretRedactor {
  private readonly sessions = new Map<string, Map<string, number>>();
  private readonly tainted = new Map<string, Set<string>>();
  /** The values themselves, for the pairs (user:pass) a page may encode. */
  private readonly raw = new Map<string, string[]>();
  /** Origins where the bot ran its own script in this browser session. */
  private readonly scripted = new Map<string, Set<string>>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  remember(session: string, value: string, options: { shortLived?: boolean } = {}): void {
    if (value.length < MIN_REDACT_LENGTH && !options.shortLived) return;
    let values = this.sessions.get(session);
    if (!values) this.sessions.set(session, values = new Map());
    const until = options.shortLived ? this.now() + SHORT_LIVED_MS : Number.POSITIVE_INFINITY;
    let raw = this.raw.get(session);
    if (!raw) this.raw.set(session, raw = []);
    const known = raw.slice(-8);
    if (!options.shortLived && value.length >= MIN_REDACT_LENGTH && !raw.includes(value)) raw.push(value);
    for (const variant of value.length >= MIN_REDACT_LENGTH ? variants(value) : [value]) values.set(variant, until);
    // A pair such as user:pass, as HTTP Basic sends it in base64.
    if (value.length >= MIN_REDACT_LENGTH && !options.shortLived) {
      for (const other of known) {
        for (const pair of [`${other}:${value}`, `${value}:${other}`]) {
          const encoded = Buffer.from(pair, "utf8").toString("base64");
          values.set(encoded, until);
          values.set(encoded.replace(/=+$/, ""), until);
        }
      }
    }
  }

  /** An origin where a credential was filled: the bot's own eval is refused there. */
  taint(session: string, origin: string): void {
    let origins = this.tainted.get(session);
    if (!origins) this.tainted.set(session, origins = new Set());
    origins.add(origin);
  }

  isTainted(session: string, origin: string): boolean {
    return this.tainted.get(session)?.has(origin) === true;
  }

  hasTaint(session: string): boolean {
    return (this.tainted.get(session)?.size ?? 0) > 0;
  }

  /** The bot ran agent_browser_eval on this origin: it could have left a
   * listener or a planted field there, so no fill until a restart. */
  scriptedOn(session: string, origin: string): void {
    let origins = this.scripted.get(session);
    if (!origins) this.scripted.set(session, origins = new Set());
    origins.add(origin);
  }

  wasScripted(session: string, origin: string): boolean {
    return this.scripted.get(session)?.has(origin) === true;
  }

  forget(session: string): void {
    this.sessions.delete(session);
    this.tainted.delete(session);
    this.raw.delete(session);
    this.scripted.delete(session);
  }

  private pattern(session: string): RegExp | null {
    const values = this.sessions.get(session);
    if (!values?.size) return null;
    const now = this.now();
    for (const [value, until] of values) if (until <= now) values.delete(value);
    if (!values.size) return null;
    const sorted = [...values.keys()].sort((left, right) => right.length - left.length);
    return new RegExp(sorted.map(escapeRegExp).join("|"), "g");
  }

  redactText(session: string, text: string): string {
    const pattern = this.pattern(session);
    return pattern ? text.replace(pattern, REDACTED_CREDENTIAL) : text;
  }

  /** Every string inside a tool result (text parts, structured content). */
  redact<T>(session: string, value: T): T {
    const pattern = this.pattern(session);
    if (!pattern) return value;
    const walk = (node: unknown, depth: number): unknown => {
      if (typeof node === "string") return node.replace(pattern, REDACTED_CREDENTIAL);
      if (depth > 32 || !node || typeof node !== "object") return node;
      if (Array.isArray(node)) return node.map((item) => walk(item, depth + 1));
      return Object.fromEntries(Object.entries(node).map(([key, item]) => [key, key === "data" && (node as { type?: unknown }).type === "image" ? item : walk(item, depth + 1)]));
    };
    return walk(value, 0) as T;
  }
}
