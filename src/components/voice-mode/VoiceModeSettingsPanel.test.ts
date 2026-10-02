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
