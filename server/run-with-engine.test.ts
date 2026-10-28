import { describe, expect, it } from "vitest";

import { chooseRelayEngine, relayEngineList, relayOpening, relayResultText, relayThreadLevel, type RelayEngine } from "./run-with-engine.ts";

const ENGINES: RelayEngine[] = [
  { instanceId: "claude", driverKind: "claudeAgent", displayName: "Claude", models: { default: "claude-opus", options: [{ id: "claude-opus" }, { id: "claude-sonnet" }] } },
  { instanceId: "grok-a1b2", driverKind: "grokAgent", displayName: "Grok", models: { default: "grok-4.7", options: [{ id: "grok-4.7" }, { id: "grok-4.5" }] } },
];

describe("chooseRelayEngine (run_with_engine, 2026-10-28)", () => {
  it("names an engine by its family, its name or its id, on its default model", () => {
    for (const engine of ["grok", "Grok", "grok-a1b2", "xAI"]) {
      expect(chooseRelayEngine({ engine, engines: ENGINES }), engine).toEqual({ ok: true, instanceId: "grok-a1b2", model: "grok-4.7", engineLabel: "Grok", driverKind: "grokAgent" });
    }
  });

  it("takes a model that engine lists, and refuses one it does not", () => {
    expect(chooseRelayEngine({ engine: "claude", model: "claude-sonnet", engines: ENGINES })).toMatchObject({ ok: true, model: "claude-sonnet" });
    const refused = chooseRelayEngine({ engine: "claude", model: "gpt-9", engines: ENGINES });
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.error).toContain("claude-opus");
  });

  it("the organization's engine list is the limit: an engine the payer may not use is refused with the ones they may", () => {
    const refused = chooseRelayEngine({ engine: "codex", engines: ENGINES });
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.error).toContain(relayEngineList(ENGINES));
    expect(chooseRelayEngine({ engine: "grok", engines: [] })).toMatchObject({ ok: false });
  });

  it("the same engine and model again is no relay: do it in this turn", () => {
    expect(chooseRelayEngine({ engine: "grok", engines: ENGINES, current: { instanceId: "grok-a1b2", model: "grok-4.7" } })).toMatchObject({ ok: false });
    // another model of the same engine is a relay
    expect(chooseRelayEngine({ engine: "grok", model: "grok-4.5", engines: ENGINES, current: { instanceId: "grok-a1b2", model: "grok-4.7" } })).toMatchObject({ ok: true, model: "grok-4.5" });
  });
});

describe("the part's rules (run_with_engine)", () => {
  it("keeps the bot's level on the other engine: Full stays Full, Ask stays Ask", () => {
    expect(relayThreadLevel({ botLevel: "full", fromDriver: "claudeAgent", toDriver: "grokAgent" })).toBeUndefined();
    expect(relayThreadLevel({ botLevel: "ask", fromDriver: "claudeAgent", toDriver: "grokAgent" })).toBeUndefined();
  });

  it("a Custom grant never crosses engines: the part asks", () => {
    expect(relayThreadLevel({ botLevel: "custom", fromDriver: "claudeAgent", toDriver: "grokAgent" })).toBe("ask");
  });

  it("the part's first line is the bot's own words, never the person's", () => {
    const text = relayOpening({ engineLabel: "Grok", sourceTitle: "Inbox", message: "List my unread Teams messages." });
    expect(text).toMatch(/your own words, not the person's/);
    expect(text).toContain("#Inbox");
    expect(text.endsWith("List my unread Teams messages.")).toBe(true);
  });

  it("a failed or unstarted part is never reported as done", () => {
    expect(relayResultText({ engineLabel: "Grok", model: "grok-4.7", status: "reply", text: "3 unread" })).toContain("3 unread");
    for (const status of ["failed", "error"] as const) {
      expect(relayResultText({ engineLabel: "Grok", model: "grok-4.7", status, text: "no access" })).toMatch(/do not claim the work was done/);
    }
  });
});
