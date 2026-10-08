import { useCallback, useId, useState } from "react";

import { LIVE_VOICE_OPTIONS } from "../../shared/live-call";
import { t } from "@/lib/i18n";
import { liveDisclosure } from "@/lib/call-mode";
import { api, useStore, type ConfigStatus } from "@/state/store";
import type { LiveSettings } from "../../shared/wire";
import { SettingsText } from "./SettingsLink";
import { Switch } from "./SettingsPrimitives";
import { LiveKeySetup } from "./LiveKeySetup";

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
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  // An empty value removes the key: Electron deletes it from the encrypted
  // store and the harness clears it (the same call the API key settings use).
  const removeKey = async () => {
    setSaving(true);
    setError(null);
    try {
      const status: ConfigStatus = window.ogb?.setCredential
        ? await window.ogb.setCredential("openaiLiveKey", "")
        : await api("/api/config", { method: "PUT", body: JSON.stringify({ live: { key: "" } }) });
      dispatch({ type: "configStatus", config: status });
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : String(removeError));
    } finally {
      setSaving(false);
    }
  };

  return { live, saving, error, save, removeKey };
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
        <SettingsText text={t("voice.live.inSettings")} links={{ settings: { section: "connections", cardId: "connections.voice" } }} />
      </div>
      {error && <div className="text-[12px] text-danger">{error}</div>}
    </div>
  );
}

/** Key, silence limit and typed replies. Installation-wide, so they live in
 * Settings rather than on the call bar. */
export function LiveCallInstallationSettings() {
  const { live, saving, error, save, removeKey } = useLiveSettingsEditor();
  const [changingKey, setChangingKey] = useState(false);
  const typedHintId = useId();

  return (
    <div className="flex flex-col gap-3 text-[13px]">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="font-medium text-ink">{t("call.live.readTyped")}</div>
          <div id={typedHintId} className="mt-0.5 text-[11.5px] leading-relaxed text-ink-secondary">{t("call.live.readTypedHint")}</div>
        </div>
        <Switch
          checked={live.readTypedReplies}
          disabled={saving}
          aria-label={t("call.live.readTyped")}
          aria-describedby={typedHintId}
          onClick={() => void save({ readTypedReplies: !live.readTypedReplies })}
        />
      </div>
      <label className="flex items-center justify-between gap-2">
        <span className="text-ink-secondary">{t("call.live.idle")}</span>
        <select
          value={live.idleMinutes}
          disabled={saving}
          aria-label={t("call.live.idle")}
          onChange={(event) => void save({ idleMinutes: Number(event.target.value) })}
          className="rounded-md border border-hairline/60 bg-panel px-2 py-1 text-ink outline-none"
        >
          {[...new Set([...IDLE_CHOICES, live.idleMinutes])].sort((a, b) => a - b).map((minutes) => (
            <option key={minutes} value={minutes}>{minutes}</option>
          ))}
        </select>
      </label>
      <div className="flex items-center justify-between gap-2 border-t border-hairline/60 pt-2">
        <span className="text-ink-secondary">{t("call.live.key")}</span>
        <span className="flex gap-2">
          <button type="button" className="text-accent hover:underline" onClick={() => setChangingKey((open) => !open)}>
            {t("call.live.keyChange")}
          </button>
          {live.configured && (
            <button type="button" className="text-danger hover:underline" disabled={saving} onClick={() => void removeKey()}>
              {t("call.live.keyRemove")}
            </button>
          )}
        </span>
      </div>
      {changingKey && <LiveKeySetup compact onSaved={() => setChangingKey(false)} />}
      <div className="text-[11.5px] text-ink-tertiary">{liveDisclosure()} {t("call.live.cost")}</div>
      {error && <div className="text-[12px] text-danger">{error}</div>}
    </div>
  );
}
