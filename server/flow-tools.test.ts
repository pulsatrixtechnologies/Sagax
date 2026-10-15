// Pulsatrix Flow's compute as native tools (server/flow-tools.ts). The
// expected values of the free slots, the `similar` keys, the median, the
// local-time conversions, the group ids and the load were produced by the
// plugin's own Python (px_flow.py, px_flow_action.py) on the same inputs.
import { describe, expect, it } from "vitest";
import {
  FLOW_MAX_DAY_CUTS, FLOW_MAX_SPAN_DAYS, FLOW_REGEX_MAX_PATTERN, FLOW_REGEX_MAX_TEXT, FLOW_TOOLS, FLOW_TOOL_NAMES, FLOW_TOOLS_MCP_NAME, callFlowTool,
  checkCondition, evalCondition, groupUnits, similarKey,
} from "./flow-tools.ts";
import { flowToolsRequest } from "./user-sandbox-proxy.ts";
import { grokReadOnlyAllowRules, isFlowToolsServer } from "./drivers/acp/grok-read-only-tools.ts";
import { gateReadOnlyTools } from "./drivers/acp/grok-approval-gate.ts";
import { SPAWNED_PROXIES } from "./proxy-paths.ts";

const NOW = Date.parse("2026-10-14T13:07:30Z");
const ZONE = "America/Toronto";

function call(name: string, args: Record<string, unknown>) {
  const result = callFlowTool(name, args, NOW);
  return { ...result, json: result.isError ? null : JSON.parse(result.content[0]!.text) };
}

describe("flow_free_slots", () => {
  const args = {
    time_zone: ZONE,
    items: [
      { id: 1, dateStart: "2026-10-14T14:00:00Z", dateEnd: "2026-10-14T15:30:00Z", doneFlag: false },
      { id: 2, dateStart: "2026-10-15T00:00:00Z", dateEnd: "2026-10-16T00:00:00Z", type: "V" },
      { id: 3, dateStart: "2026-10-16T13:00:00Z", dateEnd: "2026-10-16T20:00:00Z", doneFlag: true },
    ],
    occupies: ["doneFlag is false"],
    whole_day_when: ["type = V"],
    holidays: [{ date: "2026-10-19", allDayFlag: true }],
    busy: [{ start: "2026-10-14T17:00:00Z", end: "2026-10-14T17:45:00Z" }],
    default_window: ["08:00", "17:00"],
    lunch: ["12:00", "13:00"],
    minutes: 60, grid: 15, days: 4, limit: 8,
  };

  it("matches the plugin: occupied spans, whole-day leave, lunch, a holiday and the weekend", () => {
    expect(call("flow_free_slots", args).json.slots).toEqual([
      { day: "2026-10-14", start: "2026-10-14T17:45:00Z", end: "2026-10-14T18:45:00Z", start_local: "13:45", end_local: "14:45", minutes: 60, hole_end_local: "17:00" },
      { day: "2026-10-16", start: "2026-10-16T12:00:00Z", end: "2026-10-16T13:00:00Z", start_local: "08:00", end_local: "09:00", minutes: 60, hole_end_local: "12:00" },
      { day: "2026-10-16", start: "2026-10-16T17:00:00Z", end: "2026-10-16T18:00:00Z", start_local: "13:00", end_local: "14:00", minutes: 60, hole_end_local: "17:00" },
      { day: "2026-10-20", start: "2026-10-20T12:00:00Z", end: "2026-10-20T13:00:00Z", start_local: "08:00", end_local: "09:00", minutes: 60, hole_end_local: "12:00" },
      { day: "2026-10-20", start: "2026-10-20T17:00:00Z", end: "2026-10-20T18:00:00Z", start_local: "13:00", end_local: "14:00", minutes: 60, hole_end_local: "17:00" },
    ]);
  });

  it("uses the calendar's own hours, stops at until and gives nothing without a window", () => {
    const calendar = { wednesdayStartTime: "07:00", wednesdayEndTime: "11:00" };
    const slots = call("flow_free_slots", { time_zone: ZONE, calendar, minutes: 30, days: 1, now: "2026-10-14T10:00:00Z" }).json.slots;
    expect(slots).toEqual([{ day: "2026-10-14", start: "2026-10-14T11:00:00Z", end: "2026-10-14T11:30:00Z", start_local: "07:00", end_local: "07:30", minutes: 30, hole_end_local: "11:00" }]);
    expect(call("flow_free_slots", { time_zone: ZONE, calendar, minutes: 30, now: "2026-10-14T10:00:00Z", until: "2026-10-14T11:15:00Z" }).json.slots).toEqual([]);
    expect(call("flow_free_slots", { time_zone: ZONE, minutes: 30 }).json.slots).toEqual([]);
  });

  it("refuses a bad time zone or condition with a guiding error", () => {
    expect(call("flow_free_slots", { ...args, time_zone: "Mars/Olympus" }).content[0]!.text).toMatch(/Unknown time zone/);
    expect(call("flow_free_slots", { ...args, occupies: ["doneFlag maybe"] })).toMatchObject({ isError: true });
    expect(call("flow_free_slots", { time_zone: ZONE })).toMatchObject({ isError: true });
  });
});

