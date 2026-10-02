// Turns a permission ask (tool id + arguments) into words a person reads:
// "consulter l'horaire dans ConnectWise PSA · jcproulx, 2 oct. au 3 oct."
// with a risk level. The raw tool id and JSON stay available for the
// card's collapsed technical details; nothing here decides anything.
import { activeLocale, t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";

export type ApprovalRisk = "read" | "write" | "destructive" | "execute";
type Operation = "read" | "create" | "update" | "delete" | "run";

export interface ToolHints {
  readOnly?: boolean;
  destructive?: boolean;
}

export interface ParsedToolId {
  /** the MCP server id, e.g. perspicax_pulsatrix_flow_jc */
  server?: string;
  /** the tool without its mcp__<server>__ prefix */
  name: string;
}

export interface ApprovalDescription {
  /** verb phrase that follows "wants to", e.g. "view the schedule" */
  action?: string;
  /** the product the tool acts on, e.g. "ConnectWise PSA" */
  product?: string;
  /** a short plain-language reading of the key arguments */
  summary?: string;
  risk?: ApprovalRisk;
  server?: string;
  /** the arguments as pretty JSON, when they are JSON */
  argsJson?: string;
}

/** `mcp__<server>__<tool>`: the server id may itself hold single
 * underscores (perspicax_pulsatrix_flow_jc) and the tool may hold double
 * ones (cw_psa_schedule__query), so split on the first two `__` only. */
export function parseToolId(tool: string): ParsedToolId {
  const match = /^mcp__(.+?)__(.+)$/.exec(tool);
  if (!match) return { name: tool };
  return { server: match[1], name: match[2]! };
}

/** Servers that are the app itself: they name no product. */
const INTERNAL_SERVERS = new Set(["ogb", "sagax", "maus", "harness"]);

const PRODUCT_BY_PREFIX: Array<[RegExp, string, number]> = [
  // [tool-name prefix, product, tokens the prefix takes]
  [/^cw_psa(_|$)/, "ConnectWise PSA", 2],
  [/^cw_rmm(_|$)/, "ConnectWise RMM", 2],
  [/^cw_automate(_|$)/, "ConnectWise Automate", 2],
  [/^(s1|sentinelone)(_|$)/, "SentinelOne", 1],
  [/^(sc|screenconnect)(_|$)/, "ScreenConnect", 1],
  [/^(m365|outlook|graph)(_|$)/, "Microsoft 365", 1],
  [/^bookstack(_|$)/, "BookStack", 1],
  [/^passportal(_|$)/, "Passportal", 1],
  [/^axcient(_|$)/, "Axcient", 1],
  [/^itglue(_|$)/, "IT Glue", 1],
];

const PRODUCT_BY_SERVER: Array<[RegExp, string]> = [
  [/connectwise|(^|_)cw(_|$)/i, "ConnectWise PSA"],
  [/microsoft_?365|outlook/i, "Microsoft 365"],
  [/sentinel_?one/i, "SentinelOne"],
  [/screen_?connect/i, "ScreenConnect"],
  [/perspicax|pulsatrix/i, "Pulsatrix"],
];

const ACRONYMS = new Set(["psa", "rmm", "api", "mcp", "ai", "it", "id", "url", "cw", "sso", "vpn", "dns"]);

function titleCase(words: string): string {
  return words
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => (ACRONYMS.has(word.toLowerCase()) ? word.toUpperCase() : word[0]!.toUpperCase() + word.slice(1)))
    .join(" ");
}

/** The product a tool acts on, from its name first (cw_psa_* is
 * ConnectWise PSA whichever server serves it), then its server's id. */
export function productFor(parsed: ParsedToolId): { product?: string; prefixTokens: number } {
  const lower = parsed.name.toLowerCase();
  for (const [prefix, product, tokens] of PRODUCT_BY_PREFIX) {
    if (prefix.test(lower)) return { product, prefixTokens: tokens };
  }
  const server = parsed.server;
  if (!server || INTERNAL_SERVERS.has(server.toLowerCase())) return { prefixTokens: 0 };
  for (const [pattern, product] of PRODUCT_BY_SERVER) {
    if (pattern.test(server)) return { product, prefixTokens: 0 };
  }
  // claude.ai connectors arrive as claude_ai_<Name>
  return { product: titleCase(server.replace(/^claude_ai_/i, "").replace(/^plugin_[^_]+_/i, "")), prefixTokens: 0 };
}

