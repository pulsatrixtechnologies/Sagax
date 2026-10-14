// The installation voice engine: which engine speaks, and its non-secret
// settings (Fish model, Chatterbox server). Every bot shares it. A bot's own
// voice stays in VoiceSettings. Since 2026-10-14 no key is typed here: each
// engine uses its key from the one list above it (Settings > Models and
// voice), Grok the xAI key. A Grok voice key of an older build was folded
// into the xAI key (server/config.ts migrateGrokVoiceKey).
import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";

import { api, useStore, type ConfigStatus } from "@/state/store";
import { useDesktopCapabilities } from "@/components/DesktopCapabilities";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { keyRowSaved, openProviderKeyDialog, type KeyRowId } from "./ProviderKeys";

const FISH_MODELS = [
  { value: "s2.1-pro", label: "voice.fish.modelPro" },
  { value: "s2.1-pro-free", label: "voice.fish.modelFree" },
] as const;
type FishModel = (typeof FISH_MODELS)[number]["value"];

const INPUT_CLASS = "w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink placeholder:text-ink-secondary focus:outline-none";
const SAVE_CLASS = "flex w-[88px] shrink-0 items-center justify-center gap-1.5 rounded-lg bg-control py-2 text-[13px] text-ink hover:bg-raised-hover disabled:cursor-not-allowed disabled:opacity-50";

/** The key row of the list a cloud voice engine runs on. */
export function voiceKeyRow(provider: string | undefined): { row: KeyRowId; name: string } | null {
  if (provider === "fish") return { row: "fishAudio", name: "Fish Audio" };
  if (provider === "xai") return { row: "xai", name: "xAI" };
  if (provider === "system" || provider === "chatterbox") return null;
  return { row: "elevenlabs", name: "ElevenLabs" };
}