describe("flow_time_block", () => {
  it("converts local hours to UTC across a daylight saving change", () => {
    const block = call("flow_time_block", { time_zone: ZONE, day: "2026-11-01", start: "08:00", end: "09:30" }).json;
    expect(block).toMatchObject({ crosses_midnight: false, hours: 1.5 });
    // 2026-11-01: Toronto is back on standard time (UTC-5)
    expect(block.rows).toEqual([{ day: "2026-11-01", start: "2026-11-01T13:00:00Z", end: "2026-11-01T14:30:00Z", start_local: "08:00", end_local: "09:30", hours: 1.5 }]);
  });

  it("splits a block that crosses midnight at the organization's own end time", () => {
    const block = call("flow_time_block", { time_zone: ZONE, day: "2026-11-01", start: "22:00", end: "01:00", midnight_split_end: "23:59" }).json;
    expect(block.crosses_midnight).toBe(true);
    expect(block.rows.map((r: { start: string; end: string }) => [r.start, r.end])).toEqual([
      ["2026-11-02T03:00:00Z", "2026-11-02T04:59:00Z"],
      ["2026-11-02T05:00:00Z", "2026-11-02T06:00:00Z"],
    ]);
    expect(block.hours).toBe(2.98);
  });

  it("asks for the split end time instead of assuming one", () => {
    const answer = call("flow_time_block", { time_zone: ZONE, day: "2026-11-01", start: "22:00", end: "01:00" });
    expect(answer.isError).toBe(true);
    expect(answer.content[0]!.text).toMatch(/midnight_split_end/);
  });

  it("reports the existing entries each row overlaps", () => {
    const existing = [
      { id: 7, timeStart: "2026-10-14T13:30:00Z", timeEnd: "2026-10-14T14:30:00Z" },
      { id: 8, timeStart: "2026-10-14T15:00:00Z", timeEnd: "2026-10-14T16:00:00Z" },
    ];
    const block = call("flow_time_block", { time_zone: ZONE, day: "2026-10-14", start: "09:00", end: "11:00", existing }).json;
    expect(block.rows[0].overlaps).toEqual({ count: 1, ids: [7] });
  });
});

describe("flow_overlaps", () => {
  it("counts half-open overlaps and never a date-only entry", () => {
    const items = [
      { id: 1, dateStart: "2026-10-14T13:00:00Z", dateEnd: "2026-10-14T14:00:00Z" },
      { id: 2, dateStart: "2026-10-14T14:00:00Z", dateEnd: "2026-10-14T15:00:00Z" },
      { id: 3, dateStart: "2026-10-14T00:00:00Z", dateEnd: "2026-10-15T00:00:00Z" },
    ];
    expect(call("flow_overlaps", { items, start: "2026-10-14T13:30:00Z", end: "2026-10-14T14:00:00Z" }).json).toEqual({ count: 1, ids: [1] });
  });
});