const VERBS: Array<[RegExp, Operation]> = [
  [/^(query|read|list|get|search|find|describe|fetch|show|view|lookup|count|browse|inspect|status)$/, "read"],
  [/^(create|add|new|post|insert|submit|open|book)$/, "create"],
  [/^(write|update|patch|put|set|edit|modify|upsert|assign|move|rename|change|close|merge)$/, "update"],
  [/^(delete|remove|destroy|purge|erase|drop|wipe|uninstall)$/, "delete"],
  [/^(action|run|execute|exec|invoke|trigger|start|stop|restart|reboot|send|call|isolate|kill)$/, "run"],
];

function operationOf(word: string | undefined): Operation | undefined {
  if (!word) return undefined;
  const lower = word.toLowerCase();
  for (const [pattern, op] of VERBS) if (pattern.test(lower)) return op;
  return undefined;
}

/** HTTP methods and free-form operation names in the arguments
 * (cw_psa__write { operation: "create" }, { method: "DELETE" }). */
function operationFromArgs(args: Record<string, unknown> | undefined): Operation | undefined {
  if (!args) return undefined;
  for (const key of ["operation", "method", "op", "verb", "mode", "action"]) {
    const value = args[key];
    if (typeof value !== "string") continue;
    const upper = value.toUpperCase();
    if (upper === "GET") return "read";
    if (upper === "POST") return "create";
    if (upper === "PUT" || upper === "PATCH") return "update";
    if (upper === "DELETE") return "delete";
    const op = operationOf(value.split(/[\s_-]+/)[0]);
    if (op) return op;
  }
  return undefined;
}

const RESOURCES: Array<[RegExp, string]> = [
  [/^schedule(s|entr(y|ies))?$/, "schedule"],
  [/^time(entr(y|ies))?$/, "timeEntries"],
  [/^timesheets?$/, "timesheets"],
  [/^(service)?tickets?$/, "tickets"],
  [/^compan(y|ies)$/, "companies"],
  [/^contacts?$/, "contacts"],
  [/^projects?$/, "projects"],
  [/^agreements?$/, "agreements"],
  [/^invoices?$/, "invoices"],
  [/^members?$/, "members"],
  [/^configurations?$/, "configurations"],
  [/^opportunit(y|ies)$/, "opportunities"],
  [/^activit(y|ies)$/, "activities"],
  [/^notes?$/, "notes"],
  [/^(agents?|endpoints?|devices?)$/, "devices"],
  [/^(threats?|alerts?|incidents?)$/, "alerts"],
  [/^(mail|messages?|emails?)$/, "messages"],
  [/^(events?|calendar)$/, "calendar"],
  [/^(files?|documents?)$/, "files"],
];

function resourceKey(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const clean = raw.toLowerCase().replace(/[^a-z0-9/_ -]/g, "");
  const joined = clean.replace(/[/_ -]+/g, "");
  const last = clean.split(/[/_ -]+/).filter(Boolean).pop() ?? "";
  for (const candidate of [joined, last]) {
    for (const [pattern, key] of RESOURCES) if (pattern.test(candidate)) return key;
  }
  return undefined;
}

function resourcePhrase(raw: string | undefined, op: Operation): string | undefined {
  const key = resourceKey(raw);
  if (key) return t(`approval.resource.${key}${op === "create" ? ".one" : ""}` as LocaleKey);
  if (!raw) return undefined;
  const words = raw.replace(/[/_-]+/g, " ").trim().toLowerCase();
  return words ? t("approval.resource.other", { name: words }) : undefined;
}

const OP_RISK: Record<Operation, ApprovalRisk> = {
  read: "read",
  create: "write",
  update: "write",
  delete: "destructive",
  run: "execute",
};

/** Built-in and ACP tool names that carry their own risk. */
const BUILTIN_RISK: Record<string, ApprovalRisk> = {
  Read: "read",
  Glob: "read",
  Grep: "read",
  WebFetch: "read",
  WebSearch: "read",
  read: "read",
  fetch: "read",
  search: "read",
  think: "read",
  Write: "write",
  Edit: "write",
  MultiEdit: "write",
  NotebookEdit: "write",
  edit: "write",
  Bash: "execute",
  shell: "execute",
  execute: "execute",
  delete: "destructive",
};

