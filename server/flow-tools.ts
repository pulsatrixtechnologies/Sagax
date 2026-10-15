// Pulsatrix Flow's deterministic compute, as native Sagax tools ("sagax-flow").
//
// The marketplace plugin pulsatrix-flow did this arithmetic in Python
// (scripts/px_flow.py and px_flow_action.py) for its skills and actions:
// free holes in a calendar, a time block in UTC split at local midnight,
// overlaps, exact medians, age buckets, grouping of similar units, the
// condition language of its routines, and booked hours per day. Here it is
// pure: every fact (time zone, windows, split time, items) comes in as an
// argument and nothing is read from disk, the network or the clock beyond
// `now`. No organization's content lives here: boards, members, companies
// and their rules stay in the organization's own configuration.
//
// Mounted next to a turn's Perspicax profiles (server/index.ts
// flowToolsIntegration) and answered inside the workplace stdio proxy's own
// process (server/user-sandbox-proxy.ts flowToolsRequest), with no route,
// capability or call to the server. Mapping of the
// plugin to these tools: docs/migration/flow-plugin-mapping.md.
// Tests: server/flow-tools.test.ts.
import { createHash } from "node:crypto";
import { setFlagsFromString } from "node:v8";
import { zonedParts, zonedTimeToUtc } from "../shared/zoned-time.ts";

/** The MCP server the tools are mounted under. */
export const FLOW_TOOLS_MCP_NAME = "sagax-flow";

/** The most items any one call takes. */
export const FLOW_MAX_ITEMS = 5_000;

const WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

class FlowInputError extends Error {}

function fail(message: string): never {
  throw new FlowInputError(message);
}

// ── values ────────────────────────────────────────────────────────────

type Json = unknown;
type Item = Record<string, Json>;

function isRecord(value: unknown): value is Item {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === ""
    || (Array.isArray(value) && value.length === 0)
    || (isRecord(value) && Object.keys(value).length === 0);
}

/** A dotted path; a numeric part indexes a list (`items.0.id`). */
export function getPath(value: unknown, path: string): unknown {
  let current = value;
  for (const part of path.split(".")) {
    if (isRecord(current)) current = current[part];
    else if (Array.isArray(current) && /^\d+$/.test(part)) current = current[Number(part)];
    else return undefined;
  }
  return current;
}

/** A value as text: a reference reads as its name or identifier. */
function asText(value: unknown): string {
  if (isRecord(value)) return String(value.name ?? value.identifier ?? JSON.stringify(value));
  return value === null || value === undefined ? "" : String(value);
}

const TS_RE = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/** An ISO 8601 date-time (Z, an offset or none: UTC) or a bare date (UTC
 * midnight) as epoch milliseconds, else null. */
export function parseMoment(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = TS_RE.exec(value.trim());
  if (!m) return null;
  const [, day, hh, mm, ss, frac, tz] = m;
  const [y, mo, d] = day!.split("-").map(Number) as [number, number, number];
  const h = Number(hh ?? 0), mi = Number(mm ?? 0), s = Number(ss ?? 0);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  let at = Date.UTC(y, mo - 1, d, h, mi, s);
  if (new Date(at).getUTCDate() !== d) return null;
  if (frac) at += Number((frac + "000").slice(0, 3));
  if (tz && tz !== "Z") {
    const sign = tz[0] === "+" ? 1 : -1;
    const digits = tz.slice(1).replace(":", "");
    at -= sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2))) * MINUTE_MS;
  }
  return at;
}

