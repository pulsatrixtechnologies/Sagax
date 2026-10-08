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
  const call = { input: "auto" as const, onlyMyVoice: true, earcons: true, thinkingCue: true, pause: "normal" as const, advancedOpen: true };

  it("offers hands-free or push to talk, Only my voice with its enrollment, and call sounds", () => {
    const markup = html(props({ call, enrollment: { state: "none" }, onCallChange: vi.fn(), onEnroll: vi.fn(), onForget: vi.fn() }));
    expect(markup).toContain("data-voice-call-settings");
    expect(markup).toContain('data-voice-input="auto"');
    expect(markup).toContain('data-voice-input="push"');
    expect(markup).toContain("Only my voice");
    expect(markup).toContain("Record my voice");
    expect(markup).toContain("Call sounds");
    // not enrolled: the switch is off even though the setting is on
    expect(markup).toMatch(/data-voice-toggle="only-my-voice"[\s\S]*?role="switch" aria-checked="false"/);
    expect(markup).toContain('data-voice-enrollment="none"');
  });

  it("turning Only my voice on without an enrollment starts one; enrolled shows Forget my voice", () => {
    const onEnroll = vi.fn();
    const onCallChange = vi.fn();
    const tree = elements(VoiceModeSettingsPanel(props({ call, enrollment: { state: "none" }, onCallChange, onEnroll, onForget: vi.fn() })));
    const row = tree.find((el) => el.props["data-voice-toggle"] === "only-my-voice")!;
    const toggle = elements(row).find((el) => el.props.role === "switch")!;
    (toggle.props.onClick as () => void)();
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

  it("Voice, Speed and Language stay in view; every other row is in Advanced, closed by default", () => {
    const closed = { ...call, advancedOpen: false };
    const markup = html(props({ call: closed, enrollment: { state: "none" }, onCallChange: vi.fn(), onEnroll: vi.fn(), onForget: vi.fn() }));
    expect(markup).toContain('data-voice-advanced="closed"');
    expect(markup).toMatch(/aria-expanded="false"[^>]*data-voice-advanced-toggle[^>]*>.*Advanced/);
    // closed: still laid out (no reflow when it opens) but out of reach
    const body = /<div[^>]*data-voice-advanced-body[^>]*>/.exec(markup)![0];
    expect(body).toContain("grid-rows-[0fr]");
    expect(body).toContain('inert=""');
    expect(body).toContain('aria-hidden="true"');
    expect(body).toContain("transition-[grid-template-rows,opacity]");
    expect(body).toContain("duration-200");
    expect(body).toContain("motion-reduce:transition-none");
    const [voice, speed, language, advanced] = ['data-voice-list="voice"', 'data-voice-list="speed"', 'data-voice-list="language"', "data-voice-advanced-toggle"].map((a) => markup.indexOf(a));
    expect(voice).toBeLessThan(speed);
    expect(speed).toBeLessThan(language);
    expect(language).toBeLessThan(advanced);
    // Microphone, End of turn, Only my voice and its recording, Call sounds, the soft tone: all inside
    const inside = markup.slice(markup.indexOf("data-voice-advanced-body"));
    for (const row of ['data-voice-input="auto"', 'data-voice-input="push"', 'data-voice-pause="patient"', "End of turn", 'data-voice-toggle="only-my-voice"', "data-voice-enroll", 'data-voice-toggle="earcons"', 'data-voice-toggle="thinking-cue"']) {
      expect(inside, row).toContain(row);
      expect(markup.indexOf(row), row).toBeGreaterThan(advanced);
    }
  });

  it("opens Advanced and remembers it with the call's settings; open, its rows are reachable", () => {
    const onCallChange = vi.fn();
    const tree = elements(VoiceModeSettingsPanel(props({ call: { ...call, advancedOpen: false }, enrollment: { state: "none" }, onCallChange, onEnroll: vi.fn(), onForget: vi.fn() })));
    (tree.find((el) => "data-voice-advanced-toggle" in el.props)!.props.onClick as () => void)();
    expect(onCallChange).toHaveBeenCalledWith({ advancedOpen: true });
    const open = html(props({ call, enrollment: { state: "none" }, onCallChange, onEnroll: vi.fn(), onForget: vi.fn() }));
    const body = /<div[^>]*data-voice-advanced-body[^>]*>/.exec(open)![0];
    expect(body).toContain("grid-rows-[1fr]");
    expect(body).not.toContain("inert");
    expect(open).toMatch(/aria-expanded="true"[^>]*data-voice-advanced-toggle/);
    const close = elements(VoiceModeSettingsPanel(props({ call, enrollment: { state: "none" }, onCallChange, onEnroll: vi.fn(), onForget: vi.fn() })));
    (close.find((el) => "data-voice-advanced-toggle" in el.props)!.props.onClick as () => void)();
    expect(onCallChange).toHaveBeenLastCalledWith({ advancedOpen: false });
  });

  it("Only my voice, Call sounds and the soft tone are the app's standard switches, not checkboxes", () => {
    const onCallChange = vi.fn();
    const markup = html(props({ call: { ...call, earcons: false }, enrollment: { state: "enrolled" }, onCallChange, onEnroll: vi.fn(), onForget: vi.fn() }));
    expect(markup).not.toContain('type="checkbox"');
    expect(markup).toMatch(/data-voice-toggle="only-my-voice"[\s\S]*?role="switch" aria-checked="true"/);
    expect(markup).toMatch(/data-voice-toggle="earcons"[\s\S]*?role="switch" aria-checked="false"/);
    expect(markup).toMatch(/data-voice-toggle="thinking-cue"[\s\S]*?role="switch" aria-checked="true"/);
    // the description sits under its switch's label
    expect(markup).toMatch(/data-voice-toggle="only-my-voice"[\s\S]*?Only my voice[\s\S]*?text-\[12px\][^>]*>[^<]+</);
    const tree = elements(VoiceModeSettingsPanel(props({ call: { ...call, earcons: false }, enrollment: { state: "enrolled" }, onCallChange, onEnroll: vi.fn(), onForget: vi.fn() })));
    const sounds = elements(tree.find((el) => el.props["data-voice-toggle"] === "earcons")).find((el) => el.props.role === "switch")!;
    (sounds.props.onClick as () => void)();
    expect(onCallChange).toHaveBeenCalledWith({ earcons: true });
  });

  it("without the call's props the panel is the voice only (previews outside a call)", () => {
    expect(html(props())).not.toContain("data-voice-call-settings");
  });
});
