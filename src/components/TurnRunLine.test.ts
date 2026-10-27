// #1154: a reply that did not run on the bot's model says which pick it left.
import { afterEach, describe, expect, it } from "vitest";

import { setLocale } from "@/lib/i18n";
import { turnRunText } from "./TurnRunLine";

const instances = [
  { instanceId: "grok", displayName: "Grok Build", models: { options: [{ id: "grok-4.7", label: "Grok 4.7" }, { id: "grok-4.6", label: "Grok 4.6" }] } },
  { instanceId: "claude", displayName: "Claude Code", models: { options: [{ id: "claude-opus-5", label: "Claude Opus 5" }] } },
];

afterEach(() => setLocale("en"));

describe("turnRunText", () => {
  it("reads the model and effort alone when the turn ran on the pick", () => {
    expect(turnRunText({ instanceId: "grok", model: "grok-4.7", effort: "high" }, instances)).toBe("Grok 4.7 · effort High");
  });

  it("names the pick it left, with its engine when the turn ran on another one", () => {
    expect(turnRunText({ instanceId: "grok", model: "grok-4.6", requested: { instanceId: "grok", model: "grok-4.7" } }, instances))
      .toBe("Grok 4.6 · effort Default · instead of Grok 4.7");
    expect(turnRunText({ instanceId: "claude", model: "claude-opus-5", requested: { instanceId: "grok", model: "grok-4.7" } }, instances))
      .toBe("Claude Opus 5 · effort Default · instead of Grok Build · Grok 4.7");
    setLocale("fr");
    expect(turnRunText({ instanceId: "grok", model: "grok-4.6", requested: { instanceId: "grok", model: "grok-4.7" } }, instances))
      .toBe("Grok 4.6 · effort Par défaut · au lieu de Grok 4.7");
  });
});