describe("flow_stats", () => {
  it("gives the exact median and sums without float drift", () => {
    expect(call("flow_stats", { values: [1.5, 2.25, 10, 0.1] }).json).toEqual({ count: 4, sum: 13.85, min: 0.1, max: 10, mean: 3.4625, median: 1.875, skipped: 0 });
    expect(call("flow_stats", { values: [0.1, 0.2] }).json.sum).toBe(0.3);
    expect(call("flow_stats", { items: [{ h: 1 }, { h: "x" }, { h: 3 }, {}], field: "h" }).json).toMatchObject({ count: 2, median: 2, skipped: 1 });
    expect(call("flow_stats", { values: [] }).json).toMatchObject({ count: 0, median: null });
  });

  it("rounds values with more than 12 decimals instead of failing", () => {
    expect(call("flow_stats", { values: [0.1 + 0.2, 1] }).json).toEqual({ count: 2, sum: 1.3, min: 0.3, max: 1, mean: 0.65, median: 0.65, skipped: 0 });
    expect(call("flow_stats", { values: [1 / 3] }).json).toMatchObject({ sum: 0.333333333333, median: 0.333333333333 });
    expect(call("flow_stats", { values: [-2 / 3, 0.5] }).json).toMatchObject({ min: -0.666666666667, max: 0.5 });
  });
});

describe("flow_age_buckets", () => {
  it("buckets by local days since the date, date-only values as written", () => {
    const items = [
      { d: "2026-10-14T03:00:00Z" }, // 23:00 the 13th in Toronto: 1 day
      { d: "2026-10-07T00:00:00Z" }, // date-only: 7 days
      { d: "2026-09-01" },
      { d: "2025-01-01" },
      { d: "not a date" },
    ];
    const answer = call("flow_age_buckets", { items, field: "d", time_zone: ZONE }).json;
    expect(answer.total).toBe(4);
    expect(answer.unreadable).toBe(1);
    expect(answer.buckets.map((b: { label: string; count: number; share: number }) => [b.label, b.count, b.share])).toEqual([
      ["0-7", 2, 50], ["8-30", 0, 0], ["31-90", 1, 25], ["91+", 1, 25],
    ]);
  });
});

describe("flow_group_units", () => {
  it("computes the plugin's similar keys", () => {
    expect(similarKey({ id: 10, summary: "RE: [Resolved] Backup failed on SRV01 nightly job", contactEmailAddress: "Alerts@Vendor.example" }))
      .toBe("backup failed on nightly job|alerts@vendor.example|SRV01");
    expect(similarKey({ id: 11, summary: "Backup failed on SRV01 nightly job", initialDescription: "From: alerts@vendor.example\nhello" }))
      .toBe("backup failed on nightly job|alerts@vendor.example|SRV01");
    expect(similarKey({ id: 12, summary: "[No Subject]", contactEmailAddress: "a@b.example", initialDescription: "From: a@b.example\nSubject: x\nDisk almost full on host. Serial Number: J101AHWW" }))
      .toBe("body:disk almost full on host serial number|a@b.example|J101AHWW");
    expect(similarKey({ id: 13, summary: "Écran brisé au bureau", contactEmailAddress: "x@y.example" })).toBe("ecran brise au bureau|x@y.example|");
    expect(similarKey({ id: 14, summary: "Backup failed" })).toBeNull();
  });

  it("chains alternative key sets and never spells an address in an id", () => {
    const units = [
      { id: 1, resources: "tech1", summary: "Printer jam", contactEmailAddress: "a@client.example" },
      { id: 2, resources: "tech1", summary: "Other thing", contactEmailAddress: "b@client.example" },
      { id: 3, resources: "", summary: "Printer jam", contactEmailAddress: "a@client.example" },
      { id: 4, resources: "tech1,tech2", summary: "Lonely", contactEmailAddress: "c@client.example" },
    ];
    const answer = groupUnits({ units, group_by: [["resources"], ["similar"]] });
    expect(answer.groups).toHaveLength(1);
    expect(answer.groups[0]!.id).toBe("group-0-tech1");
    expect((answer.groups[0]!.units as Array<{ id: number }>).map((u) => u.id)).toEqual([1, 2, 3]);
    expect(answer.alone).toEqual([units[3]]);
    const bySimilar = groupUnits({ units: units.slice(0, 3), group_by: ["similar"] });
    expect(bySimilar.groups[0]!.id).toMatch(/^group-similar-[0-9a-f]{10}$/);
    expect(JSON.stringify(bySimilar.groups.map((g) => g.id))).not.toContain("@");
  });

  it("cuts a large group into stable lots", () => {
    const units = [5, 3, 9, 1, 7].map((id) => ({ id, company: { id: 42 } }));
    const answer = groupUnits({ units, group_by: ["company.id"], group_max: 2 });
    expect(answer.groups.map((g) => [g.id, (g.units as Array<{ id: number }>).map((u) => u.id), g.lot])).toEqual([
      ["group-42-1-lot1", [1, 3], { n: 1, of: 3, group_size: 5 }],
      ["group-42-1-lot2", [5, 7], { n: 2, of: 3, group_size: 5 }],
    ]);
    // the last lot of one is a plain unit again
    expect(answer.alone).toEqual([{ id: 9, company: { id: 42 } }]);
  });

  it("refuses similar when no unit carries a sender field", () => {
    expect(call("flow_group_units", { units: [{ id: 1, summary: "a" }, { id: 2, summary: "a" }], group_by: ["similar"] }).isError).toBe(true);
  });
});

