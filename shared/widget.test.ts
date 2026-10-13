import { describe, expect, it } from "vitest";

import { WIDGET_SAMPLES } from "./widget-samples.ts";
import {
  parseWidgetInput, resolveWidgetAction, widgetActionByLabel, widgetActions, widgetFields, widgetInitialValues, widgetScope, widgetToText,
  WIDGET_LIMITS, WIDGET_NODE_TYPES, type WidgetNode, type WidgetPayload, type WidgetRoot,
} from "./widget.ts";

function parsed(input: unknown): WidgetRoot {
  const result = parseWidgetInput(input);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

function refusal(input: unknown): string {
  const result = parseWidgetInput(input);
  if (result.ok) throw new Error("expected a refusal");
  return result.error;
}

function all(root: WidgetNode): WidgetNode[] {
  return [root, ...(root.children ?? []).flatMap(all)];
}

const sample = (name: string) => parsed(WIDGET_SAMPLES[name]);
const payload = (name: string): WidgetPayload => ({ v: 1, root: sample(name) });

describe("parseWidgetInput", () => {
  it("normalises every sample, and the samples use every node type", () => {
    const used = new Set<string>();
    for (const name of Object.keys(WIDGET_SAMPLES)) for (const node of all(sample(name))) used.add(node.type);
    expect([...WIDGET_NODE_TYPES].filter((type) => !used.has(type))).toEqual([]);
  });

  it("gives every node an id in document order", () => {
    const ids = all(sample("pullRequests")).map((node) => node.id);
    expect(ids).toEqual(ids.map((_, index) => `n${index + 1}`));
  });

  it("turns spacing units and size tokens into px", () => {
    const root = parsed({ type: "Card", padding: { x: 4, y: "10px" }, children: [{ type: "Row", gap: 2, children: [{ type: "Box", size: 40, radius: "full", width: "100%" }] }] });
    expect(root.padding).toEqual([10, 16, 10, 16]);
    const row = root.children![0];
    expect(row.gap).toBe(8);
    expect(row.children![0]).toMatchObject({ width: "full", height: 40, radius: 999 });
  });

  it("drops what it does not know and keeps only token colours", () => {
    const root = parsed({ type: "Card", theme: "dark", children: [{ type: "Text", value: "Hi", color: "#ff0000", size: "huge", key: "a" }, { type: "Box", background: "red-100" }, { type: "Title", value: "T", color: "emphasis" }] });
    expect(root.children![0]).toEqual({ type: "Text", id: "n2", value: "Hi" });
    expect(root.children![1]).toEqual({ type: "Box", id: "n3", children: [] });
    expect(root.children![2].color).toBe("primary");
    expect("theme" in root).toBe(false);
  });

  it("wraps a non-root, parses a JSON string, and wraps loose list and table children", () => {
    expect(parsed({ type: "Text", value: "Hello" })).toMatchObject({ type: "Card", children: [{ type: "Text", value: "Hello" }] });
    expect(parsed(JSON.stringify({ type: "Card", children: [] })).type).toBe("Card");
    expect(parsed({ type: "ListView", children: [{ type: "Text", value: "A" }] }).children![0]).toMatchObject({ type: "ListViewItem", children: [{ type: "Text" }] });
    expect(parsed({ type: "Table", children: [{ type: "TableRow", children: [{ type: "Text", value: "A" }] }] }).children![0].children![0].children![0].type).toBe("Table.Cell");
  });

  it("derives one button style and never keeps an unknown icon", () => {
    const root = parsed({ type: "Card", children: [
      { type: "Button", label: "A" }, { type: "Button", label: "B", color: "primary" }, { type: "Button", label: "C", variant: "ghost" },
      { type: "Button", label: "D", color: "danger" }, { type: "Button", label: "E", iconStart: "rocket" }, { type: "Icon", name: "rocket" }, { type: "Icon" },
    ] });
    expect(root.children!.slice(0, 4).map((node) => node.style)).toEqual(["secondary", "primary", "quiet", "danger"]);
    expect("iconStart" in root.children![4]).toBe(false);
    expect(root.children![5].name).toBe("dot");
    expect(root.children![6].name).toBe("dot");
  });

  it("refuses with the path of the problem", () => {
    expect(refusal(null)).toBe("widget: must be an object with a type.");
    expect(refusal("not json")).toBe("widget: must be a JSON object, not text.");
    expect(refusal({ type: "Card", children: [{ type: "Row", children: [{ type: "Carousel" }] }] })).toMatch(/^widget\.children\[0\]\.children\[0\]: unknown type "Carousel"; use one of Card, ListView, /);
    expect(refusal({ type: "Card", children: [{ type: "Text" }] })).toBe("widget.children[0].value: is required.");
    expect(refusal({ type: "Card", children: [{ type: "Select", name: "a", options: [] }] })).toBe(`widget.children[0].options: needs 1 to ${WIDGET_LIMITS.options} items.`);
    expect(refusal({ type: "Card", children: [{ type: "Card" }] })).toBe("widget.children[0]: Card is a root and cannot be nested.");
    expect(refusal({ type: "Card", children: [{ type: "Image", src: "http://example.com/a.png" }] })).toBe("widget.children[0].src: must be an https url.");
    expect(refusal({ type: "Card", confirm: { label: "Go", action: { type: "has space" } } })).toMatch(/^widget\.confirm\.action: must be \{type, payload\?\}/);
    expect(refusal({ type: "Card", children: [{ type: "Button", label: "Docs", onClickAction: { type: "open_url", payload: { url: "javascript:alert(1)" } } }] })).toBe("widget.children[0].onClickAction.payload.url: open_url needs an http or https url.");
  });

  it("refuses a password field and points at request_credential", () => {
    expect(refusal({ type: "Card", children: [{ type: "Input", name: "pw", inputType: "password" }] })).toBe("widget.children[0].inputType: password fields are not allowed in a widget; use request_credential for secrets.");
  });

  it("holds every limit", () => {
    const texts = (count: number) => Array.from({ length: count }, (_, index) => ({ type: "Text", value: String(index) }));
    expect(refusal({ type: "Card", children: texts(WIDGET_LIMITS.nodes) })).toMatch(/more than 250 nodes\.$/);
    expect(refusal({ type: "ListView", children: texts(WIDGET_LIMITS.listItems + 1) })).toBe("widget.children: a list takes at most 40 items.");
    expect(refusal({ type: "Card", children: [{ type: "Text", value: "x".repeat(WIDGET_LIMITS.text + 1) }] })).toBe("widget.children[0].value: must be at most 2000 characters.");
    expect(refusal({ type: "Card", children: [{ type: "Markdown", value: "x".repeat(WIDGET_LIMITS.bytes) }] })).toMatch(/keep it under 32000\.$/);
    let nested: unknown = { type: "Text", value: "deep" };
    for (let level = 0; level < WIDGET_LIMITS.depth; level += 1) nested = { type: "Col", children: [nested] };
    expect(refusal({ type: "Card", children: [nested] })).toMatch(/is nested deeper than 10 levels\.$/);
    expect(refusal({ type: "Card", children: Array.from({ length: WIDGET_LIMITS.images + 1 }, () => ({ type: "Image", src: "https://example.com/a.png" })) })).toMatch(/more than 6 images\.$/);
    expect(refusal({ type: "Card", children: [{ type: "Input", name: "a" }, { type: "Input", name: "a" }] })).toBe('widget.children[1].name: repeats the field name "a".');
    expect(refusal({ type: "Card", children: [{ type: "Button", label: "Go", onClickAction: { type: "go", payload: { blob: "x".repeat(WIDGET_LIMITS.actionPayloadBytes) } } }] })).toMatch(/payload: must be at most 2000 characters of JSON\.$/);
  });

  it("makes repeated button labels distinct by their row, and refuses what stays ambiguous", () => {
    const row = (name: string) => ({ type: "ListViewItem", children: [{ type: "Text", value: name }, { type: "Button", label: "View", onClickAction: { type: "view", payload: { name } } }] });
    const root = parsed({ type: "ListView", children: [row("James"), row("Rohan")] });
    expect(widgetActions(root).map((entry) => entry.label)).toEqual(["View: James", "View: Rohan"]);
    expect(refusal({ type: "Card", children: [{ type: "Button", label: "Go", onClickAction: { type: "a" } }, { type: "Button", label: "Go", onClickAction: { type: "b" } }] })).toBe('widget: two actions are both labelled "Go"; give each a distinct label.');
    expect(refusal({ type: "ListView", children: [{ type: "ListViewItem", onClickAction: { type: "open" }, children: [{ type: "Icon", name: "globe" }] }] })).toMatch(/has an action but no label/);
    expect(refusal({ type: "Card", children: [{ type: "Button", label: "Send", submit: true }] })).toMatch(/needs a Form with onSubmitAction around it\.$/);
  });
});

describe("widgetToText", () => {
  it("reads as a list", () => {
    expect(widgetToText(sample("pullRequests"))).toBe([
      "**Pull requests** · mausbot-mobile · 3 open",
      "- iOS: mid-turn steer · #750 · 4 files · passed 2h ago · Ready",
      "- Android: thread pin parity · #739 · 2 files · passed 5h ago · Ready",
      "- iOS: file links, send, attach · #719 · 9 files · 1 test failing · Failing",
      "[Merge the two ready] [Fix #719 first]",
    ].join("\n"));
  });

  it("reads as a form, a table, a chart and a status", () => {
    expect(widgetToText(sample("routineForm"))).toContain("Runs · (Every weekday / Every day / Mondays)");
    expect(widgetToText(sample("routineForm"))).toContain("[ ] Stop if any check is red");
    expect(widgetToText(sample("spendTable"))).toContain("Bot | Runs | Cost\nScout | 38 | $21.40");
    expect(widgetToText(sample("tokenChart"))).toContain("[chart: Opus, Sonnet]");
    expect(widgetToText(sample("buildStatus")).split("\n").slice(0, 3)).toEqual(["Uploading", "**Build 25 to TestFlight** · OpenMausMobile 1.4.0 (25)", "about 40s left 62%"]);
  });

  it("stays under its limit", () => {
    const long = parsed({ type: "Card", children: Array.from({ length: 40 }, () => ({ type: "Text", value: "word ".repeat(40) })) });
    expect(widgetToText(long).length).toBeLessThanOrEqual(WIDGET_LIMITS.fallback);
    expect(widgetToText(long).endsWith("…")).toBe(true);
  });
});

describe("widget actions", () => {
  it("lists what can be pressed, with what settles and what stays on the device", () => {
    expect(widgetActions(sample("pullRequests")).map(({ ref, label, tone, kind }) => ({ ref, label, tone, kind }))).toEqual([
      { ref: "n2", label: "iOS: mid-turn steer", tone: undefined, kind: "item" },
      { ref: "n8", label: "Android: thread pin parity", tone: undefined, kind: "item" },
      { ref: "n14", label: "iOS: file links, send, attach", tone: undefined, kind: "item" },
      { ref: "confirm", label: "Merge the two ready", tone: "confirm", kind: "confirm" },
      { ref: "cancel", label: "Fix #719 first", tone: "cancel", kind: "cancel" },
    ]);
    expect(widgetActions(sample("sources")).filter((entry) => entry.client).length).toBe(2);
    expect(widgetActionByLabel(sample("pullRequests"), "Merge the two ready")?.action).toEqual({ type: "pr.merge", payload: { prs: [750, 739] } });
    expect(widgetActionByLabel(sample("sources"), "ChatKit widgets guide")).toBeUndefined();
  });

  it("collects fields from the nearest form, or the whole widget", () => {
    const sink = sample("kitchenSink");
    const submit = widgetActions(sink).find((entry) => entry.tone === "submit")!;
    expect(widgetScope(sink, submit.ref).type).toBe("Form");
    expect(widgetFields(widgetScope(sink, submit.ref), sink).map((entry) => [entry.name, entry.label])).toEqual([["rating", "How did the run go?"], ["note", "Note"]]);
    const form = sample("routineForm");
    expect(widgetScope(form, "confirm")).toBe(form);
    expect(widgetInitialValues(form)).toEqual({ runs: "weekday", starts: "2026-10-14", at: "9:00 AM", report: "", stopOnRed: true });
  });

  it("turns a confirm into the message the person is recorded as sending", () => {
    const result = resolveWidgetAction(payload("routineForm"), "confirm", { runs: "daily", report: "discord:releases", stopOnRed: false });
    expect(result).toEqual({
      ok: true, ref: "confirm", label: "Create routine", tone: "confirm",
      action: { type: "routine.create", payload: { name: "release-check" } },
      values: { runs: "daily", starts: "2026-10-14", at: "9:00 AM", report: "discord:releases", stopOnRed: false },
      text: "Create routine\nRuns: Every day\nStarts: 2026-10-14\nAt: 9:00 AM\nReport to: Discord · #releases",
    });
  });

  it("checks every value against the widget", () => {
    const form = payload("routineForm");
    expect(resolveWidgetAction(form, "confirm", { at: "  " })).toEqual({ ok: false, status: 400, error: "At is required." });
    expect(resolveWidgetAction(form, "confirm", { runs: "hourly" })).toEqual({ ok: false, status: 400, error: "Runs must be one of the offered options." });
    expect(resolveWidgetAction(form, "confirm", { starts: "2026-10-01" })).toEqual({ ok: false, status: 400, error: "Starts is outside the dates offered." });
    expect(resolveWidgetAction(form, "confirm", { starts: "tomorrow" })).toEqual({ ok: false, status: 400, error: "Starts must be a date like 2026-10-14." });
    expect(resolveWidgetAction(form, "confirm", { stopOnRed: "yes" })).toEqual({ ok: false, status: 400, error: "Stop if any check is red must be on or off." });
    expect(resolveWidgetAction(form, "confirm", { nope: "x" })).toEqual({ ok: false, status: 400, error: 'There is no field named "nope" here.' });
    expect(resolveWidgetAction(form, "confirm", { at: "x".repeat(WIDGET_LIMITS.fieldValue + 1) })).toMatchObject({ ok: false, status: 400 });
    expect(resolveWidgetAction(form, "confirm", "nope")).toMatchObject({ ok: false, status: 400 });
  });

  it("lets cancel through with nothing, and a plain button through without the required check", () => {
    expect(resolveWidgetAction(payload("routineForm"), "cancel", { at: "" })).toMatchObject({ ok: true, tone: "cancel", values: {}, text: "Discard" });
    const sink = payload("kitchenSink");
    const later = widgetActions(sink.root).find((entry) => entry.label === "Ask me later")!;
    expect(resolveWidgetAction(sink, later.ref, {})).toMatchObject({ ok: true, text: "Ask me later", values: { rating: "", note: "" } });
    const submit = widgetActions(sink.root).find((entry) => entry.tone === "submit")!;
    expect(resolveWidgetAction(sink, submit.ref, {})).toEqual({ ok: false, status: 400, error: "How did the run go? is required." });
    expect(resolveWidgetAction(sink, submit.ref, { rating: "good", note: "Fast.\nNo retries." })).toMatchObject({ ok: true, tone: "submit", text: "Send feedback\nHow did the run go?: Good\nNote: Fast. No retries." });
  });

  it("refuses a settled widget, an unknown ref and a device-only action", () => {
    const settled: WidgetPayload = { ...payload("pullRequests"), settled: { ref: "confirm", label: "Merge the two ready", tone: "confirm", at: 1 } };
    expect(resolveWidgetAction(settled, "cancel", {})).toEqual({ ok: false, status: 409, error: "This was already answered." });
    expect(resolveWidgetAction(payload("pullRequests"), "n999", {})).toEqual({ ok: false, status: 404, error: "That button is no longer on this widget." });
    const sources = payload("sources");
    expect(resolveWidgetAction(sources, widgetActions(sources.root)[0].ref, {})).toMatchObject({ ok: false, status: 400 });
  });
});
