// The voice call pill: compact and centered at the top of the chat column
// (ChatView's banner stack, under the name chip); Settings or Transcript
// expand it into a card over the thread. These tests pin its states:
// collapsed, transcript, settings, and narrow.
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
  const match = new RegExp(`<[^>]*\\b${attribute}(?![\\w-])[^>]*>`).exec(html);
  expect(match, attribute).not.toBeNull();
  return /class="([^"]*)"/.exec(match![0])?.[1] ?? "";
}

describe("the voice call pill", () => {
  it("collapsed: avatar, dotted waveform, then Settings, Transcript, Mic and a red End, in every call state", () => {
    const states: Array<[CallPhase, string]> = [
      ["connecting", "Connecting"], ["listening", "Listening"], ["hearing", "Listening to you"], ["thinking", "Thinking"],
      ["speaking", "Speaking"], ["interrupted", "Interrupted"], ["held", "On hold"],
    ];
    for (const [phase, label] of states) {
      const html = render(phase);
      expect(html).toContain(`data-voice-phase="${phase}"`);
      expect(html).toContain('data-voice-panel="none"');
      // the state is spoken (live region) and in the avatar's tooltip, not printed
      expect(html).toMatch(new RegExp(`data-voice-status[^>]*>${label}<`));
      expect(classOf(html, "data-voice-status")).toContain("sr-only");
      expect(html).toContain(`title="Cryptic · 0:00 · ${label}"`);
      const order = ["data-voice-avatar", "data-voice-waveform", "data-voice-gear", "data-voice-transcript-toggle", "data-voice-mute", "data-voice-end"].map((a) => html.indexOf(`${a}="true"`));
      expect(order.every((index) => index > 0), `${phase} controls ${order}`).toBe(true);
      expect(order, `${phase} order`).toEqual([...order].sort((a, b) => a - b));
      // the reference has no hold or timer in the pill
      expect(html).not.toContain("data-voice-hold");
      expect(html).not.toContain("data-voice-timer");
      expect(html).not.toContain("data-voice-card");
    }
    expect(render("speaking", {}, true)).toMatch(/data-voice-status[^>]*>Muted</);
  });

  it("collapsed: a compact centered rounded pill, the End button red", () => {
    const html = render("listening");
    const pill = classOf(html, "data-voice-pill");
    expect(pill).toContain("rounded-full");
    expect(pill).toContain("mx-auto");
    expect(pill).toContain("max-w-[420px]");
    expect(pill).toContain("@container/callpill");
    expect(classOf(html, "data-voice-pill-row")).toContain("h-12");
    expect(classOf(html, "data-voice-end")).toContain("bg-danger");
    expect(html).toContain("<canvas");
  });

  it("narrow: the waveform gives way first, the controls never shrink", () => {
    const html = render("speaking");
    const wave = classOf(html, "data-voice-waveform");
    expect(wave).toMatch(/(^| )hidden( |$)/);
    expect(wave).toContain("@[17.5rem]/callpill:block");
    expect(wave).toContain("min-w-0");
    expect(wave).toContain("flex-1");
    expect(classOf(html, "data-voice-controls")).toContain("shrink-0");
    for (const control of ["data-voice-gear", "data-voice-transcript-toggle", "data-voice-mute", "data-voice-end"]) {
      expect(classOf(html, control), control).toContain("shrink-0");
    }
  });

  it("an alert opens the card below the pill row, scrollable", () => {
    const html = render("listening", { note: "The microphone is busy" });
    expect(html).toContain('data-voice-panel="alert"');
    expect(html.indexOf("data-voice-controls")).toBeLessThan(html.indexOf("data-voice-card"));
    expect(classOf(html, "data-voice-callbar-panels")).toMatch(/max-h-\[min\(55vh,360px\)\].*overflow-y-auto/);
    expect(classOf(html, "data-voice-pill")).toContain("rounded-[22px]");
  });
});

