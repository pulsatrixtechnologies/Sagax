import { useCallback, useState } from "react";

import { LIVE_VOICE_OPTIONS } from "../../shared/live-call";
import { t } from "@/lib/i18n";
import { liveDisclosure } from "@/lib/call-mode";
import { api, useStore } from "@/state/store";
import type { LiveSettings } from "../../shared/wire";
import { SettingsText } from "./SettingsLink";
import { PillSelect, SwitchRow } from "./SettingsPrimitives";
import { readableError } from "@/lib/plain-error";

const IDLE_CHOICES = [1, 2, 3, 5, 10, 15, 30, 60];

function useLiveSettingsEditor() {
  const { state, dispatch } = useStore();
  const live: LiveSettings = state.config?.live ?? { enabled: false, configured: false, voice: "", readTypedReplies: true, idleMinutes: 5 };
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (patch: Partial<Pick<LiveSettings, "voice" | "readTypedReplies" | "idleMinutes">>) => {
    setSaving(true);
    setError(null);
    try {
      const body = await api<{ live: LiveSettings }>("/api/live/settings", { method: "PATCH", body: JSON.stringify(patch) });
      if (state.config) dispatch({ type: "configStatus", config: { ...state.config, live: body.live } });
    } catch (saveError) {
      setError(readableError(saveError));
    } finally {
      setSaving(false);
    }
  };


  return { live, saving, error, save };
}

/** The gear in the call bar. The next call's voice only. The key, idle
 * minutes and typed replies are installation settings. */
export function LiveCallSettings({ onClose }: { onClose: () => void }) {
  const { live, saving, error, save } = useLiveSettingsEditor();
  const focusOnOpen = useCallback((dialog: HTMLDivElement | null) => {
    dialog?.querySelector<HTMLElement>("select, input, button")?.focus();
  }, []);
  const voice = live.voice || "marin";
  const known = LIVE_VOICE_OPTIONS.some((option) => option.id === voice);

  return (
    <div
      ref={focusOnOpen}
      role="dialog"
      tabIndex={-1}
      aria-label={t("call.live.settings")}
      className="flex w-[300px] max-w-[90vw] flex-col gap-3 rounded-xl border border-hairline bg-panel p-3 text-[12.5px] text-ink shadow-lg"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        onClose();
      }}
    >
      <label className="flex items-center justify-between gap-2">
        <span className="text-ink-secondary">{t("call.live.voice")}</span>
        <select
          value={voice}
          disabled={saving}
          onChange={(event) => void save({ voice: event.target.value })}
          className="min-w-0 rounded-md border border-hairline/60 bg-panel px-2 py-1 text-ink outline-none"
        >
          {!known && <option value={voice}>{voice}</option>}
          {LIVE_VOICE_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      </label>
      <div className="-mt-2 text-[11.5px] text-ink-tertiary">{t("call.live.voiceNext")}</div>
      <div className="text-[11.5px] text-ink-tertiary">
        <SettingsText text={t("voice.live.inSettings")} links={{ settings: { section: "engines", cardId: "voice.advanced" } }} />
      </div>
      {error && <div className="text-[12px] text-danger">{error}</div>}
    </div>
  );
}

/** Key, silence limit and typed replies. Installation-wide, so they live in
 * Settings rather than on the call bar. */
export function LiveCallInstallationSettings() {
  const { live, saving, error, save } = useLiveSettingsEditor();
  const minutes = [...new Set([...IDLE_CHOICES, live.idleMinutes])].sort((a, b) => a - b);

  // 0.5.6: compact rows (the reference design's settings): a switch, a pill menu, the
  // key line; why typed replies matter behind the switch's info button.
  return (
    <div className="flex flex-col gap-3 text-[13px]">
      <SwitchRow
        label={t("call.live.readTyped")}
        help={t("call.live.readTypedHint")}
        checked={live.readTypedReplies}
        disabled={saving}
        onChange={(next) => void save({ readTypedReplies: next })}
      />
      <div className="flex items-center justify-between gap-4">
        <span className="min-w-0 text-ink">{t("call.live.idle")}</span>
        <PillSelect
          value={String(live.idleMinutes)}
          ariaLabel={t("call.live.idle")}
          disabled={saving}
          onChange={(next) => void save({ idleMinutes: Number(next) })}
          options={minutes.map((value) => ({ value: String(value), label: t("call.live.idleMinutes", { minutes: value }) }))}
        />
      </div>
      <div className="text-[12px] leading-4 text-ink-secondary" data-live-key={live.configured ? "openai" : "none"}>
        {t(live.configured ? "call.live.usesOpenAiKey" : "call.live.needsOpenAiKey")}
      </div>
      <div className="text-[12px] leading-4 text-ink-secondary">{liveDisclosure()} {t("call.live.cost")}</div>
      {error && <div role="alert" className="text-[12px] text-danger">{error}</div>}
    </div>
  );
}
