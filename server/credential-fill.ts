// Secure form fill: a bot fills a saved login into its browser by reference.
//
// The bot calls fill_credential with an opaque handle (cred_...), a field
// and, optionally, the input's @eN ref or a CSS selector. The browser runtime
// (server/browser-runtime.ts) then, inside one agent action:
//
//   1. focuses the ref (a click) when one is given,
//   2. reads the page with a script that carries no secret: its top-level
//      URL, whether the script runs in the top frame, and whether a fillable
//      input in the top document is the target (never an iframe),
//   3. asks the vault for the value (server/credential-vault.ts): only for a
//      granted bot and a URL on one of the item's sites over https,
//   4. types the value with a second script that re-checks, in the page and
//      in the same synchronous step as the write, that the page is still the
//      same top-level origin and the target is still the same kind of input.
//
// The value travels from the vault to the browser engine only. The bot's
// result names the item and the field, never the value, and every later
// browser result of that session is redacted (SecretRedactor), as are the
// common encodings of the value. A bot's own agent_browser_eval is refused on
// an origin where a credential was filled, so a script cannot read the field
// back. Residual risks: SECURITY.md (Credential vault) and AGENTS.md.
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
    "Fill a login the person saved in Sagax into the current page, without ever seeing it. credential is the handle request_login gave you (cred_...). field is username, password, totp (the current one-time code) or apiKey. target is the input's @eN ref from a snapshot or a CSS selector; omit it to let Sagax find the field (required for apiKey). The value is typed only when the page's top-level address is on the credential's sites over https, never into a frame. You never receive the value: later page reads show it as [credential], and agent_browser_eval is refused on that site. Submit the form yourself with a click afterwards.",
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

/** The probe: carries no secret. Answers the top-level URL, whether this
 * script runs in the top frame, and why the target would be refused. */
export function probeScript(aim: Aim, field: VaultFillField): string {
  return `(() => {${FINDER}
const top = window.top === window;
const problem = top ? judge(pick(${JSON.stringify(aim)}, ${JSON.stringify(field)}), ${JSON.stringify(field)}) : 'frame';
return JSON.stringify({ href: location.href, origin: location.origin, top, problem });
})()`;
}

/** The fill: the value is a JSON string literal inside the script, which
 * only the browser engine receives. The origin and frame checks run in the
 * same synchronous step as the write. */
export function fillScript(aim: Aim, field: VaultFillField, expectedOrigin: string, value: string): string {
  return `(() => {${FINDER}
if (window.top !== window) return JSON.stringify({ ok: false, problem: 'frame' });
if (location.origin !== ${JSON.stringify(expectedOrigin)}) return JSON.stringify({ ok: false, problem: 'moved' });
const found = pick(${JSON.stringify(aim)}, ${JSON.stringify(field)});
const problem = judge(found, ${JSON.stringify(field)});
if (problem) return JSON.stringify({ ok: false, problem });
const el = found.el;
const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
el.focus();
setter.call(el, ${JSON.stringify(value)});
el.dispatchEvent(new Event('input', { bubbles: true }));
el.dispatchEvent(new Event('change', { bubbles: true }));
return JSON.stringify({ ok: true });
})()`;
}

export interface ProbeResult { href: string; origin: string; top: boolean; problem: string | null }

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
  if (!value || typeof value.href !== "string" || typeof value.origin !== "string" || typeof value.top !== "boolean") return null;
  return { href: value.href, origin: value.origin, top: value.top, problem: typeof value.problem === "string" ? value.problem : null };
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
    default: return "The field could not be filled; nothing was typed.";
  }
}


// ---------------------------------------------------------------- redaction

const MIN_REDACT_LENGTH = 4;
const SHORT_LIVED_MS = 5 * 60_000;

function variants(value: string): string[] {
  const out = new Set<string>([value]);
  const bytes = Buffer.from(value, "utf8");
  out.add(bytes.toString("base64"));
  out.add(bytes.toString("base64").replace(/=+$/, ""));
  out.add(bytes.toString("base64url"));
  out.add(bytes.toString("hex"));
  out.add([...value].reverse().join(""));
  out.add(encodeURIComponent(value));
  out.add(JSON.stringify(value).slice(1, -1));
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
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  remember(session: string, value: string, options: { shortLived?: boolean } = {}): void {
    if (value.length < MIN_REDACT_LENGTH && !options.shortLived) return;
    let values = this.sessions.get(session);
    if (!values) this.sessions.set(session, values = new Map());
    const until = options.shortLived ? this.now() + SHORT_LIVED_MS : Number.POSITIVE_INFINITY;
    for (const variant of value.length >= MIN_REDACT_LENGTH ? variants(value) : [value]) values.set(variant, until);
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

  forget(session: string): void {
    this.sessions.delete(session);
    this.tainted.delete(session);
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