/** `YYYY-MM-DDTHH:MM:SSZ`. */
export function utcIso(at: number): string {
  return new Date(Math.floor(at / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function dateKey(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function parseDateKey(day: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.trim().slice(0, 10));
  if (!m) return null;
  const parts = [Number(m[1]), Number(m[2]), Number(m[3])] as [number, number, number];
  const back = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  return back.getUTCMonth() === parts[1] - 1 && back.getUTCDate() === parts[2] ? parts : null;
}

function addDays(day: string, n: number): string {
  const [y, m, d] = parseDateKey(day)!;
  const at = new Date(Date.UTC(y, m - 1, d) + n * DAY_MS);
  return dateKey(at.getUTCFullYear(), at.getUTCMonth() + 1, at.getUTCDate());
}

/** 0 (Sunday) to 6. */
function weekdayOf(day: string): number {
  const [y, m, d] = parseDateKey(day)!;
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function daysBetween(from: string, to: string): number {
  const [a, b] = [parseDateKey(from)!, parseDateKey(to)!];
  return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / DAY_MS);
}

/** The local calendar day of an instant. */
function localDayOf(at: number, timeZone: string): string {
  const p = zonedParts(at, timeZone);
  return dateKey(p.year, p.month, p.day);
}

/** `HH:MM` of an instant in the zone. */
function localHm(at: number, timeZone: string): string {
  const p = zonedParts(at, timeZone);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** Minutes since local midnight of an `HH:MM` text (24:00 allowed), or null. */
function hmMinutes(value: unknown): number | null {
  const m = /^\s*(\d{1,2}):(\d{2})/.exec(String(value ?? ""));
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (mi > 59 || h * 60 + mi > 24 * 60) return null;
  return h * 60 + mi;
}

/** The instant a local day and minutes since its midnight show in the zone
 * (daylight saving aware; 24:00 is the next midnight). */
function localAt(day: string, minutes: number, timeZone: string): number {
  const [y, m, d] = parseDateKey(day)!;
  const extraDays = Math.floor(minutes / 1440);
  const rest = minutes - extraDays * 1440;
  const target = extraDays ? parseDateKey(addDays(day, extraDays))! : [y, m, d] as const;
  return zonedTimeToUtc(target[0], target[1], target[2], Math.floor(rest / 60), rest % 60, timeZone);
}

/** A ConnectWise-style date-only value: the day as written. */
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}(T00:00:00(\.0+)?Z)?$/;

/** The local calendar day of a value: a bare date or a date-only value is
 * that date as written; any other date-time is converted to the zone. */
function localDay(value: unknown, timeZone: string): string | null {
  if (typeof value === "string" && DATE_ONLY_RE.test(value.trim())) return parseDateKey(value.trim()) ? value.trim().slice(0, 10) : null;
  const at = parseMoment(value);
  return at === null ? null : localDayOf(at, timeZone);
}

// ── arguments ─────────────────────────────────────────────────────────

function timeZoneArg(value: unknown): string {
  const zone = value === undefined || value === null || value === "" ? "UTC" : value;
  if (typeof zone !== "string") fail("time_zone must be an IANA time zone name, for example America/Toronto or UTC.");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
  } catch {
    fail(`Unknown time zone ${JSON.stringify(zone)}: use an IANA name, for example America/Toronto or UTC.`);
  }
  return zone;
}

function itemsArg(value: unknown, name: string, required = true): Item[] {
  if (value === undefined || value === null) {
    if (required) fail(`${name} is required: a list of objects.`);
    return [];
  }
  if (!Array.isArray(value)) fail(`${name} must be a list of objects.`);
  if (value.length > FLOW_MAX_ITEMS) fail(`${name} has ${value.length} items; at most ${FLOW_MAX_ITEMS}.`);
  return value.filter(isRecord);
}

function stringArg(value: unknown, name: string, fallback: string): string {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string") fail(`${name} must be a string.`);
  return value;
}

function intArg(value: unknown, name: string, fallback: number | undefined, min: number, max: number): number {
  if (value === undefined || value === null) {
    if (fallback === undefined) fail(`${name} is required: an integer from ${min} to ${max}.`);
    return fallback;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) fail(`${name} must be an integer from ${min} to ${max}.`);
  return value;
}

function stringList(value: unknown, name: string): string[] {
  if (value === undefined || value === null) return [];
  const list = typeof value === "string" ? [value] : value;
  if (!Array.isArray(list) || !list.every((entry) => typeof entry === "string")) fail(`${name} must be a list of strings.`);
  return list as string[];
}

function dayArg(value: unknown, name: string): string {
  if (typeof value !== "string" || !parseDateKey(value) || value.trim().length !== 10) fail(`${name} must be a date YYYY-MM-DD.`);
  return value.trim();
}

function hmArg(value: unknown, name: string): number {
  const minutes = typeof value === "string" && /^\s*\d{1,2}:\d{2}\s*$/.test(value) ? hmMinutes(value) : null;
  if (minutes === null) fail(`${name} must be a local time HH:MM.`);
  return minutes;
}

function nowArg(value: unknown, clock: number): number {
  if (value === undefined || value === null || value === "") return clock;
  const at = parseMoment(value);
  if (at === null) fail("now must be an ISO 8601 date-time, for example 2026-10-14T13:00:00Z.");
  return at;
}

// ── conditions ────────────────────────────────────────────────────────
// The condition language of the plugin's routines and actions:
//   <path> is set | is empty | is true | is false
//   <path> ~ regex | !~ regex | = text | != text | in a,b | !in a,b
//   <path> > n | < n   (two date-times compare as instants; a list by its length)
//   <path> newer than 7d | older than 48h
// joined with &&. A path is dotted (`company.id`, `items.0.name`).

const COND_RE = /^\s*([A-Za-z_][\w.]*)\s+(is set|is empty|is true|is false|!in\b|in\b|newer than|older than|!~|~|!=|=|>|<)\s*(.*)$/;
const SPAN_RE = /^(\d+(?:\.\d+)?)\s*([dh])$/;

function spanMs(arg: string): number {
  const m = SPAN_RE.exec(arg.trim());
  if (!m) fail(`bad span ${JSON.stringify(arg)}: write 7d or 48h`);
  return Number(m[1]) * (m[2] === "d" ? DAY_MS : 3_600_000);
}

function toNumber(value: unknown): number | null {
  if (Array.isArray(value)) return value.length;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// The pattern comes from the model (and maybe a ticket's text) and runs in
// the proxy's event loop: both it and the text it is tried on are capped.
export const FLOW_REGEX_MAX_PATTERN = 200;
export const FLOW_REGEX_MAX_TEXT = 10_000;

// A length cap does not stop catastrophic backtracking ((a+)+$, (a|a)*$,
// .*.*.*x take seconds on a few dozen characters), and no shape check
// catches them all. So every model-written pattern runs on V8's linear-time
// engine (the `l` flag): what it cannot run in linear time (back references,
// lookarounds) is refused. The engine has no `i` flag: the pattern and the
// text are folded to lower case instead (escapes kept as written).
let linearEngine = false;

function linearRegex(pattern: string, flags = ""): RegExp {
  if (!linearEngine) {
    setFlagsFromString("--enable-experimental-regexp-engine");
    linearEngine = true;
  }
  return new RegExp(pattern, `${flags}l`);
}

/** The pattern in lower case, outside escapes (`\D`, `\p{Lu}` keep their meaning). */
function foldPattern(pattern: string): string {
  let out = "";
  for (let i = 0; i < pattern.length; i += 1) {
    if (pattern[i] !== "\\") { out += pattern[i]!.toLowerCase(); continue; }
    const close = /[pP]/.test(pattern[i + 1] ?? "") && pattern[i + 2] === "{" ? pattern.indexOf("}", i) : -1;
    const end = close === -1 ? i + 1 : close;
    out += pattern.slice(i, end + 1);
    i = end;
  }
  return out;
}

function conditionRegex(pattern: string, part: string): RegExp {
  if (pattern.length > FLOW_REGEX_MAX_PATTERN) fail(`regular expression longer than ${FLOW_REGEX_MAX_PATTERN} characters in ${JSON.stringify(part.slice(0, 80))}`);
  try { return linearRegex(foldPattern(pattern)); } catch {
    fail(`bad or unsupported regular expression in ${JSON.stringify(part.slice(0, 80))} (back references and lookarounds are not supported)`);
  }
}

/** Throws on a malformed condition (so a list can be checked up front). */
export function checkCondition(cond: string): void {
  for (const part of cond.split("&&").map((p) => p.trim())) {
    const m = COND_RE.exec(part);
    if (!m) fail(`bad condition ${JSON.stringify(part)}`);
    if (m[2] === "newer than" || m[2] === "older than") spanMs(m[3]!);
    if (m[2] === "~" || m[2] === "!~") conditionRegex(m[3]!.trim(), part);
  }
}

/** Whether every part of `cond` holds for `item`. */
export function evalCondition(cond: string, item: unknown, now: number): boolean {
  for (const part of cond.split("&&").map((p) => p.trim())) {
    const m = COND_RE.exec(part);
    if (!m) fail(`bad condition ${JSON.stringify(part)}`);
    const value = getPath(item, m[1]!);
    const op = m[2]!;
    const arg = m[3]!.trim();
    let ok: boolean;
    if (op === "is set") ok = !isEmpty(value);
    else if (op === "is empty") ok = isEmpty(value);
    else if (op === "is true") ok = value === true;
    else if (op === "is false") ok = value === false;
    else if (op === "~" || op === "!~") {
      const found = conditionRegex(arg, part).test(asText(value).slice(0, FLOW_REGEX_MAX_TEXT).toLowerCase());
      ok = op === "~" ? found : !found;
    } else if (op === "=" || op === "!=") ok = (asText(value) === arg) === (op === "=");
    else if (op === "in" || op === "!in") {
      const wanted = new Set(arg.split(",").map((w) => w.trim()).filter(Boolean));
      const got = Array.isArray(value) ? value : [value];
      const found = got.some((v) => !isEmpty(v) && wanted.has(asText(v)));
      ok = op === "in" ? found : !found;
    } else if (op === "newer than" || op === "older than") {
      const at = parseMoment(value);
      if (at === null) ok = false;
      else ok = op === "newer than" ? now - at < spanMs(arg) : now - at > spanMs(arg);
    } else {
      const left = parseMoment(value), right = parseMoment(arg);
      if (left !== null && right !== null) ok = op === ">" ? left > right : left < right;
      else {
        const num = toNumber(value), bound = toNumber(arg);
        ok = num !== null && bound !== null && (op === ">" ? num > bound : num < bound);
      }
    }
    if (!ok) return false;
  }
  return true;
}

function conditionsArg(value: unknown, name: string): string[] {
  const list = stringList(value, name);
  for (const cond of list) {
    try { checkCondition(cond); } catch (error) { fail(`${name}: ${(error as Error).message}`); }
  }
  return list;
}

// ── flow_free_slots ───────────────────────────────────────────────────

interface Slot {
  day: string;
  start: string;
  end: string;
  start_local: string;
  end_local: string;
  minutes: number;
  hole_end_local: string;
}

function isDateOnly(item: Item, startField: string, endField: string): boolean {
  const a = String(item[startField] ?? ""), b = String(item[endField] ?? "");
  return a.endsWith("T00:00:00Z") && (!b || b.endsWith("T00:00:00Z"));
}

/** The free holes of one person's schedule, earliest first, one slot per
 * hole, from `after` on, over `days` working days. */
export function freeSlots(args: Item, clock: number): { slots: Slot[] } {
  const zone = timeZoneArg(args.time_zone);
  const now = nowArg(args.now, clock);
  const items = itemsArg(args.items, "items", false);
  const startField = stringArg(args.start_field, "start_field", "dateStart");
  const endField = stringArg(args.end_field, "end_field", "dateEnd");
  const occupies = conditionsArg(args.occupies, "occupies");
  const wholeDayWhen = conditionsArg(args.whole_day_when, "whole_day_when");
  const minutes = Math.max(intArg(args.minutes, "minutes", undefined, 1, 1440), intArg(args.min_minutes, "min_minutes", 0, 0, 1440));
  const grid = intArg(args.grid, "grid", 15, 1, 60);
  const limit = intArg(args.limit, "limit", 5, 1, 100);
  const maxDays = intArg(args.days, "days", 5, 1, 60);
  const until = args.until === undefined || args.until === null || args.until === "" ? null : parseMoment(args.until);
  if (args.until && until === null) fail("until must be an ISO 8601 date-time.");
  const calendar = args.calendar === undefined || args.calendar === null ? null : args.calendar;
  if (calendar !== null && !isRecord(calendar)) fail("calendar must be an object with <weekday>StartTime and <weekday>EndTime (local HH:MM), or null.");
  const defaultWindow = stringList(args.default_window, "default_window").map((hm) => hmMinutes(hm));
  if (defaultWindow.length && (defaultWindow.length !== 2 || defaultWindow.some((m) => m === null))) fail("default_window must be two local times [HH:MM, HH:MM].");
  const lunch = stringList(args.lunch, "lunch").map((hm) => hmMinutes(hm));
  if (lunch.length && (lunch.length !== 2 || lunch.some((m) => m === null))) fail("lunch must be two local times [HH:MM, HH:MM].");
  const afters = [...stringList(args.after, "after"), utcIso(now)].map(parseMoment).filter((at): at is number => at !== null);
  const after = Math.max(...afters);

  const holidays = new Map<string, Item[]>();
  for (const holiday of itemsArg(args.holidays, "holidays", false)) {
    const day = String(holiday.date ?? "").slice(0, 10);
    if (day) holidays.set(day, [...(holidays.get(day) ?? []), holiday]);
  }
  // the days the search below can visit: a whole-day item is only walked
  // inside them, so a leave spanning centuries costs no more than the search
  const searchSteps = maxDays * 3 + 7;
  const firstDay = localDayOf(after, zone), lastDay = addDays(firstDay, searchSteps - 1);
  const busyFixed: Array<[number, number]> = [];
  const blockedDays = new Set<string>();
  for (const item of items) {
    if (isDateOnly(item, startField, endField)) {
      if (wholeDayWhen.length && wholeDayWhen.every((c) => evalCondition(c, item, now))) {
        const a = localDay(item[startField], zone);
        let b = localDay(item[endField] || item[startField], zone) ?? a;
        // a date-only end is the next midnight: exclusive
        if (a !== null && b !== null && b > a) b = addDays(b, -1);
        if (a === null || b === null) continue;
        const to = b < lastDay ? b : lastDay;
        for (let d = a > firstDay ? a : firstDay; d <= to; d = addDays(d, 1)) blockedDays.add(d);
      }
      continue;
    }
    const a = parseMoment(item[startField]), b = parseMoment(item[endField]);
    if (a === null || b === null || b <= a) continue;
    if (occupies.every((c) => evalCondition(c, item, now))) busyFixed.push([a, b]);
  }
  for (const interval of itemsArg(args.busy, "busy", false)) {
    const a = parseMoment(interval.start), b = parseMoment(interval.end);
    if (a !== null && b !== null && b > a) busyFixed.push([a, b]);
  }

  const slots: Slot[] = [];
  let day = firstDay;
  let counted = 0;
  for (let step = 0; step < searchSteps; step += 1, day = addDays(day, 1)) {
    if (counted >= maxDays || slots.length >= limit) break;
    const weekday = weekdayOf(day);
    let windowStart: number | null, windowEnd: number | null;
    if (calendar) {
      const name = WEEKDAY_NAMES[weekday]!;
      windowStart = hmMinutes(calendar[`${name}StartTime`]);
      windowEnd = hmMinutes(calendar[`${name}EndTime`]);
    } else if (weekday >= 1 && weekday <= 5 && defaultWindow.length === 2) {
      [windowStart, windowEnd] = defaultWindow as [number, number];
    } else {
      windowStart = windowEnd = null;
    }
    const dayHolidays = holidays.get(day) ?? [];
    if (windowStart === null || windowEnd === null || dayHolidays.some((h) => h.allDayFlag !== false && hmMinutes(h.timeStart) === null)) continue;
    counted += 1;
    if (blockedDays.has(day)) continue;
    const wStart = localAt(day, windowStart, zone), wEnd = localAt(day, windowEnd, zone);
    const busy = busyFixed.filter(([a, b]) => b > wStart && a < wEnd);
    if (lunch.length === 2) busy.push([localAt(day, lunch[0]!, zone), localAt(day, lunch[1]!, zone)]);
    for (const holiday of dayHolidays) {
      const hs = hmMinutes(holiday.timeStart), he = hmMinutes(holiday.timeEnd);
      if (hs !== null && he !== null) busy.push([localAt(day, hs, zone), localAt(day, he, zone)]);
    }
    busy.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    let cursor = Math.max(wStart, after);
    const holes: Array<[number, number]> = [];
    for (const [a, b] of [...busy, [wEnd, wEnd] as [number, number]]) {
      if (a > cursor) holes.push([cursor, Math.min(a, wEnd)]);
      cursor = Math.max(cursor, b);
      if (cursor >= wEnd) break;
    }
    for (const [holeStart, holeEnd] of holes) {
      const local = zonedParts(holeStart, zone);
      const extra = ((-(local.minute % grid)) % grid + grid) % grid;
      let start = Math.floor(holeStart / MINUTE_MS) * MINUTE_MS + extra * MINUTE_MS;
      // a hole that starts between two minutes starts at the next grid line
      if (holeStart % MINUTE_MS !== 0 && extra === 0) start += grid * MINUTE_MS;
      const end = start + minutes * MINUTE_MS;
      if (until !== null && end > until) break;
      if (end <= holeEnd) {
        slots.push({
          day, start: utcIso(start), end: utcIso(end),
          start_local: localHm(start, zone), end_local: localHm(end, zone),
          minutes, hole_end_local: localHm(holeEnd, zone),
        });
        if (slots.length >= limit) break;
      }
    }
  }
  return { slots };
}

// ── flow_time_block, flow_overlaps ────────────────────────────────────

/** How many items have a [start, end) span that overlaps [start, end); a
 * date-only or unreadable item never overlaps. */
export function overlapping(items: readonly Item[], start: number, end: number, startField: string, endField: string): Item[] {
  const hits: Item[] = [];
  for (const item of items) {
    const s0 = getPath(item, startField), e0 = getPath(item, endField);
    if (typeof s0 === "string" && /T00:00:00(\.0+)?Z$/.test(s0) && (!e0 || String(e0).slice(0, 10) !== s0.slice(0, 10) || e0 === s0)) continue;
    const x = parseMoment(s0), y = parseMoment(e0);
    if (x !== null && y !== null && x < end && start < y) hits.push(item);
  }
  return hits;
}

function idsOf(items: readonly Item[]): unknown[] {
  return items.map((item) => item.id ?? null);
}

export function overlaps(args: Item): { count: number; ids: unknown[] } {
  const start = parseMoment(args.start), end = parseMoment(args.end);
  if (start === null || end === null || end <= start) fail("start and end must be ISO 8601 date-times, end after start.");
  const hits = overlapping(itemsArg(args.items, "items"), start, end, stringArg(args.start_field, "start_field", "dateStart"), stringArg(args.end_field, "end_field", "dateEnd"));
  return { count: hits.length, ids: idsOf(hits) };
}

interface BlockRow {
  day: string;
  start: string;
  end: string;
  start_local: string;
  end_local: string;
  hours: number;
  overlaps?: { count: number; ids: unknown[] };
}

/** One local time block as UTC rows: a block whose end is at or before its
 * start crosses local midnight and becomes two rows, the first ending at
 * the organization's split end time, the second starting at 00:00. */
export function timeBlock(args: Item): { crosses_midnight: boolean; rows: BlockRow[]; hours: number } {
  const zone = timeZoneArg(args.time_zone);
  const day = dayArg(args.day, "day");
  const start = hmArg(args.start, "start");
  const end = hmArg(args.end, "end");
  if (start >= 1440 || end >= 1440) fail("start and end must be before 24:00.");
  const crosses = end <= start;
  let firstEnd = end;
  if (crosses) {
    if (args.midnight_split_end === undefined || args.midnight_split_end === null || args.midnight_split_end === "") {
      fail("This block crosses midnight: pass midnight_split_end, the local time the organization ends the first day's row at (from its own settings, for example 23:59 or 24:00).");
    }
    firstEnd = hmArg(args.midnight_split_end, "midnight_split_end");
    if (firstEnd <= start) fail("midnight_split_end must be later than start.");
  }
  const spans: Array<[string, number, number]> = [[day, start, firstEnd]];
  if (crosses && end > 0) spans.push([addDays(day, 1), 0, end]);
  const existing = args.existing === undefined || args.existing === null ? null : itemsArg(args.existing, "existing");
  const startField = stringArg(args.start_field, "start_field", "timeStart");
  const endField = stringArg(args.end_field, "end_field", "timeEnd");
  const rows = spans.map(([d, a, b]): BlockRow => {
    const at = localAt(d, a, zone), until = localAt(d, b, zone);
    const row: BlockRow = {
      day: d, start: utcIso(at), end: utcIso(until),
      start_local: localHm(at, zone), end_local: localHm(until, zone),
      hours: Math.round((until - at) / 36_000) / 100,
    };
    if (existing) {
      const hits = overlapping(existing, at, until, startField, endField);
      row.overlaps = { count: hits.length, ids: idsOf(hits) };
    }
    return row;
  });
  return { crosses_midnight: crosses, rows, hours: Math.round(rows.reduce((sum, row) => sum + row.hours * 100, 0)) / 100 };
}

// ── flow_stats ────────────────────────────────────────────────────────
// Exact decimal arithmetic (the plugin's no-mental-math rule): values are
// scaled to integers by their own decimals, never added as floats.

function decimalParts(value: number): { digits: bigint; scale: number } {
  // the shortest decimal JavaScript prints, exponent form (1e-7, 1e21) included
  const [mantissa, exp = "0"] = value.toString().split(/e/i) as [string, string?];
  const [whole, frac = ""] = mantissa.replace("-", "").split(".") as [string, string?];
  const scale = frac.length - Number(exp);
  const digits = BigInt((value < 0 ? "-" : "") + whole + frac);
  return scale >= 0 ? { digits, scale } : { digits: digits * 10n ** BigInt(-scale), scale: 0 };
}

function scaled(value: number, scale: number): bigint {
  const { digits, scale: own } = decimalParts(value);
  if (own <= scale) return digits * 10n ** BigInt(scale - own);
  // more decimals than the cap (0.1 + 0.2, 1/3): round half away from zero
  const div = 10n ** BigInt(own - scale);
  return (digits + (digits < 0n ? -div / 2n : div / 2n)) / div;
}

function unscale(value: bigint, scale: number): number {
  const negative = value < 0n;
  const text = (negative ? -value : value).toString().padStart(scale + 1, "0");
  const whole = text.slice(0, text.length - scale), frac = scale ? text.slice(text.length - scale) : "";
  return Number(`${negative ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`);
}

export function stats(args: Item): { count: number; sum: number | null; min: number | null; max: number | null; mean: number | null; median: number | null; skipped: number } {
  let raw: unknown[];
  if (args.values !== undefined) {
    if (!Array.isArray(args.values) || args.values.length > FLOW_MAX_ITEMS) fail(`values must be a list of at most ${FLOW_MAX_ITEMS} numbers.`);
    raw = args.values;
  } else {
    const field = stringArg(args.field, "field", "");
    if (!field) fail("Pass values (numbers), or items with field (a dotted path).");
    raw = itemsArg(args.items, "items").map((item) => getPath(item, field)).filter((v) => !isEmpty(v));
  }
  const numbers = raw.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const skipped = raw.length - numbers.length;
  if (!numbers.length) return { count: 0, sum: null, min: null, max: null, mean: null, median: null, skipped };
  const scale = Math.min(12, Math.max(...numbers.map((n) => decimalParts(n).scale)));
  const ints = numbers.map((n) => scaled(n, scale)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const total = ints.reduce((sum, n) => sum + n, 0n);
  const mid = Math.floor(ints.length / 2);
  // one more decimal for a mean of the two middle values or of the whole list
  const median = ints.length % 2 ? unscale(ints[mid]! * 10n, scale + 1) : unscale((ints[mid - 1]! + ints[mid]!) * 5n, scale + 1);
  const meanScale = scale + 6;
  const mean = unscale((total * 10n ** 6n) / BigInt(ints.length), meanScale);
  return {
    count: ints.length, sum: unscale(total, scale), min: unscale(ints[0]!, scale), max: unscale(ints[ints.length - 1]!, scale),
    mean, median, skipped,
  };
}

// ── flow_age_buckets ──────────────────────────────────────────────────

export function ageBuckets(args: Item, clock: number): { total: number; unreadable: number; buckets: Array<{ label: string; min_days: number; max_days: number | null; count: number; share: number }> } {
  const zone = timeZoneArg(args.time_zone);
  const now = nowArg(args.now, clock);
  const field = stringArg(args.field, "field", "");
  if (!field) fail("field is required: the dotted path of the date to age from, for example _info.dateEntered.");
  const bounds = args.bounds === undefined ? [7, 30, 90] : args.bounds;
  if (!Array.isArray(bounds) || !bounds.length || bounds.length > 12 || !bounds.every((b, i) => Number.isInteger(b) && b >= 0 && (i === 0 || b > bounds[i - 1]))) {
    fail("bounds must be increasing whole days, for example [7, 30, 90].");
  }
  const edges = bounds as number[];
  const buckets = [...edges.map((b, i) => ({ min: i ? edges[i - 1]! + 1 : 0, max: b as number | null })), { min: edges[edges.length - 1]! + 1, max: null }]
    .map(({ min, max }) => ({ label: max === null ? `${min}+` : `${min}-${max}`, min_days: min, max_days: max, count: 0, share: 0 }));
  const today = localDayOf(now, zone);
  let unreadable = 0;
  const items = itemsArg(args.items, "items");
  for (const item of items) {
    const day = localDay(getPath(item, field), zone);
    if (day === null) { unreadable += 1; continue; }
    const age = Math.max(0, daysBetween(day, today));
    buckets.find((b) => b.max_days === null || age <= b.max_days)!.count += 1;
  }
  const total = items.length - unreadable;
  for (const bucket of buckets) bucket.share = total ? Math.round((bucket.count * 1000) / total) / 10 : 0;
  return { total, unreadable, buckets };
}

// ── flow_group_units ──────────────────────────────────────────────────
// fan_out.group_by of the plugin: units that share every value of one key
// set form one group; with several sets (alternatives) a unit joins when one
// set matches, and the links chain. `similar` is the computed key "same
// sender, same normalized subject, same devices or serials".

const SIMILAR_PREFIXES = new Set(["re", "tr", "fw", "fwd", "rep", "aw", "wg", "sv", "resolved", "resolu", "cleared", "recovered"]);
const SIMILAR_WORDS = 10;
const EMAIL = `[\\p{L}\\p{N}_.+-]+@[\\p{L}\\p{N}_-]+(?:\\.[\\p{L}\\p{N}_-]+)+`;
const SIMILAR_EMAIL = new RegExp(EMAIL, "u");
const SIMILAR_FROM = new RegExp(`^\\s*(?:from|de)\\s*:[^\\n]*?(${EMAIL})`, "imu");
const SIMILAR_DEVICE = /(?<![A-Za-z0-9])(?=[A-Za-z0-9-]*[A-Za-z])(?=[A-Za-z0-9-]*\d)[A-Za-z0-9][A-Za-z0-9-]{4,}(?![A-Za-z0-9])/g;
const SIMILAR_HEADER = /^\s*(?:from|de|to|à|a|cc|sent|envoy[ée]|date|subject|objet|reply-to)\s*:.*$/gimu;
const SIMILAR_SERIAL = /(?:serial(?:\s+(?:number|no\.?))?|s\/n|sn|num[ée]ro\s+de\s+s[ée]rie|service\s+tag)\s*[:#=]\s*([A-Za-z0-9][A-Za-z0-9-]{3,})/giu;
const SIMILAR_SENDER_FIELDS = ["contactEmailAddress", "senderEmailAddress", "sender", "from"] as const;
const SIMILAR_BODY_FIELDS = ["initialDescription", "description"] as const;

function similarSender(unit: Item): string {
  for (const field of SIMILAR_SENDER_FIELDS) {
    const value = unit[field];
    const m = typeof value === "string" ? SIMILAR_EMAIL.exec(value) : null;
    if (m) return m[0].toLowerCase();
  }
  for (const field of SIMILAR_BODY_FIELDS) {
    const value = unit[field];
    const m = typeof value === "string" ? SIMILAR_FROM.exec(value) : null;
    if (m) return m[1]!.toLowerCase();
  }
  return "";
}

function similarWords(text: string): string[] {
  const folded = text.replace(/\[[^\]]*\]|\([^)]*\)/g, " ").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  const words = folded.split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !/\d/.test(w));
  while (words.length && SIMILAR_PREFIXES.has(words[0]!)) words.shift();
  return words.slice(0, SIMILAR_WORDS);
}

/** The `similar` key of a unit, or null (no sender or no words: it stays alone). */
export function similarKey(unit: unknown): string | null {
  if (!isRecord(unit)) return null;
  const summary = typeof unit.summary === "string" ? unit.summary : "";
  const body = typeof unit.initialDescription === "string" ? unit.initialDescription : "";
  const devices = new Set<string>();
  for (const m of summary.matchAll(SIMILAR_DEVICE)) devices.add(m[0].toUpperCase());
  for (const m of body.matchAll(SIMILAR_SERIAL)) devices.add(m[1]!.toUpperCase());
  let words = similarWords(summary);
  let origin = "";
  if (!words.length && body) {
    words = similarWords(body.replace(SIMILAR_HEADER, " ").replace(new RegExp(`${EMAIL}|https?://\\S+`, "gu"), " "));
    origin = "body:";
  }
  const sender = similarSender(unit);
  if (!words.length || !sender) return null;
  return `${origin}${words.join(" ")}|${sender}|${[...devices].sort().join(",")}`;
}

function keyHash(key: string): string {
  return createHash("sha1").update(key, "utf8").digest("hex").slice(0, 10);
}

const FS_RESERVED = new Set(["CON", "PRN", "AUX", "NUL", ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`), ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`)]);

/** A file-name-safe segment, stable across runs. */
function fsSafe(text: string): string {
  const s = text.replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^[.-]+|[.-]+$/g, "") || "x";
  return FS_RESERVED.has(s.split(".")[0]!.toUpperCase()) ? `x-${s}` : s;
}

