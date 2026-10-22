import { describe, expect, it } from "vitest";

import { connectorSwitchText, pickConnectorSwitch, type SwitchEngine } from "./connector-switch.ts";

const grok: SwitchEngine = { instanceId: "grok", engineLabel: "Grok", models: ["grok-4.7"], defaultModel: "grok-4.7", reach: [] };
const claude = (connectors: string[]): SwitchEngine => ({
  instanceId: "claude", engineLabel: "Claude", models: ["sonnet", "opus"], defaultModel: "opus",
  reach: connectors.map((name) => ({ connector: name })),
});

describe("switching a request to the engine that has its connector (JC 2026-10-21)", () => {
  it("switches when the bot's engine lacks it and another engine of this person has it", () => {
    expect(pickConnectorSwitch({ need: { capability: "mail", hint: "Gmail" }, current: grok, candidates: [claude(["Gmail"])] }))
      .toEqual({ instanceId: "claude", model: "opus", engineLabel: "Claude", connector: "Gmail" });
  });

  it("stays when the bot's engine already reaches it", () => {
    const current = { ...grok, reach: [{ connector: "Outlook (Exchange)" }] };
    expect(pickConnectorSwitch({ need: { capability: "mail" }, current, candidates: [claude(["Gmail"])] })).toBeNull();
    expect(pickConnectorSwitch({ need: { capability: "mail", hint: "Outlook" }, current, candidates: [claude(["Microsoft 365"])] })).toBeNull();
  });

  it("follows the service the person named", () => {
    const current = { ...grok, reach: [{ connector: "Outlook (Exchange)" }] };
    expect(pickConnectorSwitch({ need: { capability: "mail", hint: "Gmail" }, current, candidates: [claude(["Gmail"])] })?.connector).toBe("Gmail");
    // Microsoft 365 answers Outlook, Teams, SharePoint and OneDrive
    expect(pickConnectorSwitch({ need: { capability: "teams", hint: "Teams" }, current: grok, candidates: [claude(["Microsoft 365"])] })?.connector).toBe("Microsoft 365");
    expect(pickConnectorSwitch({ need: { capability: "mail", hint: "Gmail" }, current: grok, candidates: [claude(["Microsoft 365"])] })).toBeNull();
  });

  it("no switch when no engine of this person has it, when nothing is needed, or with no usable model", () => {
    expect(pickConnectorSwitch({ need: { capability: "teams" }, current: grok, candidates: [claude(["Gmail"])] })).toBeNull();
    expect(pickConnectorSwitch({ need: null, current: grok, candidates: [claude(["Gmail"])] })).toBeNull();
    expect(pickConnectorSwitch({ need: { capability: "mail" }, current: grok, candidates: [{ ...claude(["Gmail"]), models: [], defaultModel: undefined }] })).toBeNull();
  });

  it("keeps the engine's default model when it lists it, else its first", () => {
    expect(pickConnectorSwitch({ need: { capability: "mail" }, current: grok, candidates: [{ ...claude(["Gmail"]), defaultModel: "gone" }] })?.model).toBe("sonnet");
  });

  it("one line, in plain words", () => {
    expect(connectorSwitchText({ engine: "Claude", connector: "Gmail" })).toBe("Switched to Claude for Gmail.");
  });
});
