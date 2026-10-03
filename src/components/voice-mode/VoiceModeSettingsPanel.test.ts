import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { VoiceModeSettingsPanel, type VoiceModeSettingsPanelProps } from "./VoiceModeSettingsPanel";

const VOICES = [
  { id: "altair", label: "Altair" },
  { id: "ara", label: "Ara" },
  { id: "atlas", label: "Atlas" },
];

function props(overrides: Partial<VoiceModeSettingsPanelProps> = {}): VoiceModeSettingsPanelProps {
  return {
    settings: { voice: "ara", speed: 1, language: "auto" },
    voices: VOICES,
    open: null,
    onOpen: vi.fn(),
    onChange: vi.fn(),
    onPreview: vi.fn(),
    ...overrides,
  };
}

const html = (p: VoiceModeSettingsPanelProps) => renderToStaticMarkup(createElement(VoiceModeSettingsPanel, p));

/** Every element of the tree the panel returns, its function children expanded (they hold no hooks). */
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  const out: ReactElement<Record<string, unknown>>[] = [];
  const walk = (value: ReactNode) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!isValidElement(value)) return;
    const element = value as ReactElement<Record<string, unknown>>;
    if (typeof element.type === "function") return walk((element.type as (p: unknown) => ReactNode)(element.props));
    out.push(element);
    walk(element.props.children as ReactNode);
  };
  walk(node);
  return out;
}

describe("VoiceModeSettingsPanel", () => {
  it("shows Voice, Speed and Language with the current choices", () => {
    const markup = html(props());
    expect(markup).toContain(">Voice<");
    expect(markup).toContain(">Ara<");
    expect(markup).toContain(">Speed<");
    expect(markup).toContain(">1x<");
    expect(markup).toContain(">Language<");
    expect(markup).toContain(">Auto-detect<");
    expect(markup).not.toContain('role="listbox"');
  });

  it("lists Not set and every voice, a preview button each, a check on the chosen one", () => {
    const markup = html(props({ open: "voice" }));
    expect(markup).toContain('role="listbox"');
    expect(markup).toContain(">Not set<");
    for (const voice of VOICES) expect(markup).toContain(`data-preview="${voice.id}"`);
    expect(markup).toMatch(/aria-selected="true" data-value="ara"/);
    expect(markup).toMatch(/aria-selected="false" data-value="altair"/);
    expect(markup.match(/aria-label="Selected"/g)).toHaveLength(1);
  });

  it("offers the speeds and the languages of the reference design", () => {
    expect(html(props({ open: "speed" }))).toContain(">1.25x<");
    const languages = html(props({ open: "language" }));
    for (const label of ["Auto-detect", "English", "Arabic (Egypt)", "Arabic (Saudi Arabia)", "Arabic (UAE)", "Bengali", "Catalan", "Chinese (Simplified)", "Danish", "Dutch", "Finnish", "French"]) {
      expect(languages).toContain(`>${label}<`);
    }
  });

  it("picks a voice, saves it and closes the list; previews without picking", () => {
    const p = props({ open: "voice" });
    const tree = elements(VoiceModeSettingsPanel(p));
    const atlasOption = tree.find((el) => el.props["data-value"] === "atlas");
    const pick = elements(atlasOption).find((el) => el.type === "button" && !("data-preview" in el.props));
    (pick!.props.onClick as () => void)();
    expect(p.onChange).toHaveBeenCalledWith({ voice: "atlas" });
    expect(p.onOpen).toHaveBeenCalledWith(null);
    const play = tree.find((el) => el.props["data-preview"] === "altair");
    (play!.props.onClick as () => void)();
    expect(p.onPreview).toHaveBeenCalledWith("altair");
    expect(p.onChange).toHaveBeenCalledTimes(1);
  });

  it("sets speed and language", () => {
    const speed = props({ open: "speed" });
    const fast = elements(elements(VoiceModeSettingsPanel(speed)).find((el) => el.props["data-value"] === "1.5")).find((el) => el.type === "button");
    (fast!.props.onClick as () => void)();
    expect(speed.onChange).toHaveBeenCalledWith({ speed: 1.5 });
    const language = props({ open: "language" });
    const french = elements(elements(VoiceModeSettingsPanel(language)).find((el) => el.props["data-value"] === "fr")).find((el) => el.type === "button");
    (french!.props.onClick as () => void)();
    expect(language.onChange).toHaveBeenCalledWith({ language: "fr" });
  });

  it("opens a list from its row", () => {
    const p = props();
    const row = elements(VoiceModeSettingsPanel(p)).find((el) => el.props["data-voice-list"] === "language");
    (row!.props.onClick as () => void)();
    expect(p.onOpen).toHaveBeenCalledWith("language");
  });

  it("says when the voices cannot load", () => {
    expect(html(props({ open: "voice", voices: null, voicesError: "xAI rejected the key" }))).toContain("xAI rejected the key");
    expect(html(props({ open: "voice", voices: null }))).toContain("Loading voices");
  });
});