function pyText(value: unknown): string {
  if (value === true) return "True";
  if (value === false) return "False";
  return typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
}

function groupValue(unit: Item, path: string): unknown {
  return path === "similar" ? similarKey(unit) : getPath(unit, path);
}

/** The key of a unit under one set, or null: an empty value, or several
 * resources when the set holds `resources`. */
function groupKey(unit: Item, keys: readonly string[]): string | null {
  const values = keys.map((k) => groupValue(unit, k));
  if (values.some(isEmpty) || (keys.includes("resources") && asText(unit.resources).includes(","))) return null;
  return values.map(pyText).join("|");
}

/** A group's id part: a key holding `similar` or an address is never spelled out. */
function groupSlug(key: string, sets: string[][], alternatives: boolean): string {
  const sep = key.indexOf(":");
  const index = alternatives && sep > 0 && /^\d+$/.test(key.slice(0, sep)) ? Number(key.slice(0, sep)) : 0;
  const keys = sets[index] ?? [];
  if (keys.includes("similar") || SIMILAR_EMAIL.test(key)) return `similar-${keyHash(key)}`;
  const slug = fsSafe(key);
  return slug.length <= 60 ? slug : `${slug.slice(0, 60)}-${keyHash(key).slice(0, 8)}`;
}

function unitSortKey(unit: Item): [number, number, string] {
  const id = unit.id;
  const n = id !== null && id !== undefined && String(id).trim() !== "" && /^-?\d+$/.test(String(id).trim()) ? Number(id) : null;
  return n !== null ? [0, n, ""] : [1, 0, String(id)];
}

