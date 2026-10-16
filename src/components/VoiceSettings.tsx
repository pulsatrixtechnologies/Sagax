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
import { CompactRow, DescribedRow, GROUP_CARD, PILL, PillSelect, Switch } from "./SettingsPrimitives";



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

  const voiceOptions = [
    {
      value: "",
      label: loadingVoices
        ? t("botPanel.voice.loading")
        : usesLocalSystem
          ? t("botPanel.voice.macDefault")
          : tts.voice
            ? t("botPanel.voice.installDefault")
            : t("botPanel.voice.pick"),
    },
    ...(selectedVoice && !voices.some((voice) => voice.id === selectedVoice) ? [{ value: selectedVoice, label: t("botPanel.voice.current") }] : []),
    ...voices.map((voice) => ({ value: voice.id, label: voice.description ? `${voice.label}: ${voice.description}` : voice.label })),
  ];
  const deviceOptions = [
    { value: "system" as const, label: t("botPanel.voice.macVoices") },
    // The host's audio is offered once the host has a voice engine.
    ...(hostConfigured || deviceProvider === "host" ? [{ value: "host" as const, label: hostProviderLabel }] : []),
  ];

  // 2026-10-16 (JC): drawn like Settings: one card of compact rows (label
  // at the left, control at the right), the voice in a pill menu, the
  // explanations behind the info buttons.
  return (
    <div className={GROUP_CARD} data-voice-settings="">
      {!configured && (
        <DescribedRow
          label={t("botPanel.voice.voice")}
          description={workspaceConfigurationLocked
            ? t("voice.bot.hostUnset")
            : <SettingsText text={t("voice.bot.setup")} links={{ settings: { section: "engines", cardId: "connections.voice" } }} />}
        />
      )}

      {localMacClient && (
        <DescribedRow label={t("botPanel.voice.mac")} help={t("voice.bot.macIntro")}>
          <PillSelect<RemoteVoiceProvider>
            value={deviceProvider}
            ariaLabel={t("botPanel.voice.mac")}
            onChange={chooseDeviceProvider}
            options={deviceOptions}
          />
        </DescribedRow>
      )}

      {configured && (
        <CompactRow label={t("botPanel.voice.voice")}>
          <span data-voice-picker="" className="inline-flex min-w-0">
            <PillSelect
              value={selectedVoice}
              ariaLabel={t("botPanel.voice.whose", { name: bot.name })}
              onChange={chooseVoice}
              options={voiceOptions}
            />
          </span>
          <button
            type="button"
            onClick={() => void speaker.speak(t("botPanel.voice.sample"), { voiceId: bot.voice, botId: bot.id })}
            disabled={!ready}
            title={ready ? t("botPanel.voice.hear") : t("botPanel.voice.pickFirst")}
            aria-label={t("botPanel.voice.hear")}
            className={cn(PILL, "gap-1.5 disabled:cursor-not-allowed")}
          >
            <Volume2 size={13} aria-hidden="true" /> {t("botPanel.voice.try")}
          </button>
        </CompactRow>
      )}

      <DescribedRow label={t("botPanel.voice.read")} help={t("botPanel.voice.readHelp")}>
        <Switch
          checked={Boolean(bot.speakReplies)}
          aria-label={t("botPanel.voice.readAria")}
          onClick={() => onPatch({ speakReplies: !bot.speakReplies })}
        />
      </DescribedRow>

      <DescribedRow label={t("botPanel.voice.notes")} help={t("botPanel.voice.notesHelp")}>
        <Switch
          checked={bot.voiceNotes !== false}
          aria-label={t("botPanel.voice.notesAria")}
          onClick={() => onPatch({ voiceNotes: bot.voiceNotes === false })}
        />
      </DescribedRow>

      {error && <div role="alert" className="px-3.5 pb-2 text-[12px] text-danger">{error}</div>}
    </div>
  );
}