export function VoiceEngineSettings() {
  const { state, dispatch } = useStore();
  const tts = state.config?.tts;
  const [serverUrl, setServerUrl] = useState("");
  const [model, setModel] = useState("");
  const [savingServer, setSavingServer] = useState(false);
  const [savingFishModel, setSavingFishModel] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { capabilities } = useDesktopCapabilities();
  const provider = tts?.provider ?? "elevenlabs";
  const keyRow = voiceKeyRow(provider);
  // A settings test can mount this card with an empty capabilities object.
  const host = (capabilities as { host?: { platform?: string } }).host;
  const systemVoicesAvailable = host?.platform === "darwin";
  const configured = Boolean(tts?.configured);
  const included = Boolean(tts?.included);
  // The engine's key is saved in the list (or included with Cloud Pro).
  const keySaved = keyRow ? keyRowSaved(keyRow.row, state.config) || (keyRow.row === "elevenlabs" && included) : false;

  useEffect(() => {
    setServerUrl(tts?.baseUrl ?? "");
    setModel(tts?.model ?? "");
  }, [tts?.baseUrl, tts?.model]);

  const setProvider = (next: "elevenlabs" | "fish" | "system" | "chatterbox" | "xai") => {
    if (!tts || next === provider || switching || (next === "system" && !systemVoicesAvailable)) return;
    setSwitching(true);
    setError(null);
    api("/api/config", { method: "PUT", body: JSON.stringify({ tts: { provider: next } }) })
      .then((status: ConfigStatus) => dispatch({ type: "configStatus", config: status }))
      .catch((e: Error) => setError(e.message))
      .finally(() => setSwitching(false));
  };

  const saveServer = () => {
    const next = serverUrl.trim();
    if (!next || savingServer) return Promise.resolve();
    if (!/^https?:\/\//i.test(next)) {
      setError(t("voice.engine.addressError"));
      return Promise.resolve();
    }
    setSavingServer(true);
    setError(null);
    return api("/api/config", { method: "PUT", body: JSON.stringify({ tts: { baseUrl: next, model: model.trim() } }) })
      .then((status: ConfigStatus) => dispatch({ type: "configStatus", config: status }))
      .catch((e: Error) => setError(e.message))
      .finally(() => setSavingServer(false));
  };

  const saveFishModel = (next: FishModel) => {
    if (next === tts?.fishModel || savingFishModel) return;
    setSavingFishModel(true);
    setError(null);
    api("/api/config", { method: "PUT", body: JSON.stringify({ tts: { fishModel: next } }) })
      .then((status: ConfigStatus) => dispatch({ type: "configStatus", config: status }))
      .catch((e: Error) => setError(e.message))
      .finally(() => setSavingFishModel(false));
  };

  if (!tts) return null;

  return (
    <div>
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-inset p-1" role="radiogroup" aria-label={t("voice.engine.aria")}>
        {([
          { value: "elevenlabs", label: t("voice.engine.elevenlabs"), available: true },
          { value: "fish", label: t("voice.engine.fish"), available: true },
          { value: "system", label: t("voice.engine.system"), available: systemVoicesAvailable },
          { value: "chatterbox", label: t("voice.engine.chatterbox"), available: true },
          { value: "xai", label: t("voice.grok.label"), available: true },
        ] as const).map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={provider === option.value}
            disabled={switching || !option.available}
            title={!option.available ? t("voice.engine.macOnly") : undefined}
            onClick={() => setProvider(option.value)}
            className={cn(
              "rounded-lg px-3.5 py-1.5 text-[12.5px] transition-colors disabled:opacity-50",
              provider === option.value ? "bg-raised text-ink shadow" : "text-ink-secondary hover:text-ink",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {keyRow && (
        <div className="mt-4 flex items-center gap-3" data-voice-key={keyRow.row} data-voice-key-saved={keySaved ? "true" : "false"}>
          <span className={cn("size-1.5 shrink-0 rounded-full", keySaved ? "bg-accent" : "bg-raised-hover")} />
          <span className="min-w-0 flex-1 text-[13px] text-ink-secondary">
            {keySaved
              ? included && keyRow.row === "elevenlabs" && !keyRowSaved("elevenlabs", state.config)
                ? t("keys.includedWithCloudPro")
                : t("modelsVoice.voice.usesKey", { name: keyRow.name })
              : t("modelsVoice.voice.needsKey", { name: keyRow.name })}
          </span>
          <button
            type="button"
            onClick={() => openProviderKeyDialog(keyRow.row)}
            className="shrink-0 rounded-lg bg-control px-3 py-1.5 text-[12.5px] text-ink hover:bg-raised-hover"
          >
            {keySaved ? t("providerKeys.manage") : t("providerKeys.add")}
          </button>
        </div>
      )}

      {provider === "fish" && (
        <div className="mt-4">
          <div className="mb-1.5 text-[13px] text-ink-secondary">{t("voice.fish.model")}</div>
          <select
            value={tts.fishModel ?? "s2.1-pro"}
            onChange={(e) => saveFishModel(e.target.value as FishModel)}
            disabled={savingFishModel}
            aria-label={t("voice.fish.model")}
            className={`${INPUT_CLASS} disabled:opacity-50`}
          >
            {FISH_MODELS.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.label)}
              </option>
            ))}
          </select>
          <div className="mt-1.5 text-[11.5px] leading-relaxed text-ink-secondary">{t("voice.fish.modelHint")}</div>
        </div>
      )}

      {provider === "chatterbox" && (
        <div className="mt-4">
          <div className="mb-1.5 flex items-center gap-2 text-[13px] text-ink-secondary">
            <span className={cn("size-1.5 rounded-full", configured ? "bg-accent" : "bg-raised-hover")} />
            <span>{t("voice.engine.server")}</span>
            {configured && <span className="text-[11px] text-success">{t("voice.engine.saved")}</span>}
          </div>
          <div className="flex gap-2">
            <input
              type="url"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void saveServer()}
              placeholder={t("voice.engine.addressPlaceholder")}
              aria-label={t("voice.engine.address")}
              autoComplete="off"
              spellCheck={false}
              className={INPUT_CLASS}
            />
            <button
              type="button"
              onClick={() => void saveServer()}
              disabled={savingServer || !serverUrl.trim()}
              className={SAVE_CLASS}
            >
              {savingServer ? <Loader2 size={13} className="animate-spin" /> : <><Check size={13} />{t("common.save")}</>}
            </button>
          </div>
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void saveServer()}
            placeholder={t("voice.engine.modelPlaceholder")}
            aria-label={t("voice.engine.model")}
            autoComplete="off"
            spellCheck={false}
            className={`${INPUT_CLASS} mt-2`}
          />
          <div className="mt-1.5 text-[11.5px] leading-relaxed text-ink-secondary">
            {t("voice.engine.serverHint")}{" "}
            <a
              href="https://github.com/resemble-ai/chatterbox"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-accent hover:underline"
            >
              {t("voice.engine.serverDocs")}
            </a>
          </div>
        </div>
      )}

      {error && <div role="alert" className="mt-2 text-[12px] text-danger">{error}</div>}
    </div>
  );
}