describe("flow_filter and conditions", () => {
  it("evaluates the routine condition language", () => {
    const item = { status: { name: "En attente" }, priority: "Haute", tags: ["a", "b"], n: "4", at: "2026-10-14T12:00:00Z", flag: false };
    expect(evalCondition("status = En attente && priority in Haute,Critique", item, NOW)).toBe(true);
    expect(evalCondition("tags in b", item, NOW)).toBe(true);
    expect(evalCondition("tags > 1 && n < 5", item, NOW)).toBe(true);
    expect(evalCondition("at newer than 2h && at > 2026-10-14T11:00:00Z", item, NOW)).toBe(true);
    expect(evalCondition("at older than 2h", item, NOW)).toBe(false);
    expect(evalCondition("flag is false && missing is empty && priority ~ ^hau", item, NOW)).toBe(true);
    expect(() => evalCondition("priority", item, NOW)).toThrow(/bad condition/);
  });

  it("caps the length of a regular expression and of the text it is tried on", () => {
    expect(() => evalCondition(`priority ~ ${"a".repeat(FLOW_REGEX_MAX_PATTERN + 1)}`, { priority: "a" }, NOW)).toThrow(/longer than/);
    expect(call("flow_filter", { items: [{ t: "x" }], where: [`t ~ ${"a".repeat(FLOW_REGEX_MAX_PATTERN + 1)}`] }).isError).toBe(true);
    const long = { t: `${"a".repeat(FLOW_REGEX_MAX_TEXT)}needle` };
    expect(evalCondition("t ~ needle", long, NOW)).toBe(false);
    expect(evalCondition("t ~ ^a+$", long, NOW)).toBe(true);
  });

  it("keeps, drops and sets apart by id or title motif", () => {
    const items = [
      { id: 1, name: "Weekly sync", done: false },
      { id: 2, name: "Client call", done: false },
      { id: 3, name: "PROTECTED review", done: false },
      { id: 4, name: "Anything", done: true },
    ];
    const answer = call("flow_filter", { items, where: ["done is false"], exclude: { ids: [{ id: 2 }], titles: ["protected*"] } }).json;
    expect(answer.kept).toEqual([items[0]]);
    expect(answer.dropped).toBe(1);
    expect(answer.excluded).toEqual([{ item: items[1], reason: "id" }, { item: items[2], reason: "title: protected*" }]);
  });
});

describe("flow_member_load", () => {
  it("cuts entries at local midnight and ranks the least loaded first", () => {
    const entries = [
      { member: { identifier: "tech1" }, dateStart: "2026-10-14T02:00:00Z", dateEnd: "2026-10-14T06:00:00Z" },
      { member: "tech2", dateStart: "2026-10-16T13:00:00Z", dateEnd: "2026-10-16T14:00:00Z" },
      { member: "tech2", dateStart: "2026-10-15T13:00:00Z", dateEnd: "2026-10-15T18:00:00Z", doneFlag: true },
    ];
    const answer = call("flow_member_load", { entries, time_zone: ZONE, day: "2026-10-13", member: "TECH1", members: ["tech2", "tech1"] }).json;
    expect(answer.load).toEqual({ tech1: { "2026-10-13": 2, "2026-10-14": 2 }, tech2: { "2026-10-16": 1 } });
    expect(answer.member).toEqual({ member: "TECH1", day: "2026-10-13", hours: 2, window: { "2026-10-13": 2, "2026-10-14": 2, "2026-10-15": 0 }, window_hours: 4 });
    expect(answer.ranking).toEqual([{ member: "tech2", window_hours: 0 }, { member: "tech1", window_hours: 4 }]);
  });
});