/** Annotations win when present (MCP readOnlyHint/destructiveHint);
 * otherwise the operation's own verb decides. */
export function riskFor(op: Operation | undefined, hints?: ToolHints, builtin?: ApprovalRisk): ApprovalRisk | undefined {
  if (hints?.destructive === true) return "destructive";
  if (hints?.readOnly === true) return "read";
  const guessed = builtin ?? (op ? OP_RISK[op] : undefined);
  if (hints?.readOnly === false && (!guessed || guessed === "read")) return "write";
  return guessed;
}

export function parseArgs(text: string | undefined): Record<string, unknown> | undefined {
  if (!text || !/^\s*\{/.test(text)) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** Is this card subtitle raw arguments (JSON), rather than a command,
 * URL or question a person can read as is? */
export function isTechnicalText(text: string | undefined): boolean {
  return Boolean(text && /^\s*[[{]/.test(text));
}

const PERSON_KEYS = /^(member|memberidentifier|member_identifier|owner|assignee|assignedto|user|username|technician|identifier|resource)$/i;
const PERSON_IN_TEXT = /(?:member|owner|assignee|resource|user)(?:\/|\.|_)?(?:identifier|name|id)?\s*(?:=|eq|==)\s*['"]([A-Za-z0-9._@-]{2,40})['"]/i;
const ISO = /\b(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?/g;

function findPerson(value: unknown, depth = 0): string | undefined {
  if (depth > 3 || !value || typeof value !== "object") return undefined;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (PERSON_KEYS.test(key)) {
      if (typeof child === "string" && /^[A-Za-z0-9._@-]{2,40}$/.test(child) && !/^\d+$/.test(child)) return child;
      if (child && typeof child === "object") {
        const inner = (child as Record<string, unknown>).identifier ?? (child as Record<string, unknown>).name;
        if (typeof inner === "string" && inner.length <= 40) return inner;
      }
    }
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    const found = findPerson(child, depth + 1);
    if (found) return found;
  }
  return undefined;
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** Every date the arguments mention, read in the viewer's time zone
 * (ConnectWise sends UTC). A range's exclusive end at local midnight
 * ("dateStart < [2026-10-04T04:00:00Z]") counts as the day before. */
export function dateRange(text: string): { from: Date; to: Date } | undefined {
  const dates: Array<{ date: Date; midnight: boolean }> = [];
  for (const match of text.matchAll(ISO)) {
    const [, y, mo, d, h, mi, s, zone] = match;
    let date: Date;
    if (h === undefined) date = new Date(Number(y), Number(mo) - 1, Number(d));
    else if (zone) date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s ?? "00"}${zone === "Z" ? "Z" : zone.length === 5 ? `${zone.slice(0, 3)}:${zone.slice(3)}` : zone}`);
    else date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0));
    if (Number.isNaN(date.getTime())) continue;
    dates.push({ date, midnight: h !== undefined && date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0 });
    if (dates.length > 20) break;
  }
  if (dates.length === 0) return undefined;
  dates.sort((a, b) => a.date.getTime() - b.date.getTime());
  const from = dates[0]!.date;
  let to = dates[dates.length - 1]!.date;
  if (dates.length > 1 && dates[dates.length - 1]!.midnight && to.getTime() > from.getTime()) {
    const before = new Date(to.getTime() - 1);
    if (before.getTime() >= from.getTime()) to = before;
  }
  return { from, to };
}

function formatDay(date: Date, withYear: boolean): string {
  try {
    return new Intl.DateTimeFormat(activeLocale(), withYear ? { day: "numeric", month: "short", year: "numeric" } : { day: "numeric", month: "short" }).format(date);
  } catch {
    return date.toDateString();
  }
}

export function formatDateRange(range: { from: Date; to: Date }, now = new Date()): string {
  const withYear = range.from.getFullYear() !== now.getFullYear() || range.to.getFullYear() !== now.getFullYear();
  const from = formatDay(range.from, withYear);
  if (dayKey(range.from) === dayKey(range.to)) return from;
  return t("approval.summary.dateRange", { from, to: formatDay(range.to, withYear) });
}

const NAME_KEYS = ["summary", "name", "title", "subject"];
const REF_KEYS = ["ticketId", "chargeToId", "ticket", "projectId", "companyId", "id"];

/** A short reading of the arguments: who, which record, when. Works on
 * truncated JSON too (old cards kept only 200 characters). */
export function summarizeArgs(args: Record<string, unknown> | undefined, text: string, now = new Date()): string | undefined {
  const parts: string[] = [];
  const person = findPerson(args) ?? PERSON_IN_TEXT.exec(text)?.[1];
  if (person) parts.push(person);
  const body = args && typeof args.body === "object" && args.body ? (args.body as Record<string, unknown>) : undefined;
  for (const source of [args, body]) {
    if (!source) continue;
    const name = NAME_KEYS.map((key) => source[key]).find((value): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 80);
    if (name) {
      parts.push(activeLocale().startsWith("fr") ? `« ${name.trim()} »` : `“${name.trim()}”`);
      break;
    }
  }
  for (const source of [args, body]) {
    if (!source) continue;
    const ref = REF_KEYS.map((key) => source[key]).find((value) => (typeof value === "number" && Number.isInteger(value)) || (typeof value === "string" && /^\d{1,10}$/.test(value)));
    if (ref !== undefined) {
      parts.push(`#${ref}`);
      break;
    }
  }
  const range = dateRange(text);
  if (range) parts.push(formatDateRange(range, now));
  return parts.length ? parts.join(", ") : undefined;
}

function prettyJson(args: Record<string, unknown> | undefined, text: string | undefined): string | undefined {
  if (args) return JSON.stringify(args, null, 2);
  return text && isTechnicalText(text) ? text : undefined;
}

/** The whole reading of one permission ask. `input` is the card's full
 * JSON when the server sent it, else its (maybe truncated) subtitle. */
export function describeApproval(tool: string | undefined, input: string | undefined, hints?: ToolHints, now = new Date()): ApprovalDescription {
  const text = input ?? "";
  const args = parseArgs(text);
  const argsJson = prettyJson(args, input);
  if (!tool) return { argsJson };
  const builtin = BUILTIN_RISK[tool];
  const parsed = parseToolId(tool);
  if (!parsed.server) {
    return { risk: riskFor(undefined, hints, builtin), argsJson };
  }
  const { product, prefixTokens } = productFor(parsed);
  // cw_psa_schedule__query → [cw, psa, schedule, query]; the product
  // prefix goes, the verb is the last word (or the first: list_sites).
  const tokens = parsed.name.split(/_+/).filter(Boolean).slice(prefixTokens);
  let op = operationOf(tokens[tokens.length - 1]);
  let rest = tokens.slice(0, -1);
  if (!op) {
    op = operationOf(tokens[0]);
    rest = tokens.slice(1);
  }
  // generic verbs (cw_psa__write, cw_psa__action) read the arguments
  const argsOp = operationFromArgs(args);
  if (argsOp && (op === undefined || op === "update" || op === "run") && (tokens.length <= 1 || rest.length === 0)) op = argsOp;
  const resourceRaw = rest.length
    ? rest.join(" ")
    : op === "run" && typeof args?.action === "string"
      ? args.action
      : typeof args?.resource === "string"
      ? args.resource
      : typeof args?.entity === "string"
        ? args.entity
        : typeof args?.action === "string" && op === "run"
          ? args.action
          : undefined;
  const risk = riskFor(op, hints, builtin);
  const summary = summarizeArgs(args, text, now);
  if (!op) {
    return { action: tokens.join(" ") || parsed.name, product, summary, risk, server: parsed.server, argsJson };
  }
  // an action's name is not a record: "run the isolate action"
  const resource = op === "run"
    ? resourceRaw?.replace(/[/_-]+/g, " ").trim().toLowerCase() || undefined
    : resourcePhrase(resourceRaw, op);
  const action = resource
    ? t(`approval.verb.${op}` as LocaleKey, { resource })
    : t(`approval.verb.${op}.bare` as LocaleKey);
  return { action, product, summary, risk, server: parsed.server, argsJson };
}

export const RISK_LABEL: Record<ApprovalRisk, LocaleKey> = {
  read: "approval.risk.read",
  write: "approval.risk.write",
  destructive: "approval.risk.destructive",
  execute: "approval.risk.execute",
};
