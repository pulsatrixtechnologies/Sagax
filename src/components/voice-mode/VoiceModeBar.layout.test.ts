// The voice call bar is a slim in-call banner docked at the top of the chat
// column (ChatView's banner stack), never a float over the thread: these
// tests pin its layout for every call state, narrow and wide.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  vi.stubGlobal("window", { setInterval: () => 0, clearInterval: () => {} });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
});

vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: original.initialState, dispatch: () => {} }) };
});

import type { Bot } from "@/state/store";
import type { VoiceCall } from "@/lib/voice-mode/call";
import type { CallPhase, CallState } from "@/lib/voice-mode/call-machine";
import { readFileSync } from "node:fs";
import { VoiceModeBar, type VoiceModeBarProps } from "./VoiceModeBar";

const bot = {
  id: "cryptic", threadId: "cryptic-main", name: "Cryptic", title: "", description: "", notifications: true,
  color: "green", unread: false, messages: [], modelSelection: { instanceId: "fake", model: "test" },
} as unknown as Bot;
const call = { analysers: { mic: null, bot: null }, enrolled: false, endpointMs: 850, modelsReady: true } as unknown as VoiceCall;

function render(phase: CallPhase, extra: Partial<VoiceModeBarProps> = {}, muted = false): string {
  const state: CallState = { phase, muted, botBusy: false, botAudible: phase === "speaking", ducked: false };
  return renderToStaticMarkup(createElement(VoiceModeBar, {
    bot, call, state, heard: "", note: null, refusal: null, transcript: [], onRetry: () => {}, onEnd: () => {}, ...extra,
  }));
}

/** The class list of the first element carrying `attribute`. */
function classOf(html: string, attribute: string): string {
  const match = new RegExp(`<[^>]*\\b${attribute}\\b[^>]*>`).exec(html);
  expect(match, attribute).not.toBeNull();
  return /class="([^"]*)"/.exec(match![0])?.[1] ?? "";
}

describe("the voice call bar's layout", () => {
  it("is part of the layout, not a float over the thread", () => {
    const bar = classOf(render("listening"), "data-voice-bar");
    expect(bar).not.toMatch(/\b(absolute|fixed|sticky)\b/);
    expect(bar).not.toMatch(/\b(bottom|top|inset)-/);
    expect(bar).not.toMatch(/pointer-events-none/);
    // a container, so its own width (not the window's) folds it
    expect(bar).toContain("@container/callbar");
  });

  it("shows avatar, name, timer, state and every control in one row for each call state", () => {
    const states: Array<[CallPhase, string]> = [
      ["connecting", "Connecting"], ["listening", "Listening"], ["hearing", "Listening to you"], ["thinking", "Thinking"],
      ["speaking", "Speaking"], ["interrupted", "Interrupted"], ["held", "On hold"],
    ];
    for (const [phase, label] of states) {
      const html = render(phase);
      expect(html).toContain(`data-voice-phase="${phase}"`);
      expect(html).toMatch(/data-voice-timer[^>]*>0:00</);
      expect(html).toMatch(new RegExp(`data-voice-status[^>]*>${label}<`));
      expect(html).toContain(">Cryptic<");
      for (const control of ["data-voice-gear", "data-voice-hold", "data-voice-mute", "data-voice-end"]) expect(html, `${phase} ${control}`).toContain(control);
    }
    expect(render("speaking", {}, true)).toMatch(/data-voice-status[^>]*>Muted</);
  });

  it("narrow: the waveform folds away, the name and state truncate, the controls never shrink", () => {
    const html = render("speaking");
    const wave = classOf(html, "data-voice-waveform");
    expect(wave).toMatch(/(^| )hidden( |$)/);
    expect(wave).toContain("@[34rem]/callbar:flex");
    expect(classOf(html, "data-voice-callbar-info")).toMatch(/min-w-\[7rem\].*flex-1|flex-1.*min-w-\[7rem\]/);
    const controls = classOf(html, "data-voice-controls");
    expect(controls).toContain("shrink-0");
    expect(controls).toContain("ml-auto");
    // the row wraps the controls under the name rather than clip them
    expect(classOf(html, "data-voice-callbar-row")).toContain("flex-wrap");
  });

  it("wide: the waveform shows between the state and the controls", () => {
    const html = render("listening");
    const order = ["data-voice-callbar-info", "data-voice-waveform", "data-voice-controls"].map((a) => html.indexOf(a));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html).toContain("<canvas");
  });

  it("opens notices and panels below the controls row, scrollable, never over the thread", () => {
    expect(render("listening")).not.toContain("data-voice-callbar-panels");
    const html = render("listening", { note: "The microphone is busy" });
    expect(html.indexOf("data-voice-controls")).toBeLessThan(html.indexOf("data-voice-callbar-panels"));
    expect(classOf(html, "data-voice-callbar-panels")).toMatch(/max-h-\[45vh\].*overflow-y-auto/);
  });
});

describe("where the bar lives", () => {
  it("ChatView docks it first in the banner stack, under the header; the overlay is the older call only", () => {
    const chat = readFileSync(new URL("../ChatView.tsx", import.meta.url), "utf8");
    expect(chat).toMatch(/<div className="chat-banners[^"]*">\s*\{\/\*[\s\S]*?\*\/\}\s*<VoiceCallDock bot=\{bot\} \/>/);
    const view = readFileSync(new URL("../CallView.tsx", import.meta.url), "utf8");
    const overlay = view.slice(view.indexOf("export function CallOverlay"), view.indexOf("export function VoiceCallDock"));
    expect(overlay).not.toContain("<LiveCall");
    expect(overlay).toContain("voiceMode?.available === true) return null");
  });
});