describe("the pill's expanded card", () => {
  const transcript = [
    { id: "1", who: "you" as const, text: "Testing testing testing" },
    { id: "2", who: "bot" as const, text: "T'es bien en ligne. Tout roule de ton bord?" },
  ];

  it("transcript: the person's lines on the right, the bot's on the left, the button active, timer and state in the header", () => {
    const html = render("listening", { transcript, defaultPanel: "transcript" });
    expect(html).toContain('data-voice-panel="transcript"');
    expect(classOf(html, "data-voice-pill")).toContain("rounded-[22px]");
    expect(html).toMatch(/aria-expanded="true"[^>]*data-voice-transcript-toggle/);
    expect(classOf(html, "data-voice-transcript-toggle")).toContain("bg-ink");
    expect(html).toMatch(/data-voice-line="you"[^>]*>Testing testing testing</);
    expect(html).toMatch(/data-voice-line="bot"[^>]*>T&#x27;es bien en ligne\. Tout roule de ton bord\?</);
    expect(classOf(html, 'data-voice-line="you"')).toContain("self-end");
    expect(classOf(html, 'data-voice-line="bot"')).toContain("self-start");
    expect(html).toMatch(/data-voice-timer[^>]*>0:00 · Listening</);
    // a hairline divides the pill row from the card, which scrolls
    expect(classOf(html, "data-voice-card")).toContain("border-t");
    expect(html.indexOf("data-voice-controls")).toBeLessThan(html.indexOf("data-voice-card"));
  });

  it("transcript: the words being said show as a live bubble on the speaker's side", () => {
    const hearing = render("hearing", { transcript, heard: "and one more", defaultPanel: "transcript" });
    expect(classOf(hearing, 'data-voice-line="live"')).toContain("self-end");
    const speaking = render("speaking", { transcript, caption: "Oui, je t'entends.", defaultPanel: "transcript" });
    expect(classOf(speaking, 'data-voice-line="live"')).toContain("self-start");
    expect(render("listening", { defaultPanel: "transcript" })).toContain("Nothing said yet.");
  });

  it("settings: Voice, Speed and Language rows, the gear ringed, hold inside the card", () => {
    const html = render("listening", { defaultPanel: "settings" });
    expect(html).toContain('data-voice-panel="settings"');
    expect(classOf(html, "data-voice-gear")).toContain("ring-2");
    expect(html).toMatch(/aria-expanded="true"[^>]*data-voice-gear/);
    const rows = ["voice", "speed", "language"].map((list) => html.indexOf(`data-voice-list="${list}"`));
    expect(rows.every((index) => index > 0)).toBe(true);
    expect(rows).toEqual([...rows].sort((a, b) => a - b));
    expect(html).toContain(">Voice<");
    expect(html).toContain(">Speed<");
    expect(html).toContain(">Language<");
    expect(html).toContain("data-voice-hold");
    expect(render("held", { defaultPanel: "settings" })).toMatch(/aria-pressed="true"[^>]*data-voice-hold/);
  });

  it("closes on Escape (an open list first) and on a click outside", () => {
    const source = readFileSync(new URL("./VoiceModeBar.tsx", import.meta.url), "utf8");
    expect(source).toMatch(/if \(event\.key !== "Escape"\) return;[\s\S]*if \(list\) return setList\(null\);[\s\S]*setPanel\(null\)/);
    expect(source).toMatch(/!pill\.current\.contains\(event\.target\)\)[\s\S]*setPanel\(null\)/);
  });
});

describe("where the bar lives", () => {
  it("ChatView puts it first in the banner stack, under the name chip; the overlay is the older call only", () => {
    const chat = readFileSync(new URL("../ChatView.tsx", import.meta.url), "utf8");
    expect(chat).toMatch(/<div className="chat-banners[^"]*">\s*\{\/\*[\s\S]*?\*\/\}\s*<VoiceCallDock bot=\{bot\} \/>/);
    const view = readFileSync(new URL("../CallView.tsx", import.meta.url), "utf8");
    const overlay = view.slice(view.indexOf("export function CallOverlay"), view.indexOf("export function VoiceCallDock"));
    expect(overlay).not.toContain("<LiveCall");
    expect(overlay).toContain("voiceMode?.available === true) return null");
    // the collapsed pill keeps its own small row; the card hangs over the thread
    const dock = view.slice(view.indexOf("export function VoiceCallDock"), view.indexOf("/** The older call: the macOS"));
    expect(dock).toMatch(/className="animate-call-dock-in relative z-20 mb-2 h-12 px-3" data-voice-call-dock/);
    expect(dock).toContain('className="pointer-events-none absolute inset-x-3 top-0"');
  });
});
