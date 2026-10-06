// The voice bar's settings (the gear): Voice, Speed and Language, then the
// call's own settings on this computer (hands-free or push to talk, "Only my
// voice" with its enrollment, call sounds). Stateless:
// the bar holds which list is open and what the voices are, so this draws
// the same thing for the same props and the tests can read it directly.
import type { ReactNode } from "react";
import { Check, ChevronsUpDown, Loader2, Play, Square } from "lucide-react";

import { CALL_PAUSES, type CallSettings } from "@/lib/voice-mode/call-settings";
import { LATENCY_STAGES, type LatencyStage } from "@/lib/voice-mode/latency";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { VoiceOption } from "@/lib/voice-mode/api";
import { languageLabel, speedLabel } from "@/lib/voice-mode/settings";
import { VOICE_MODE_LANGUAGES, VOICE_MODE_SPEEDS, type VoiceModeSettings } from "../../../shared/voice-mode";

export type VoiceModeList = "voice" | "speed" | "language";

/** Where "Only my voice" stands on this computer. */
export type Enrollment = { state: "none" } | { state: "recording"; share: number } | { state: "enrolled" } | { state: "failed" };

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
  /** the live call's settings (absent: the panel shows the voice only) */
  call?: CallSettings;
  enrollment?: Enrollment;
  onCallChange?(patch: Partial<CallSettings>): void;
  onEnroll?(): void;
  onForget?(): void;
  /** the last answer's stages (ms), shown while the call's debug switch
   * (localStorage "omb.voiceCall.debug") is on */
  latency?: Partial<Record<LatencyStage | "total", number>> | null;
}

function Toggle({ label, checked, onChange, data }: { label: string; checked: boolean; onChange(next: boolean): void; data: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-1.5">
      <span className="text-[13px] text-ink-secondary">{label}</span>
      <input type="checkbox" role="switch" checked={checked} onChange={(event) => onChange(event.target.checked)} data-voice-toggle={data} className="size-4 accent-[var(--color-accent)]" />
    </label>
  );
}

