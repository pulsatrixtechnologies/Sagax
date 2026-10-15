import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "@/lib/i18n";
import { readStep, stepArgs, stepDuration, stepGroupLabel, stepJson, stepLabel, stepPhase, stepResult } from "./step-label";

afterEach(() => {
  setLocale("en");
});

const names = (id: string) => ({ b1: "Wren", b2: "Olive" } as Record<string, string>)[id];

describe("step labels in plain words", () => {
  it("never shows the raw id of a known tool", () => {
    const coordinated = stepLabel({ name: "agents_coordinate_bots", ok: true, input: JSON.stringify({ bot_ids: ["b1", "b2"], message: "go" }) }, names);
    expect(coordinated).toBe("Coordinated Wren and Olive");
    expect(coordinated).not.toContain("coordinate_bots");
    expect(stepLabel({ name: "mcp__agents__coordinate_bots", ok: undefined, input: JSON.stringify({ bot_ids: ["b1"] }) }, names)).toBe("Coordinating Wren");
    expect(stepLabel({ name: "Bash", ok: true })).toBe("Ran a command");
    expect(stepLabel({ name: "WebSearch", ok: true })).toBe("Searched the web");
    expect(stepLabel({ name: "Read", ok: true })).toBe("Read a file");
  });

  it("speaks in the tense of the state: running, done, failed", () => {
    expect(stepPhase({ ok: undefined })).toBe("running");
    expect(stepPhase({ ok: true })).toBe("done");
    expect(stepPhase({ ok: false })).toBe("failed");
    expect(stepLabel({ name: "Read" })).toBe("Reading a file");
    expect(stepLabel({ name: "Read", ok: false })).toBe("Could not read a file");
  });

  it("reads ConnectWise, SentinelOne and other product tools through their product", () => {
    expect(stepLabel({ name: "mcp__claude_ai_Pulsatrix_Perspicax__cw_psa__find_tickets", ok: true })).toBe("Viewed tickets in ConnectWise PSA");
    expect(stepLabel({ name: "mcp__claude_ai_Pulsatrix_Perspicax__sentinelone__query", ok: true, input: JSON.stringify({ resource: "threats" }) })).toBe("Viewed alerts in SentinelOne");
    expect(readStep({ name: "mcp__pulsatrix__cw_psa__get_ticket", ok: true, input: JSON.stringify({ ticketId: 297048 }) }).target).toBe("#297048");
  });

  it("falls back to 'Used <tool>' for an unknown tool", () => {
    expect(stepLabel({ name: "frobnicate_widgets", ok: true })).toBe("Used frobnicate widgets");
    expect(stepLabel({ name: "frobnicate", ok: false })).toBe("Could not use frobnicate");
  });

  it("keeps what the step acted on as a quiet target, never JSON", () => {
    expect(readStep({ name: "Read", ok: true, input: JSON.stringify({ file_path: "/repo/src/ChatView.tsx" }) }).target).toBe("ChatView.tsx");
    expect(readStep({ name: "Bash", ok: true, input: JSON.stringify({ command: "pnpm test\n--run" }) }).target).toBe("pnpm test");
    expect(readStep({ name: "WebFetch", ok: true, input: JSON.stringify({ url: "https://example.com/a/b" }) }).target).toBe("example.com");
    expect(readStep({ name: "weird_tool", ok: true, summary: "{\"a\":1}" }).target).toBeUndefined();
  });

  it("reads the server's coordination sentences again in the person's language", () => {
    expect(stepLabel({ name: "Resumed with Wren, Olive results, reviewing", ok: true })).toBe("Got results from Wren and Olive, reviewing");
    setLocale("fr");
    expect(stepLabel({ name: "Resumed with Wren, Olive results, reviewing", ok: true })).toBe("A reçu les résultats de Wren et Olive, révision en cours");
    expect(stepLabel({ name: "Sent to Wren · Standup", ok: true })).toBe("Envoyé à Wren dans Standup");
    expect(stepLabel({ name: "agents_coordinate_bots", ok: true, input: JSON.stringify({ bot_ids: ["b1", "b2"] }) }, names)).toBe("A coordonné Wren et Olive");
    expect(stepLabel({ name: "mcp__x__cw_psa__find_tickets", ok: true })).toBe("A consulté les billets dans ConnectWise PSA");
    expect(stepLabel({ name: "WebSearch", ok: true })).toBe("A cherché sur le web");
    expect(stepLabel({ name: "frobnicate", ok: true })).toBe("A utilisé frobnicate");
  });

  it("does not show opaque teammate ids as names", () => {
    expect(stepLabel({ name: "coordinate_bots", ok: true, input: JSON.stringify({ bot_ids: ["0f9a8b7c-6d5e-4f3a-2b1c-0d9e8f7a6b5c"] }) })).toBe("Coordinated teammates");
  });
});

describe("step detail helpers", () => {
  it("formats a quiet duration", () => {
    expect(stepDuration(undefined)).toBeUndefined();
    expect(stepDuration(400)).toBe("<1s");
    expect(stepDuration(2_200)).toBe("2s");
    expect(stepDuration(65_000)).toBe("1m 05s");
  });

  it("summarizes arguments as readable pairs, not raw JSON", () => {
    const pairs = stepArgs(JSON.stringify({ query: "open tickets", ids: [1, 2], conditions: { a: 1, b: 2 }, empty: "" }));
    expect(pairs).toEqual([
      { key: "query", value: "open tickets" },
      { key: "ids", value: "1, 2" },
      { key: "conditions", value: "2 fields" },
    ]);
    expect(stepArgs("not json")).toEqual([]);
  });

  it("cuts a long result and says so", () => {
    expect(stepResult(undefined)).toBeUndefined();
    const result = stepResult(Array.from({ length: 10 }, (_, i) => `line ${i}`).join("\n"));
    expect(result?.text.split("\n")).toHaveLength(4);
    expect(result?.cut).toBe(true);
  });

  it("keeps the full technical record in the JSON", () => {
    const json = JSON.parse(stepJson({ name: "mcp__agents__coordinate_bots", ok: true, input: "{\"bot_ids\":[\"b1\"]}", output: "{\"ok\":true}" }));
    expect(json).toEqual({ tool: "mcp__agents__coordinate_bots", ok: true, input: { bot_ids: ["b1"] }, output: { ok: true } });
  });

  it("names a group by its count", () => {
    expect(stepGroupLabel(1)).toBe("Used 1 tool");
    expect(stepGroupLabel(4)).toBe("Used 4 tools");
  });
});