describe("the live call's settings in the panel", () => {
  const call = { input: "auto" as const, onlyMyVoice: true, earcons: true, thinkingCue: true, pause: "normal" as const };

  it("offers hands-free or push to talk, Only my voice with its enrollment, and call sounds", () => {
    const markup = html(props({ call, enrollment: { state: "none" }, onCallChange: vi.fn(), onEnroll: vi.fn(), onForget: vi.fn() }));
    expect(markup).toContain("data-voice-call-settings");
    expect(markup).toContain('data-voice-input="auto"');
    expect(markup).toContain('data-voice-input="push"');
    expect(markup).toContain("Only my voice");
    expect(markup).toContain("Record my voice");
    expect(markup).toContain("Call sounds");
    // not enrolled: the switch is off even though the setting is on
    expect(markup).toMatch(/data-voice-toggle="only-my-voice"(?![^>]*checked)/);
    expect(markup).toContain('data-voice-enrollment="none"');
  });

  it("turning Only my voice on without an enrollment starts one; enrolled shows Forget my voice", () => {
    const onEnroll = vi.fn();
    const onCallChange = vi.fn();
    const tree = elements(VoiceModeSettingsPanel(props({ call, enrollment: { state: "none" }, onCallChange, onEnroll, onForget: vi.fn() })));
    const toggle = tree.find((el) => el.props["data-voice-toggle"] === "only-my-voice")!;
    (toggle.props.onChange as (e: { target: { checked: boolean } }) => void)({ target: { checked: true } });
    expect(onEnroll).toHaveBeenCalledTimes(1);
    expect(onCallChange).not.toHaveBeenCalled();
    const enrolled = html(props({ call, enrollment: { state: "enrolled" }, onCallChange, onEnroll, onForget: vi.fn() }));
    expect(enrolled).toContain("Forget my voice");
    expect(enrolled).toContain("Record again");
  });

  it("offers the pause that ends a turn: short, normal or patient", () => {
    const onCallChange = vi.fn();
    const markup = html(props({ call, enrollment: { state: "none" }, onCallChange, onEnroll: vi.fn(), onForget: vi.fn() }));
    for (const pause of ["short", "normal", "patient"]) expect(markup).toContain(`data-voice-pause="${pause}"`);
    expect(markup).toContain("End of turn");
    expect(markup).toMatch(/aria-checked="true"[^>]*data-voice-pause="normal"/);
    const tree = elements(VoiceModeSettingsPanel(props({ call, enrollment: { state: "none" }, onCallChange, onEnroll: vi.fn(), onForget: vi.fn() })));
    (tree.find((el) => el.props["data-voice-pause"] === "patient")!.props.onClick as () => void)();
    expect(onCallChange).toHaveBeenCalledWith({ pause: "patient" });
  });

  it("shows the enrollment's progress while recording", () => {
    const markup = html(props({ call, enrollment: { state: "recording", share: 0.42 }, onCallChange: vi.fn(), onEnroll: vi.fn(), onForget: vi.fn() }));
    expect(markup).toContain("42%");
    expect(markup).not.toContain("data-voice-enroll=");
  });

  it("without the call's props the panel is the voice only (previews outside a call)", () => {
    expect(html(props())).not.toContain("data-voice-call-settings");
  });
});
