// The voice bar's settings (the gear): Voice, Speed and Language. Stateless:
// the bar holds which list is open and what the voices are, so this draws
// the same thing for the same props and the tests can read it directly.
import type { ReactNode } from "react";
import { Check, ChevronDown, Loader2, Play, Square } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { VoiceOption } from "@/lib/voice-mode/api";
import { languageLabel, speedLabel } from "@/lib/voice-mode/settings";
import { VOICE_MODE_LANGUAGES, VOICE_MODE_SPEEDS, type VoiceModeSettings } from "../../../shared/voice-mode";

export type VoiceModeList = "voice" | "speed" | "language";

export interface VoiceModeSettingsPanelProps {
  settings: VoiceModeSettings;
  voices: VoiceOption[] | null;
  voicesError?: string | null;
  open: VoiceModeList | null;
  /** the voice being previewed, and whether its clip is still loading */
  previewing?: { id: string; loading: boolean } | null;
  onOpen(list: VoiceModeList | null): void;
  onChange(patch: Partial<VoiceModeSettings>): void;
  onPreview(voiceId: string): void;
}

function Row({ label, value, list, open, onOpen }: { label: string; value: string; list: VoiceModeList; open: VoiceModeList | null; onOpen(list: VoiceModeList | null): void }) {
  const expanded = open === list;
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-[13px] text-ink-secondary">{label}</span>
      <button
        type="button"
        data-voice-list={list}
        aria-haspopup="listbox"
        aria-expanded={expanded}
        onClick={() => onOpen(expanded ? null : list)}
        className="flex min-w-[8.5rem] items-center justify-between gap-2 rounded-lg bg-raised px-3 py-1.5 text-[13px] text-ink hover:brightness-110"
      >
        <span className="truncate">{value}</span>
        <ChevronDown size={14} className={cn("shrink-0 transition-transform", expanded && "rotate-180")} />
      </button>
    </div>
  );
}

function Option({ selected, label, onSelect, children, value }: { selected: boolean; label: string; value: string; onSelect(): void; children?: ReactNode }) {
  return (
    <li
      role="option"
      aria-selected={selected}
      data-value={value}
      className={cn("flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-ink hover:bg-raised", selected && "bg-raised/60")}
    >
      {children}
      <button type="button" onClick={onSelect} className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left">
        <span className="truncate">{label}</span>
        {selected && <Check size={14} className="shrink-0 text-accent" aria-label={t("voiceMode.selected")} />}
      </button>
    </li>
  );
}

export function VoiceModeSettingsPanel(props: VoiceModeSettingsPanelProps) {
  const { settings, voices, voicesError, open, previewing, onOpen, onChange, onPreview } = props;
  const voiceName = settings.voice ? voices?.find((voice) => voice.id === settings.voice)?.label ?? settings.voice : t("voiceMode.notSet");
  const select = (patch: Partial<VoiceModeSettings>) => {
    onChange(patch);
    onOpen(null);
  };
  return (
    <div className="flex flex-col px-1 pb-2" data-voice-settings>
      <Row label={t("voiceMode.voice")} value={voiceName} list="voice" open={open} onOpen={onOpen} />
      {open === "voice" && (
        <ul role="listbox" aria-label={t("voiceMode.voice")} className="max-h-56 overflow-y-auto rounded-lg border border-hairline/60 bg-panel p-1">
          <Option selected={settings.voice === ""} value="" label={t("voiceMode.notSet")} onSelect={() => select({ voice: "" })} />
          {voices === null && !voicesError && (
            <li className="flex items-center gap-2 px-2 py-1.5 text-[12.5px] text-ink-tertiary">
              <Loader2 size={13} className="animate-spin" /> {t("voiceMode.loadingVoices")}
            </li>
          )}
          {voicesError && <li className="px-2 py-1.5 text-[12.5px] text-danger">{voicesError}</li>}
          {(voices ?? []).map((voice) => {
            const playing = previewing?.id === voice.id;
            return (
              <Option key={voice.id} selected={settings.voice === voice.id} value={voice.id} label={voice.label} onSelect={() => select({ voice: voice.id })}>
                <button
                  type="button"
                  data-preview={voice.id}
                  aria-label={t("voiceMode.preview", { voice: voice.label })}
                  onClick={() => onPreview(voice.id)}
                  className="flex size-6 shrink-0 items-center justify-center rounded-full bg-raised text-ink-secondary hover:text-ink"
                >
                  {playing ? (previewing?.loading ? <Loader2 size={11} className="animate-spin" /> : <Square size={10} />) : <Play size={11} />}
                </button>
              </Option>
            );
          })}
        </ul>
      )}
      <Row label={t("voiceMode.speed")} value={speedLabel(settings.speed)} list="speed" open={open} onOpen={onOpen} />
      {open === "speed" && (
        <ul role="listbox" aria-label={t("voiceMode.speed")} className="rounded-lg border border-hairline/60 bg-panel p-1">
          {VOICE_MODE_SPEEDS.map((speed) => (
            <Option key={speed} selected={settings.speed === speed} value={String(speed)} label={speedLabel(speed)} onSelect={() => select({ speed })} />
          ))}
        </ul>
      )}
      <Row label={t("voiceMode.language")} value={settings.language === "auto" ? t("voiceMode.autoDetect") : languageLabel(settings.language)} list="language" open={open} onOpen={onOpen} />
      {open === "language" && (
        <ul role="listbox" aria-label={t("voiceMode.language")} className="max-h-56 overflow-y-auto rounded-lg border border-hairline/60 bg-panel p-1">
          {VOICE_MODE_LANGUAGES.map((language) => (
            <Option
              key={language.code}
              selected={settings.language === language.code}
              value={language.code}
              label={language.code === "auto" ? t("voiceMode.autoDetect") : language.label}
              onSelect={() => select({ language: language.code })}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
