// The installation voice engine: provider, key, Chatterbox server and Fish
// model. Every bot shares it. A bot's own voice stays in VoiceSettings.
import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";

import { api, useStore, type ConfigStatus } from "@/state/store";
import { useDesktopCapabilities } from "@/components/DesktopCapabilities";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { voiceKeyDraftValue, type VoiceKeyDraft } from "@/lib/voice-key-draft";

const FISH_MODELS = [
  { value: "s2.1-pro", label: "voice.fish.modelPro" },
  { value: "s2.1-pro-free", label: "voice.fish.modelFree" },
] as const;
type FishModel = (typeof FISH_MODELS)[number]["value"];

const INPUT_CLASS = "w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink placeholder:text-ink-secondary focus:outline-none";
const SAVE_CLASS = "flex w-[88px] shrink-0 items-center justify-center gap-1.5 rounded-lg bg-control py-2 text-[13px] text-ink hover:bg-raised-hover disabled:cursor-not-allowed disabled:opacity-50";

export function VoiceEngineSettings() {
  const { state, dispatch } = useStore();
  const tts = state.config?.tts;
  const [keyDraft, setKeyDraft] = useState<VoiceKeyDraft>({ provider: null, value: "" });
  const [serverUrl, setServerUrl] = useState("");
  const [model, setModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingServer, setSavingServer] = useState(false);
  const [savingFishModel, setSavingFishModel] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { capabilities } = useDesktopCapabilities();
  const provider = tts?.provider ?? "elevenlabs";
  const cloudProvider = provider === "fish"
    ? {
        id: "fish" as const,
        name: "Fish Audio",
        credential: "fishAudioKey" as const,
        configField: "fishKey" as const,
        keyUrl: "https://fish.audio/app/api-keys/",
      }
    : provider === "elevenlabs"
      ? {
          id: "elevenlabs" as const,
          name: "ElevenLabs",
          credential: "ttsKey" as const,
          configField: "key" as const,
          keyUrl: "https://elevenlabs.io/app/settings/api-keys",
        }
      : null;
  const key = cloudProvider ? voiceKeyDraftValue(keyDraft, cloudProvider.id) : "";
  const systemVoicesAvailable = capabilities.host.platform === "darwin";
  const configured = Boolean(tts?.configured);
  const included = Boolean(tts?.included);

  useEffect(() => {
    setServerUrl(tts?.baseUrl ?? "");
    setModel(tts?.model ?? "");
  }, [tts?.baseUrl, tts?.model]);

  // Discard an unsaved draft when the provider changes, including a change
  // from another open client. The draft is tagged so a render that lands
  // before this effect cannot send one provider's credential to another.
  useEffect(() => {
    setKeyDraft({ provider: null, value: "" });
  }, [provider]);

  const setProvider = (next: "elevenlabs" | "fish" | "system" | "chatterbox" | "xai") => {
    if (!tts || next === provider || switching || (next === "system" && !systemVoicesAvailable)) return;
    setSwitching(true);
    setKeyDraft({ provider: null, value: "" });
    setError(null);
    api("/api/config", { method: "PUT", body: JSON.stringify({ tts: { provider: next } }) })
      .then((status: ConfigStatus) => dispatch({ type: "configStatus", config: status }))
      .catch((e: Error) => setError(e.message))
      .finally(() => setSwitching(false));
  };

  const saveKey = () => {
    const nextKey = key.trim();
    if (!nextKey || !cloudProvider || keyDraft.provider !== cloudProvider.id) return Promise.resolve();
    setSaving(true);
    setError(null);
    const request = window.ogb?.setCredential
      ? window.ogb.setCredential(cloudProvider.credential, nextKey)
      : api("/api/config", {
          method: "PUT",
          body: JSON.stringify({ tts: { [cloudProvider.configField]: nextKey } }),
        });
    return request
      .then((status: ConfigStatus) => {
        dispatch({ type: "configStatus", config: status });
        setKeyDraft({ provider: null, value: "" });
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setSaving(false));
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

      {cloudProvider && (
        <div className="mt-4">
          <div className="mb-1.5 flex items-center gap-2 text-[13px] text-ink-secondary">
            <span className={cn("size-1.5 rounded-full", configured ? "bg-success" : "bg-raised-hover")} />
            <span>{t("voice.engine.key", { name: cloudProvider.name })}</span>
            {configured && <span className="text-[11px] text-success">{included ? t("keys.includedWithCloudPro") : t("keys.connected")}</span>}
          </div>
          <div className="flex gap-2">
            <input
              type="password"
              value={key}
              onChange={(e) => setKeyDraft({ provider: cloudProvider.id, value: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && key.trim() && void saveKey()}
              placeholder={configured && !included ? t("voice.engine.replace") : t("voice.engine.paste", { name: cloudProvider.name })}
              aria-label={t("voice.engine.key", { name: cloudProvider.name })}
              autoComplete="off"
              className={INPUT_CLASS}
            />
            <button
              type="button"
              onClick={() => void saveKey()}
              disabled={saving || !key.trim()}
              className={SAVE_CLASS}
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : <><Check size={13} />{t("common.save")}</>}
            </button>
          </div>
          {!configured && (
            <a
              href={cloudProvider.keyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1.5 inline-block text-[12px] font-medium text-accent hover:underline"
            >
              {t("voice.engine.getKey", { name: cloudProvider.name })}
            </a>
          )}
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

      {provider === "xai" && (
        <p className="mt-4 text-[13px] text-ink-secondary">
          {configured ? t("voice.grok.ready") : t("voice.grok.missingKey")}
        </p>
      )}

      {provider === "chatterbox" && (
        <div className="mt-4">
          <div className="mb-1.5 flex items-center gap-2 text-[13px] text-ink-secondary">
            <span className={cn("size-1.5 rounded-full", configured ? "bg-success" : "bg-raised-hover")} />
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