function compareSort(a: [string, [number, number, string]], b: [string, [number, number, string]]): number {
  if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
  const [x, y] = [a[1], b[1]];
  return x[0] - y[0] || x[1] - y[1] || (x[2] < y[2] ? -1 : x[2] > y[2] ? 1 : 0);
}

function groupSetsArg(value: unknown): string[][] {
  if (Array.isArray(value) && value.length && value.every((g) => typeof g === "string" && g)) return [value as string[]];
  if (Array.isArray(value) && value.length && value.every((ks) => Array.isArray(ks) && ks.length && ks.every((g) => typeof g === "string" && g))) return value as string[][];
  fail("group_by must be a list of unit paths or `similar` (one set), or a list of such lists (alternative sets), for example [[\"company.id\", \"resources\"], [\"similar\"]].");
}

export interface UnitGroup {
  id: string;
  units: unknown[];
  lot?: { n: number; of: number; group_size: number };
}

export function groupUnits(args: Item): { groups: UnitGroup[]; alone: unknown[]; grouped_units: number } {
  const units = itemsArg(args.units, "units");
  const sets = groupSetsArg(args.group_by);
  const groupMax = args.group_max === undefined || args.group_max === null ? null : intArg(args.group_max, "group_max", undefined, 2, FLOW_MAX_ITEMS);
  const alternatives = sets.length > 1;
  if (sets.some((ks) => ks.includes("similar")) && units.length > 1
    && !units.some((u) => [...SIMILAR_SENDER_FIELDS, ...SIMILAR_BODY_FIELDS].some((f) => f in u))) {
    fail("group_by `similar` needs the sender, and no unit carries contactEmailAddress (nor initialDescription): read the units again with that field.");
  }
  const parent = units.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const firstKey = new Map<number, string>();
  sets.forEach((keys, n) => {
    const seen = new Map<string, number>();
    units.forEach((unit, i) => {
      let key = groupKey(unit, keys);
      if (key === null) return;
      key = alternatives ? `${n}:${key}` : key;
      if (!firstKey.has(i)) firstKey.set(i, key);
      const prior = seen.get(key);
      if (prior === undefined) { seen.set(key, i); return; }
      const a = find(prior), b = find(i);
      if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
    });
  });
  const comps = new Map<number, number[]>();
  units.forEach((_, i) => {
    const root = find(i);
    comps.set(root, [...(comps.get(root) ?? []), i]);
  });
  const taken = new Set<string>();
  const uniqueId = (raw: string): string => {
    let id = fsSafe(raw);
    if (taken.has(id)) id = `${id}-${createHash("sha1").update(raw, "utf8").digest("hex").slice(0, 8)}`;
    taken.add(id);
    return id;
  };
  const groups: UnitGroup[] = [];
  const alone: unknown[] = [];
  let grouped = 0;
  for (const root of [...comps.keys()].sort((a, b) => a - b)) {
    const idx = comps.get(root)!;
    if (idx.length === 1) { alone.push(units[idx[0]!]); continue; }
    const k = firstKey.get(idx[0]!) ?? firstKey.get(idx.find((i) => firstKey.has(i))!)!;
    let raw = `group-${groupSlug(k, sets, alternatives)}`;
    let lots: number[][] = [idx];
    if (groupMax && idx.length > groupMax) {
      const order = [...idx].sort((a, b) => compareSort([firstKey.get(a) ?? "", unitSortKey(units[a]!)], [firstKey.get(b) ?? "", unitSortKey(units[b]!)]));
      lots = [];
      for (let i = 0; i < order.length; i += groupMax) lots.push(order.slice(i, i + groupMax));
      const low = order[0]!;
      raw = `group-${fsSafe(`${groupSlug(firstKey.get(low)!, sets, alternatives).slice(0, 40)}-${pyText(units[low]!.id)}`)}`;
    }
    lots.forEach((lot, n) => {
      if (lot.length === 1) { alone.push(units[lot[0]!]); return; }
      grouped += lot.length;
      groups.push({
        id: uniqueId(lots.length === 1 ? raw : `${raw}-lot${n + 1}`),
        units: lot.map((i) => units[i]),
        ...(lots.length > 1 ? { lot: { n: n + 1, of: lots.length, group_size: idx.length } } : {}),
      });
    });
  }
  return { groups, alone, grouped_units: grouped };
}

