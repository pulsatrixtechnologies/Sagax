import { describe, expect, it } from "vitest";

import {
  cancelToolFiller,
  createToolFillerState,
  isSpokenFiller,
  noteToolFillerPlayed,
  resetToolFiller,
  shouldPlayToolFiller,
  shouldSkipToolChip,
  toolFillerLanguage,
  toolFillerText,
} from "./tool-filler";

describe("tool filler copy", () => {
  it("speaks words in the call language, never a tone", () => {
    expect(toolFillerText("en")).toBe("Let me look.");
    expect(toolFillerText("fr")).toBe("Je regarde.");
    expect(toolFillerText("fr-CA")).toBe("Je regarde.");
    expect(toolFillerText("pt")).toBe("Deixa eu ver.");
    expect(toolFillerText("pt-BR")).toBe("Deixa eu ver.");
    expect(toolFillerText("auto")).toBe("Let me look.");
    expect(isSpokenFiller(toolFillerText("fr"))).toBe(true);
    expect(isSpokenFiller("")).toBe(false);
    expect(isSpokenFiller("\u0007")).toBe(false);
  });

  it("uses the voice language, then the UI locale, then English", () => {
    expect(toolFillerLanguage("fr", "en")).toBe("fr");
    expect(toolFillerLanguage("auto", "pt-br")).toBe("pt-br");
    expect(toolFillerLanguage(undefined, undefined)).toBe("en");
  });
});

describe("when to play", () => {
  it("plays on the first tool of a thinking turn, even when the model said nothing", () => {
    const idle = createToolFillerState();
    expect(shouldPlayToolFiller(idle, { thinking: true, toolStarted: true, toolKey: "bash-1" })).toBe(true);
    expect(shouldPlayToolFiller(idle, { thinking: true, toolStarted: false, toolKey: "bash-1" })).toBe(false);
    expect(shouldPlayToolFiller(idle, { thinking: false, toolStarted: true, toolKey: "bash-1" })).toBe(false);
    const played = noteToolFillerPlayed(idle, "bash-1");
    expect(shouldPlayToolFiller(played, { thinking: true, toolStarted: true, toolKey: "bash-1" })).toBe(false);
    expect(shouldSkipToolChip(played)).toBe(true);
    expect(shouldSkipToolChip(idle)).toBe(false);
  });

  it("plays again at the start of a later tool call on the same turn", () => {
    const first = noteToolFillerPlayed(createToolFillerState(), "bash-1");
    expect(shouldPlayToolFiller(first, { thinking: true, toolStarted: true, toolKey: "read-2" })).toBe(true);
    const second = noteToolFillerPlayed(first, "read-2");
    expect(shouldPlayToolFiller(second, { thinking: true, toolStarted: true, toolKey: "read-2" })).toBe(false);
    expect(shouldSkipToolChip(second)).toBe(true);
  });

  it("barge-in cancels the filler; a new turn can play again", () => {
    const cut = cancelToolFiller(noteToolFillerPlayed(createToolFillerState()));
    expect(shouldPlayToolFiller(cut, { thinking: true, toolStarted: true })).toBe(false);
    const next = resetToolFiller(cut);
    expect(shouldPlayToolFiller(next, { thinking: true, toolStarted: true })).toBe(true);
    expect(shouldSkipToolChip(next)).toBe(false);
  });

  it("does not play while the bot is already speaking", () => {
    const idle = createToolFillerState();
    expect(shouldPlayToolFiller(idle, { thinking: true, toolStarted: true, toolKey: "bash-1", speaking: true })).toBe(false);
    expect(shouldPlayToolFiller(idle, { thinking: true, toolStarted: true, toolKey: "bash-1", speaking: false })).toBe(true);
  });
});