describe("the sagax-flow server", () => {
  it("declares schemas OpenAI-style APIs accept: every array has items, every type is one string", () => {
    const problems: string[] = [];
    const walk = (node: unknown, at: string): void => {
      if (Array.isArray(node)) { node.forEach((n, i) => walk(n, `${at}[${i}]`)); return; }
      if (!node || typeof node !== "object") return;
      const schema = node as Record<string, unknown>;
      if ("type" in schema && typeof schema.type !== "string") problems.push(`${at}: type ${JSON.stringify(schema.type)}`);
      if (schema.type === "array" && !schema.items) problems.push(`${at}: array without items`);
      for (const [key, value] of Object.entries(schema)) {
        if (key === "properties") for (const [name, prop] of Object.entries(value as object)) walk(prop, `${at}.${name}`);
        else if (key === "items" || key === "anyOf") walk(value, `${at}.${key}`);
      }
    };
    for (const tool of FLOW_TOOLS) walk(tool.inputSchema, tool.name);
    expect(problems).toEqual([]);
  });

  it("lists every tool as read only and answers calls in the proxy process", () => {
    const list = flowToolsRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" }) as { result: { tools: typeof FLOW_TOOLS } };
    expect(list.result.tools.map((t) => t.name)).toEqual([...FLOW_TOOL_NAMES]);
    expect(list.result.tools.every((t) => t.annotations.readOnlyHint && t.inputSchema.type === "object")).toBe(true);
    const init = flowToolsRequest({ jsonrpc: "2.0", id: 0, method: "initialize", params: {} }) as { result: { serverInfo: { name: string } } };
    expect(init.result.serverInfo.name).toBe(FLOW_TOOLS_MCP_NAME);
    const answer = flowToolsRequest({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "flow_stats", arguments: { values: [1, 2, 3] } } }) as { result: { content: Array<{ text: string }> } };
    expect(JSON.parse(answer.result.content[0]!.text).median).toBe(2);
    expect(flowToolsRequest({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeUndefined();
    const unknown = flowToolsRequest({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "flow_action", arguments: {} } }) as { result: { isError: boolean } };
    expect(unknown.result.isError).toBe(true);
  });

  it("is read only for Grok only when it is the harness's own proxy", () => {
    const spec = { command: process.execPath, args: [SPAWNED_PROXIES.userSandbox], env: { SAGAX_TOOL_SERVER: FLOW_TOOLS_MCP_NAME } };
    const impostor = { command: "node", args: ["/tmp/other.js"], env: { SAGAX_TOOL_SERVER: FLOW_TOOLS_MCP_NAME } };
    expect(isFlowToolsServer(spec)).toBe(true);
    expect(isFlowToolsServer(impostor)).toBe(false);
    expect(grokReadOnlyAllowRules({ custom: { [FLOW_TOOLS_MCP_NAME]: spec } })).toContain("MCPTool(sagax-flow__flow_free_slots)");
    expect(grokReadOnlyAllowRules({ custom: { [FLOW_TOOLS_MCP_NAME]: impostor } })).toEqual([]);
    expect(gateReadOnlyTools({ name: FLOW_TOOLS_MCP_NAME, builtin: false, spec })).toEqual([...FLOW_TOOL_NAMES]);
    expect(gateReadOnlyTools({ name: FLOW_TOOLS_MCP_NAME, builtin: false, spec: impostor })).toEqual([]);
  });
});

describe("flow patterns run in linear time", () => {
  const evil = { t: `${"a".repeat(FLOW_REGEX_MAX_TEXT - 1)}b`, name: `${"a".repeat(5_000)}c` };

  it("answers backtracking shapes at once and refuses back references", () => {
    const started = Date.now();
    // each of these takes seconds on 25 characters with the backtracking engine
    for (const pattern of ["(a+)+$", "((a+))+$", "^(a|a)*$", "^(a|ab)*c", ".*.*.*x", "\\d+\\d+\\d+$"]) {
      expect(evalCondition(`t ~ ${pattern}`, evil, NOW)).toBe(false);
    }
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(() => checkCondition("t ~ (x)\\1")).toThrow(/back references/);
    expect(() => checkCondition("t ~ ^(urgent|critical) .+")).not.toThrow();
  });

  it("stays case-insensitive and keeps escapes as written", () => {
    expect(evalCondition("t ~ ^URGENT\\b", { t: "Urgent: disk" }, NOW)).toBe(true);
    expect(evalCondition("t ~ \\D\\d", { t: "x9" }, NOW)).toBe(true);
    expect(evalCondition("t ~ ^\\S+$", { t: "a b" }, NOW)).toBe(false);
  });

  it("matches glob title motifs in linear time and names a malformed one", () => {
    const started = Date.now();
    const answer = call("flow_filter", { items: [evil], exclude: { titles: [`${"*a".repeat(40)}*b`] } }).json;
    expect(answer.kept).toEqual([evil]);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(call("flow_filter", { items: [{ name: "Zed" }], exclude: { titles: ["z?d", "[!x]ed"] } }).json.excluded).toHaveLength(1);
    const bad = call("flow_filter", { items: [{ name: "x" }], exclude: { titles: ["[z-a]*"] } });
    expect(bad.isError).toBe(true);
    expect(bad.content[0]!.text).toMatch(/bad title motif/);
  });
});

describe("flow date ranges stay bounded", () => {
  it("walks a whole-day item spanning centuries only inside the search window", () => {
    const started = Date.now();
    const items = Array.from({ length: 50 }, (_, id) => ({ id, dateStart: "1000-01-01T00:00:00Z", dateEnd: "9999-12-30T00:00:00Z", type: "V" }));
    const answer = call("flow_free_slots", { time_zone: ZONE, items, whole_day_when: ["type = V"], default_window: ["08:00", "17:00"], minutes: 30, days: 60 });
    expect(answer.json.slots).toEqual([]);
    expect(Date.now() - started).toBeLessThan(2_000);
    // a leave that ends inside the window still frees the days after it
    const leave = [{ id: 1, dateStart: "1000-01-01T00:00:00Z", dateEnd: "2026-10-16T00:00:00Z", type: "V" }];
    expect(call("flow_free_slots", { time_zone: ZONE, items: leave, whole_day_when: ["type = V"], default_window: ["08:00", "17:00"], minutes: 30, limit: 1 }).json.slots[0].day).toBe("2026-10-16");
  });

  it("refuses a member load entry longer than a year", () => {
    const answer = call("flow_member_load", { entries: [{ id: 9, member: "tech1", dateStart: "1000-01-01T00:00:00Z", dateEnd: "9999-12-30T00:00:00Z" }] });
    expect(answer.isError).toBe(true);
    expect(answer.content[0]!.text).toMatch(new RegExp(`"9" spans more than ${FLOW_MAX_SPAN_DAYS} days`));
    const year = call("flow_member_load", { entries: [{ member: "tech1", dateStart: "2026-01-01T05:00:00Z", dateEnd: "2027-01-01T05:00:00Z" }], time_zone: ZONE }).json;
    expect(Object.keys(year.load.tech1)).toHaveLength(365);
  });

  it("refuses more day cuts than one call may make, quickly", () => {
    const started = Date.now();
    const entries = Array.from({ length: 5_000 }, (_, id) => ({ id, member: `m${id % 50}`, dateStart: "2026-01-01T05:00:00Z", dateEnd: "2027-01-01T04:00:00Z" }));
    const answer = call("flow_member_load", { entries, time_zone: ZONE });
    expect(answer.content[0]!.text).toMatch(new RegExp(`more than ${FLOW_MAX_DAY_CUTS} person-days`));
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});

describe("flow optional and edge inputs", () => {
  it("takes existing: null and numbers printed with an exponent", () => {
    expect(call("flow_time_block", { time_zone: ZONE, day: "2026-10-14", start: "09:00", end: "10:00", existing: null }).json.rows[0].overlaps).toBeUndefined();
    expect(call("flow_stats", { values: [1e-7, 5e-7] }).json).toMatchObject({ count: 2, sum: 6e-7, median: 3e-7 });
    expect(call("flow_stats", { values: [1e21, 1] }).json).toMatchObject({ sum: 1e21 + 1, min: 1, max: 1e21 });
  });
});