// ── flow_filter ───────────────────────────────────────────────────────

/** A title motif, without regard to case: a glob when it holds * ? or [,
 * otherwise a substring. */
function titleMotif(name: string, motif: string): boolean {
  // collapse runs of * and cap both sides: a glob is compiled to a regex,
  // run on the linear-time engine (*a*a*a*b backtracks otherwise)
  const folded = name.toLowerCase().slice(0, FLOW_REGEX_MAX_TEXT), wanted = motif.toLowerCase().replace(/\*{2,}/g, "*").slice(0, FLOW_REGEX_MAX_PATTERN);
  if (!/[*?[]/.test(motif)) return folded.includes(wanted);
  let pattern = "";
  for (let i = 0; i < wanted.length; i += 1) {
    const c = wanted[i]!;
    if (c === "*") pattern += ".*";
    else if (c === "?") pattern += ".";
    else if (c === "[") {
      const close = wanted.indexOf("]", i + 2);
      if (close === -1) { pattern += "\\["; continue; }
      let body = wanted.slice(i + 1, close);
      body = body.startsWith("!") ? `^${body.slice(1).replace(/\\/g, "\\\\")}` : body.replace(/\\/g, "\\\\");
      pattern += `[${body}]`;
      i = close;
    } else pattern += c.replace(/[.+^${}()|\\/]/g, "\\$&");
  }
  let compiled: RegExp;
  try { compiled = linearRegex(`^${pattern}$`, "s"); } catch { fail(`bad title motif ${JSON.stringify(motif.slice(0, 80))}`); }
  return compiled.test(folded);
}

export function filterItems(args: Item, clock: number): { kept: unknown[]; dropped: number; excluded: Array<{ item: unknown; reason: string }> } {
  const now = nowArg(args.now, clock);
  const items = itemsArg(args.items, "items");
  const where = conditionsArg(args.where, "where");
  const unless = conditionsArg(args.unless, "unless");
  const exclude = args.exclude === undefined || args.exclude === null ? null : args.exclude;
  if (exclude !== null && !isRecord(exclude)) fail("exclude must be {ids, titles, id_field, title_field}.");
  const ids = new Set((exclude?.ids === undefined ? [] : Array.isArray(exclude.ids) ? exclude.ids : fail("exclude.ids must be a list."))
    .map((raw) => asText(isRecord(raw) ? raw.id : raw)).filter(Boolean));
  const motifs = (exclude?.titles === undefined ? [] : Array.isArray(exclude.titles) ? exclude.titles : fail("exclude.titles must be a list."))
    .map((raw) => (typeof raw === "string" ? raw : isRecord(raw) && typeof raw.title === "string" ? raw.title : "")).filter(Boolean);
  const idField = stringArg(exclude?.id_field, "exclude.id_field", "id");
  const titleField = stringArg(exclude?.title_field, "exclude.title_field", "name");
  const kept: unknown[] = [];
  const excluded: Array<{ item: unknown; reason: string }> = [];
  let dropped = 0;
  for (const item of items) {
    if (!where.every((c) => evalCondition(c, item, now)) || unless.some((c) => evalCondition(c, item, now))) { dropped += 1; continue; }
    const ident = asText(getPath(item, idField));
    if (ident && ids.has(ident)) { excluded.push({ item, reason: "id" }); continue; }
    const name = asText(getPath(item, titleField));
    const hit = motifs.find((motif) => titleMotif(name, motif));
    if (hit) { excluded.push({ item, reason: `title: ${hit}` }); continue; }
    kept.push(item);
  }
  return { kept, dropped, excluded };
}

// ── flow_member_load ──────────────────────────────────────────────────

/** The longest entry flow_member_load cuts into days, and the most day cuts
 * of one call (each costs time-zone math: 5,000 year-long entries took 30 s). */
export const FLOW_MAX_SPAN_DAYS = 366;
export const FLOW_MAX_DAY_CUTS = 50_000;

/** Booked hours per person and local day of the timed, blocking, not done
 * entries, cut at each local midnight. */
export function memberLoad(args: Item): { load: Record<string, Record<string, number>>; member?: { member: string; day: string; hours: number; window: Record<string, number>; window_hours: number }; ranking?: Array<{ member: string; window_hours: number }> } {
  const zone = timeZoneArg(args.time_zone);
  const memberField = stringArg(args.member_field, "member_field", "member");
  const load: Record<string, Record<string, number>> = {};
  let cuts = 0;
  for (const row of itemsArg(args.entries, "entries")) {
    if (row.blocking === false || row.doneFlag === true) continue;
    const ref = getPath(row, memberField);
    const member = isRecord(ref) ? asText(ref.identifier ?? ref.name) : asText(ref);
    const start = parseMoment(row.dateStart), end = parseMoment(row.dateEnd);
    if (!member || start === null || end === null || end <= start) continue;
    // one cut per local day: a span of centuries would loop millions of times
    if (end - start > FLOW_MAX_SPAN_DAYS * DAY_MS) fail(`entry ${JSON.stringify(asText(row.id ?? member))} spans more than ${FLOW_MAX_SPAN_DAYS} days; pass timed schedule entries.`);
    let cursor = start;
    while (cursor < end) {
      cuts += 1;
      if (cuts > FLOW_MAX_DAY_CUTS) fail(`entries cover more than ${FLOW_MAX_DAY_CUTS} person-days; pass fewer or shorter entries (only the days you need).`);
      const day = localDayOf(cursor, zone);
      const midnight = localAt(addDays(day, 1), 0, zone);
      const next = midnight > cursor ? Math.min(end, midnight) : end;
      const per = (load[member] ??= {});
      per[day] = Math.round(((per[day] ?? 0) + (next - cursor) / 3_600_000) * 100) / 100;
      cursor = next;
    }
  }
  if (args.day === undefined || args.day === null) return { load };
  const day = dayArg(args.day, "day");
  const span = intArg(args.business_days, "business_days", 2, 0, 20);
  const windowDays = [day];
  for (let d = day; windowDays.length < span + 1;) {
    d = addDays(d, 1);
    const wd = weekdayOf(d);
    if (wd >= 1 && wd <= 5) windowDays.push(d);
  }
  const fold = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  const windowFor = (member: string) => {
    const per = load[member] ?? Object.entries(load).find(([k]) => fold(k) === fold(member))?.[1] ?? {};
    const window = Object.fromEntries(windowDays.map((d) => [d, per[d] ?? 0]));
    return { window, window_hours: Math.round(Object.values(window).reduce((sum, h) => sum + h * 100, 0)) / 100 };
  };
  const ranking = stringList(args.members, "members").map((member) => ({ member, window_hours: windowFor(member).window_hours }))
    .sort((a, b) => a.window_hours - b.window_hours || (a.member < b.member ? -1 : 1));
  const member = typeof args.member === "string" && args.member ? args.member : null;
  return {
    load,
    ...(member ? { member: { member, day, hours: windowFor(member).window[day]!, ...windowFor(member) } } : {}),
    ...(ranking.length ? { ranking } : {}),
  };
}

// ── the MCP surface ───────────────────────────────────────────────────

const ZONE = { type: "string", description: "IANA time zone of the local days and times, for example America/Toronto. Default UTC." } as const;
const NOW = { type: "string", description: "ISO 8601 date-time to compute from instead of the current time." } as const;
const ITEMS = { type: "array", items: { type: "object" } } as const;
const CONDITIONS = {
  type: "array", items: { type: "string" },
  description: "Conditions on a dotted path, all must hold: `<path> is set|is empty|is true|is false`, `~ regex`, `!~ regex`, `= text`, `!= text`, `in a,b`, `!in a,b`, `> n`, `< n` (date-times compare as instants), `newer than 7d`, `older than 48h`; join parts with &&.",
} as const;
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

export const FLOW_TOOLS = [
  {
    name: "flow_free_slots",
    description: "Free holes in one person's schedule, earliest first, one slot per hole: working window per weekday from calendar (or default_window Monday to Friday), minus items that occupy, whole-day items, holidays, lunch and busy intervals; starts on the grid. Pure computation over the data you pass; read the schedule, calendar and holidays with your tools first.",
    inputSchema: {
      type: "object", additionalProperties: false, required: ["minutes"],
      properties: {
        time_zone: ZONE, now: NOW,
        items: { ...ITEMS, description: "Schedule entries with start_field and end_field (ISO date-times); date-only values are whole days." },
        start_field: { type: "string", description: "Default dateStart." },
        end_field: { type: "string", description: "Default dateEnd." },
        occupies: { ...CONDITIONS, description: `Which timed items occupy their span (default: all). ${CONDITIONS.description}` },
        whole_day_when: { ...CONDITIONS, description: `Which date-only items block their whole day(s) (default: none). ${CONDITIONS.description}` },
        calendar: { type: "object", description: "Working hours: mondayStartTime, mondayEndTime, ... sundayEndTime (local HH:MM); a day without both is not worked." },
        default_window: { type: "array", items: { type: "string" }, description: "[HH:MM, HH:MM] Monday to Friday when there is no calendar." },
        holidays: { ...ITEMS, description: "{date: YYYY-MM-DD, allDayFlag?, timeStart?, timeEnd?}: an all-day holiday closes the day, a timed one is busy." },
        busy: { ...ITEMS, description: "{start, end} intervals also taken (claims, slots planned in this run)." },
        lunch: { type: "array", items: { type: "string" }, description: "[HH:MM, HH:MM]; a slot never straddles it." },
        after: { type: "array", items: { type: "string" }, description: "Earliest instants; the latest of these and now wins." },
        until: { type: "string", description: "No slot ends after this instant." },
        days: { type: "integer", minimum: 1, maximum: 60, description: "Working days to search. Default 5." },
        minutes: { type: "integer", minimum: 1, maximum: 1440, description: "Slot length." },
        min_minutes: { type: "integer", minimum: 0, maximum: 1440 },
        grid: { type: "integer", minimum: 1, maximum: 60, description: "Starts sit on this many minutes from the hour. Default 15." },
        limit: { type: "integer", minimum: 1, maximum: 100, description: "Default 5." },
      },
    },
  },
  {
    name: "flow_time_block",
    description: "A local time block (day, start, end) as UTC rows, daylight saving aware. An end at or before the start crosses midnight: two rows, the first ending at midnight_split_end, the second from 00:00 the next day. With existing, each row says which entries it overlaps.",
    inputSchema: {
      type: "object", additionalProperties: false, required: ["day", "start", "end"],
      properties: {
        time_zone: ZONE,
        day: { type: "string", description: "Local day of the start, YYYY-MM-DD." },
        start: { type: "string", description: "Local HH:MM." },
        end: { type: "string", description: "Local HH:MM; at or before start: the block crosses midnight." },
        midnight_split_end: { type: "string", description: "Required when the block crosses midnight: the local HH:MM the first row ends at, from the organization's own settings (23:59 or 24:00)." },
        existing: { ...ITEMS, description: "Entries already logged, to find overlaps." },
        start_field: { type: "string", description: "Of existing. Default timeStart." },
        end_field: { type: "string", description: "Of existing. Default timeEnd." },
      },
    },
  },
  {
    name: "flow_overlaps",
    description: "Which items have a [start, end) span overlapping [start, end); date-only or unreadable items never overlap. Returns the count and the items' ids.",
    inputSchema: {
      type: "object", additionalProperties: false, required: ["items", "start", "end"],
      properties: {
        items: ITEMS,
        start: { type: "string", description: "ISO 8601 date-time." },
        end: { type: "string", description: "ISO 8601 date-time." },
        start_field: { type: "string", description: "Default dateStart." },
        end_field: { type: "string", description: "Default dateEnd." },
      },
    },
  },
  {
    name: "flow_stats",
    description: "Exact count, sum, min, max, mean and median of numbers (decimal arithmetic, never mental math): pass values, or items with a field path. Non-numbers are skipped and counted.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        values: { type: "array", items: { type: "number" } },
        items: ITEMS,
        field: { type: "string", description: "Dotted path of the number in each item, for example actualHours." },
      },
    },
  },
  {
    name: "flow_age_buckets",
    description: "Items counted by age in local days since a date field, in buckets (default 0-7, 8-30, 31-90, 91+), with each bucket's share in percent.",
    inputSchema: {
      type: "object", additionalProperties: false, required: ["items", "field"],
      properties: {
        items: ITEMS,
        field: { type: "string", description: "Dotted path of the date, for example _info.dateEntered." },
        bounds: { type: "array", items: { type: "integer", minimum: 0 }, description: "Increasing upper bounds in days. Default [7, 30, 90]." },
        time_zone: ZONE, now: NOW,
      },
    },
  },
  {
    name: "flow_group_units",
    description: "Groups units of work (tickets) that share every value of one key set; with several sets, a unit joins when any set matches and links chain. Key `similar` = same sender address, same normalized subject (reply and forward prefixes, brackets and accents ignored) and same device names or serials; a unit without a sender stays alone, and so does one with several resources under a set holding resources. group_max cuts a larger group into stable lots. Group ids never spell out an address.",
    inputSchema: {
      type: "object", additionalProperties: false, required: ["units", "group_by"],
      properties: {
        units: { ...ITEMS, description: "Each with id; for similar: summary, contactEmailAddress (or initialDescription with a From: line)." },
        group_by: { type: "array", items: { anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] }, description: "[\"company.id\", \"resources\"] (one set) or [[\"resources\"], [\"similar\"]] (alternatives)." },
        group_max: { type: "integer", minimum: 2 },
      },
    },
  },
  {
    name: "flow_filter",
    description: "Keeps the items for which every where condition holds and no unless condition holds, then sets apart those an exclusion list names by id or by title motif (case-insensitive; * ? [ ] globs, else a substring).",
    inputSchema: {
      type: "object", additionalProperties: false, required: ["items"],
      properties: {
        items: ITEMS, where: CONDITIONS,
        unless: { ...CONDITIONS, description: "Any of these drops the item." },
        exclude: {
          type: "object", additionalProperties: false,
          properties: {
            ids: { type: "array", items: { anyOf: [{ type: "string" }, { type: "number" }, { type: "object" }] }, description: "Ids (or {id}) to set apart." },
            titles: { type: "array", items: { anyOf: [{ type: "string" }, { type: "object" }] }, description: "Title motifs (or {title}) to set apart." },
            id_field: { type: "string", description: "Default id." },
            title_field: { type: "string", description: "Default name." },
          },
        },
        now: NOW,
      },
    },
  },
  {
    name: "flow_member_load",
    description: "Booked hours per person and local day from schedule entries (timed, not done, not marked blocking: false), cut at local midnight. With day: a person's hours on that day and the next business days, and members ranked least loaded first.",
    inputSchema: {
      type: "object", additionalProperties: false, required: ["entries"],
      properties: {
        entries: { ...ITEMS, description: "{member (identifier or {identifier}), dateStart, dateEnd, doneFlag?, blocking?}." },
        member_field: { type: "string", description: "Default member." },
        time_zone: ZONE,
        day: { type: "string", description: "YYYY-MM-DD." },
        business_days: { type: "integer", minimum: 0, maximum: 20, description: "Business days after day. Default 2." },
        member: { type: "string" },
        members: { type: "array", items: { type: "string" }, description: "People to rank by load over the window." },
      },
    },
  },
].map((tool) => ({ ...tool, annotations: READ_ONLY }));

export const FLOW_TOOL_NAMES: ReadonlySet<string> = new Set(FLOW_TOOLS.map((tool) => tool.name));

/** One tools/call: the JSON answer, or a guiding error. */
export function callFlowTool(name: unknown, rawArgs: unknown, clock: number = Date.now()): { content: Array<{ type: "text"; text: string }>; isError?: true } {
  const args = isRecord(rawArgs) ? rawArgs : {};
  const answer = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });
  try {
    switch (name) {
      case "flow_free_slots": return answer(freeSlots(args, clock));
      case "flow_time_block": return answer(timeBlock(args));
      case "flow_overlaps": return answer(overlaps(args));
      case "flow_stats": return answer(stats(args));
      case "flow_age_buckets": return answer(ageBuckets(args, clock));
      case "flow_group_units": return answer(groupUnits(args));
      case "flow_filter": return answer(filterItems(args, clock));
      case "flow_member_load": return answer(memberLoad(args));
      default: return { content: [{ type: "text", text: `unknown tool ${String(name)}` }], isError: true };
    }
  } catch (error) {
    if (error instanceof FlowInputError) return { content: [{ type: "text", text: error.message }], isError: true };
    throw error;
  }
}
