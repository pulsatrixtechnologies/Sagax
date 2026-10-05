// This bot's voice, read-aloud and voice notes. The engine, its key and the
// Chatterbox server are installation settings (Settings > API keys).
//
// The voice list comes from the harness, which holds cloud provider keys.
// The renderer never talks to ElevenLabs or Fish Audio itself.
import { useEffect, useState } from "react";
import { Volume2 } from "lucide-react";

import { api, useStore, type Bot } from "@/state/store";
import { speaker } from "@/lib/tts";
import {
  listLocalSystemVoices,
  localSystemVoicesAvailable,
  remoteSystemVoice,
  remoteVoiceProvider,
  setRemoteSystemVoice,
  setRemoteVoiceProvider,
  type RemoteVoiceProvider,
} from "@/lib/local-voice";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { SettingsText } from "./SettingsLink";
import { Switch } from "./SettingsPrimitives";



export function VoiceSettings({
  bot,
  onPatch,
  workspaceConfigurationLocked = false,
}: {
  bot: Bot;
  onPatch: (patch: Partial<Pick<Bot, "voice" | "speakReplies" | "voiceNotes">>) => void;
  workspaceConfigurationLocked?: boolean;
}) {
  const { state } = useStore();
  const tts = state.config?.tts;

  const [error, setError] = useState<string | null>(null);
  const [voices, setVoices] = useState<Array<{ id: string; label: string; description?: string }>>([]);
  const [loadingVoices, setLoadingVoices] = useState(false);

  const localMacClient = workspaceConfigurationLocked && localSystemVoicesAvailable();
  const [deviceProvider, setDeviceProvider] = useState<RemoteVoiceProvider>(() => remoteVoiceProvider());
  const [deviceVoice, setDeviceVoice] = useState(() => remoteSystemVoice(bot.id));
  const usesLocalSystem = localMacClient && deviceProvider === "system";
  // Host configuration still controls host-rendered cloud audio. A
  // paired Mac owns its installed-voice choice locally and cannot edit
  // the host engine from here.
  const provider = tts?.provider ?? "elevenlabs";
  const hostProviderLabel = provider === "fish"
    ? t("botPanel.voice.hostFish")
    : provider === "elevenlabs"
      ? t("botPanel.voice.hostEleven")
      : provider === "chatterbox"
        ? t("botPanel.voice.hostChatter")
        : provider === "xai" ? t("voice.grok.host") : t("botPanel.voice.hostVoice");
  const hostConfigured = Boolean(tts?.configured);
  const configured = usesLocalSystem || hostConfigured;

  useEffect(() => {
    setDeviceVoice(remoteSystemVoice(bot.id));
  }, [bot.id]);

  useEffect(() => {
    if (usesLocalSystem) {
      const load = () => setVoices(listLocalSystemVoices());
      load();
      window.speechSynthesis.addEventListener("voiceschanged", load);
      return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
    }
    if (!hostConfigured) {
      setVoices([]);
      return;
    }
    let alive = true;
    setLoadingVoices(true);
    api("/api/tts/voices")
      .then((r: { voices?: typeof voices; error?: string }) => {
        if (!alive) return;
        setVoices(r.voices ?? []);
        if (r.error) setError(r.error);
      })
      .catch(() => alive && setVoices([]))
      .finally(() => alive && setLoadingVoices(false));
    return () => {
      alive = false;
    };
  }, [hostConfigured, provider, usesLocalSystem]);

  const chooseDeviceProvider = (next: RemoteVoiceProvider) => {
    setRemoteVoiceProvider(next);
    setDeviceProvider(next);
    setError(null);
  };

  const chooseVoice = (voiceId: string) => {
    if (usesLocalSystem) {
      setRemoteSystemVoice(bot.id, voiceId);
      setDeviceVoice(voiceId);
      return;
    }
    onPatch({ voice: voiceId });
  };

  if (!tts) return null;

  const selectedVoice = usesLocalSystem ? deviceVoice : (bot.voice ?? "");
  const ready = usesLocalSystem || (hostConfigured && Boolean(selectedVoice || tts.voice));

  return (
    <div className="rounded-xl bg-card p-4">
      <div className="text-[15px] font-medium text-ink">{t("botPanel.voice.voice")}</div>
      <div className="mt-0.5 text-[13px] text-ink-secondary">
        {localMacClient
          ? t("voice.bot.macIntro")
          : workspaceConfigurationLocked
            ? t("voice.bot.lockedIntro")
            : t("voice.bot.intro")}
      </div>

      {!configured && (
        workspaceConfigurationLocked
          ? <p className="mt-3 text-[13px] text-ink-secondary">{t("voice.bot.hostUnset")}</p>
          : (
            <p className="mt-3 text-[13px] text-ink-secondary">
              <SettingsText text={t("voice.bot.setup")} links={{ settings: { section: "connections", cardId: "connections.voice" } }} />
            </p>
          )
      )}

      {localMacClient && (
        <div className="mt-4">
          <div className="mb-2 text-[13px] text-ink-secondary">{t("botPanel.voice.mac")}</div>
          <div className="inline-flex rounded-xl bg-inset p-1" role="radiogroup" aria-label={t("botPanel.voice.mac")}>
            {([
              { value: "system", label: t("botPanel.voice.macVoices"), available: true },
              { value: "host", label: hostProviderLabel, available: hostConfigured },
            ] as const).map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={deviceProvider === option.value}
                disabled={!option.available}
                title={!option.available ? t("botPanel.voice.hostUnsetTitle") : undefined}
                onClick={() => chooseDeviceProvider(option.value)}
                className={cn(
                  "rounded-lg px-3.5 py-1.5 text-[12.5px] transition-colors disabled:opacity-50",
                  deviceProvider === option.value ? "bg-raised text-ink shadow" : "text-ink-secondary hover:text-ink",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {configured && (
        <div className="mt-4">
          <div className="mb-1.5 text-[13px] text-ink-secondary">{t("botPanel.voice.voice")}</div>
          <div className="flex gap-2">
            <select
              value={selectedVoice}
              onChange={(e) => chooseVoice(e.target.value)}
              aria-label={t("botPanel.voice.whose", { name: bot.name })}
              data-voice-picker
              className="w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink focus:outline-none"
            >
              <option value="">
                {loadingVoices
                  ? t("botPanel.voice.loading")
                  : usesLocalSystem
                    ? t("botPanel.voice.macDefault")
                    : tts.voice
                      ? t("botPanel.voice.installDefault")
                      : t("botPanel.voice.pick")}
              </option>
              {selectedVoice && !voices.some((voice) => voice.id === selectedVoice) && (
                <option value={selectedVoice}>{t("botPanel.voice.current")}</option>
              )}
              {voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                  {v.description ? `: ${v.description}` : ""}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void speaker.speak(t("botPanel.voice.sample"), { voiceId: bot.voice, botId: bot.id })}
              disabled={!ready}
              title={ready ? t("botPanel.voice.hear") : t("botPanel.voice.pickFirst")}
              aria-label={t("botPanel.voice.hear")}
              className="flex w-[72px] shrink-0 items-center justify-center gap-1.5 rounded-lg bg-control py-2 text-[13px] text-ink hover:bg-raised-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Volume2 size={14} /> {t("botPanel.voice.try")}
            </button>
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-4 border-t border-hairline/40 pt-4">
        <div>
          <div className="text-[13px] font-medium text-ink">{t("botPanel.voice.read")}</div>
          <div className="mt-0.5 text-[11.5px] leading-relaxed text-ink-secondary">
            {t("botPanel.voice.readHelp")}
          </div>
        </div>
        <Switch
          checked={Boolean(bot.speakReplies)}
          aria-label={t("botPanel.voice.readAria")}
          onClick={() => onPatch({ speakReplies: !bot.speakReplies })}
        />
      </div>

      <div className="mt-4 flex items-center justify-between gap-4">
        <div>
          <div className="text-[13px] font-medium text-ink">{t("botPanel.voice.notes")}</div>
          <div className="mt-0.5 text-[11.5px] leading-relaxed text-ink-secondary">
            {t("botPanel.voice.notesHelp")}
          </div>
        </div>
        <Switch
          checked={bot.voiceNotes !== false}
          aria-label={t("botPanel.voice.notesAria")}
          onClick={() => onPatch({ voiceNotes: bot.voiceNotes === false })}
        />
      </div>

      {error && <div role="alert" className="mt-2 text-[12px] text-danger">{error}</div>}
    </div>
  );
}