function CallSection({ call, enrollment, onCallChange, onEnroll, onForget }: Required<Pick<VoiceModeSettingsPanelProps, "call" | "enrollment" | "onCallChange" | "onEnroll" | "onForget">>) {
  const recording = enrollment.state === "recording";
  const mac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform || navigator.userAgent);
  return (
    <div className="mt-1 border-t border-hairline/50 pt-1.5" data-voice-call-settings>
      <div className="flex items-center justify-between gap-3 py-1.5">
        <span className="text-[13px] text-ink-secondary">{t("voiceMode.call.input")}</span>
        <div className="flex rounded-lg bg-raised p-0.5 text-[12.5px]" role="radiogroup" aria-label={t("voiceMode.call.input")}>
          {(["auto", "push"] as const).map((input) => (
            <button
              key={input}
              type="button"
              role="radio"
              aria-checked={call.input === input}
              data-voice-input={input}
              onClick={() => onCallChange({ input })}
              className={cn("rounded-md px-2.5 py-1", call.input === input ? "bg-panel text-ink shadow-sm" : "text-ink-secondary hover:text-ink")}
            >
              {input === "auto" ? t("voiceMode.call.handsFree") : t("voiceMode.call.push")}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 py-1.5">
        <span className="text-[13px] text-ink-secondary">{t("voiceMode.call.pause")}</span>
        <div className="flex rounded-lg bg-raised p-0.5 text-[12.5px]" role="radiogroup" aria-label={t("voiceMode.call.pause")}>
          {CALL_PAUSES.map((pause) => (
            <button
              key={pause}
              type="button"
              role="radio"
              aria-checked={call.pause === pause}
              data-voice-pause={pause}
              onClick={() => onCallChange({ pause })}
              className={cn("rounded-md px-2.5 py-1", call.pause === pause ? "bg-panel text-ink shadow-sm" : "text-ink-secondary hover:text-ink")}
            >
              {t(`voiceMode.call.pause.${pause}`)}
            </button>
          ))}
        </div>
      </div>
      <p className="pb-1 text-[11.5px] leading-snug text-ink-tertiary">{t("voiceMode.call.pauseHelp")}</p>
      <Toggle label={t("voiceMode.call.onlyMyVoice")} checked={call.onlyMyVoice && enrollment.state === "enrolled"} data="only-my-voice" onChange={(onlyMyVoice) => {
        if (onlyMyVoice && enrollment.state !== "enrolled") onEnroll();
        else onCallChange({ onlyMyVoice });
      }} />
      <p className="pb-1 text-[11.5px] leading-snug text-ink-tertiary">{t("voiceMode.call.onlyMyVoiceHelp")}</p>
      <div className="flex flex-wrap items-center gap-2 pb-1.5" data-voice-enrollment={enrollment.state}>
        {recording ? (
          <div className="flex w-full flex-col gap-1">
            <span className="text-[12.5px] text-ink">{t("voiceMode.call.enrolling", { percent: Math.round(enrollment.share * 100) })}</span>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-raised">
              <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.round(enrollment.share * 100)}%` }} />
            </div>
          </div>
        ) : (
          <>
            {enrollment.state === "enrolled" && <span className="text-[12.5px] text-ink">{t("voiceMode.call.enrolled")}</span>}
            {enrollment.state === "failed" && <span className="text-[12.5px] text-warning">{t("voiceMode.call.enrollFailed")}</span>}
            <button type="button" data-voice-enroll onClick={onEnroll} className="rounded-lg bg-raised px-2.5 py-1 text-[12.5px] text-ink hover:brightness-110">
              {enrollment.state === "enrolled" ? t("voiceMode.call.enrollAgain") : t("voiceMode.call.enroll")}
            </button>
            {enrollment.state === "enrolled" && (
              <button type="button" data-voice-forget onClick={onForget} className="rounded-lg px-2.5 py-1 text-[12.5px] text-ink-secondary hover:bg-raised hover:text-ink">
                {t("voiceMode.call.forget")}
              </button>
            )}
          </>
        )}
      </div>
      <Toggle label={t("voiceMode.call.earcons")} checked={call.earcons} data="earcons" onChange={(earcons) => onCallChange({ earcons })} />
      <Toggle label={t("voiceMode.call.thinkingCue")} checked={call.thinkingCue} data="thinking-cue" onChange={(thinkingCue) => onCallChange({ thinkingCue })} />
      {mac && <p className="pb-1 text-[11.5px] leading-snug text-ink-tertiary">{t("voiceMode.call.voiceIsolation")}</p>}
    </div>
  );
}

/** The last answer's stages, stage ids and milliseconds (a debug view). */
function LatencyLine({ latency }: { latency: NonNullable<VoiceModeSettingsPanelProps["latency"]> }) {
  const stages = LATENCY_STAGES.filter((stage) => latency[stage] !== undefined);
  return (
    <div className="mt-1 border-t border-hairline/50 pt-1.5" data-voice-latency={latency.total ?? ""}>
      <div className="text-[12px] text-ink-secondary">{t("voiceMode.call.latency", { total: latency.total ?? "?" })}</div>
      <code className="block break-words pb-1 text-[11px] leading-snug text-ink-tertiary">
        {stages.map((stage) => `${stage} ${latency[stage]}`).join(" \u00b7 ")}
      </code>
    </div>
  );
}

function Row({ label, value, list, open, onOpen }: { label: string; value: string; list: VoiceModeList; open: VoiceModeList | null; onOpen(list: VoiceModeList | null): void }) {
  const expanded = open === list;
  return (
    <button
      type="button"
      data-voice-list={list}
      aria-haspopup="listbox"
      aria-expanded={expanded}
      onClick={() => onOpen(expanded ? null : list)}
      className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-[16px] text-ink hover:bg-white/5"
    >
      <span>{label}</span>
      <span className="ml-auto flex min-w-0 items-center gap-1.5 text-[15px] text-ink-secondary">
        <span className="truncate">{value}</span>
        <ChevronsUpDown size={14} className="shrink-0 opacity-60" />
      </span>
    </button>
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
  const { settings, voices, voicesError, open, previewing, onOpen, onChange, onPreview, call, enrollment, onCallChange, onEnroll, onForget } = props;
  const voiceName = settings.voice ? voices?.find((voice) => voice.id === settings.voice)?.label ?? settings.voice : t("voiceMode.notSet");
  const select = (patch: Partial<VoiceModeSettings>) => {
    onChange(patch);
    onOpen(null);
  };
  return (
    <div className="flex flex-col" data-voice-settings>
      <div className="overflow-hidden rounded-2xl bg-inset" data-voice-rows>
      <Row label={t("voiceMode.voice")} value={voiceName} list="voice" open={open} onOpen={onOpen} />
      {open === "voice" && (
        <ul role="listbox" aria-label={t("voiceMode.voice")} className="max-h-56 overflow-y-auto border-t border-hairline/60 bg-panel p-1">
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
      <div className="mx-4 h-px bg-hairline/70" />
      <Row label={t("voiceMode.speed")} value={speedLabel(settings.speed)} list="speed" open={open} onOpen={onOpen} />
      {open === "speed" && (
        <ul role="listbox" aria-label={t("voiceMode.speed")} className="border-t border-hairline/60 bg-panel p-1">
          {VOICE_MODE_SPEEDS.map((speed) => (
            <Option key={speed} selected={settings.speed === speed} value={String(speed)} label={speedLabel(speed)} onSelect={() => select({ speed })} />
          ))}
        </ul>
      )}
      <div className="mx-4 h-px bg-hairline/70" />
      <Row label={t("voiceMode.language")} value={settings.language === "auto" ? t("voiceMode.autoDetect") : languageLabel(settings.language)} list="language" open={open} onOpen={onOpen} />
      {open === "language" && (
        <ul role="listbox" aria-label={t("voiceMode.language")} className="max-h-56 overflow-y-auto border-t border-hairline/60 bg-panel p-1">
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
      {call && enrollment && onCallChange && onEnroll && onForget && (
        <CallSection call={call} enrollment={enrollment} onCallChange={onCallChange} onEnroll={onEnroll} onForget={onForget} />
      )}
      {props.latency && (
        <LatencyLine latency={props.latency} />
      )}
    </div>
  );
}
