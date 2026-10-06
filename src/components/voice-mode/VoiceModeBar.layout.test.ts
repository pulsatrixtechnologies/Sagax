// The voice call stage fills the chat column: avatar, name, timer, the three
// settings rows, then Mic, Settings and a red End. The chevron folds it to a
// short row. The gear opens the rest of the call settings.
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

function classOf(html: string, attribute: string): string {
  const match = new RegExp(`<[^>]*\\b${attribute}(?![\\w-])[^>]*>`).exec(html);
  expect(match, attribute).not.toBeNull();
  return /class="([^"]*)"/.exec(match![0])?.[1] ?? "";
}

describe("the voice call stage", () => {
  it("shows the bot, the timer, Voice Speed and Language, then Mic, a white gear and a red End", () => {
    const html = render("listening");
    expect(html).toContain('data-voice-stage');
    expect(html).toContain(">Cryptic<");
    expect(html).toMatch(/data-voice-timer[^>]*>0:00</);
    expect(html).toMatch(/data-voice-status[^>]*>Listening</);
    expect(classOf(html, "data-voice-status")).toContain("sr-only");
    for (const label of [">Voice<", ">Speed<", ">Language<"]) expect(html).toContain(label);
    expect(html).not.toContain("data-voice-waveform");
    expect(html).not.toContain("data-voice-transcript-toggle");
    expect(html).not.toContain("data-voice-hold");
    expect(html).not.toContain("data-voice-call-settings");
    const order = ["data-voice-collapse=", "data-voice-avatar=", "data-voice-timer=", 'data-voice-list="voice"', "data-voice-mute=", "data-voice-gear=", 'data-voice-end="'].map((part) => html.indexOf(part));
    expect(order.every((index) => index > 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(classOf(html, "data-voice-end")).toContain("bg-danger");
    expect(classOf(html, "data-voice-gear")).toContain("bg-white");
    expect(render("speaking", {}, true)).toMatch(/data-voice-status[^>]*>Muted</);
  });

  it("gear opens the rest of the call settings, including hold", () => {
    const html = render("listening", { defaultPanel: "settings" });
    expect(html).toContain('data-voice-panel="settings"');
    expect(html).toContain("data-voice-call-settings");
    expect(html).toContain("data-voice-hold");
    expect(html).toMatch(/aria-expanded="true"[^>]*data-voice-gear/);
    expect(render("held", { defaultPanel: "settings" })).toMatch(/aria-pressed="true"[^>]*data-voice-hold/);
  });

  it("a note stays on the stage", () => {
    const html = render("listening", { note: "The microphone is busy" });
    expect(html).toContain('data-voice-panel="alert"');
    expect(html).toContain("The microphone is busy");
  });

  it("folded: a short row with the timer, not a card over the thread", () => {
    const html = render("listening", { collapsed: true });
    expect(html).toContain("data-voice-collapsed");
    expect(html).not.toContain("data-voice-stage");
    expect(html).toContain("data-voice-expand");
    expect(html).toContain("data-voice-end");
    expect(html).toMatch(/data-voice-timer[^>]*>0:00</);
    expect(classOf(html, "data-voice-collapsed")).toContain("h-11");
  });

  it("Escape closes an open list, then the extra settings, and does not fold the stage", () => {
    const source = readFileSync(new URL("./VoiceModeBar.tsx", import.meta.url), "utf8");
    expect(source).toMatch(/if \(event\.key !== "Escape"\) return;[\s\S]*if \(list\) setList\(null\);[\s\S]*setExtras\(false\)/);
    expect(source).not.toContain("setPanel(null)");
  });
});

describe("where the stage lives", () => {
  it("fills the chat column; the chevron folds it to a row in the banner stack", () => {
    const chat = readFileSync(new URL("../ChatView.tsx", import.meta.url), "utf8");
    expect(chat).toMatch(/<div className="chat-banners[^"]*">\s*\{\/\*[\s\S]*?\*\/\}\s*<VoiceCallDock bot=\{bot\} \/>/);
    const view = readFileSync(new URL("../CallView.tsx", import.meta.url), "utf8");
    const overlay = view.slice(view.indexOf("export function CallOverlay"), view.indexOf("export function VoiceCallDock"));
    expect(overlay).not.toContain("<LiveCall");
    expect(overlay).toContain("voiceMode?.available === true) return null");
    const dock = view.slice(view.indexOf("export function VoiceCallDock"), view.indexOf("/** The older call: the macOS"));
    expect(dock).toContain('className="absolute inset-0 z-30 flex min-h-0 flex-col bg-app" data-voice-call-dock data-voice-stage');
    expect(dock).toContain("onCollapse={() => setCollapsed(true)}");
    expect(dock).not.toContain("h-12");
  });
});
