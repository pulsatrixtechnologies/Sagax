// Installation image generation: provider, key, and a custom Images API.
// Bot avatars only ask for a picture. They do not edit this connection.
import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";

import { api, useStore, type ConfigStatus } from "@/state/store";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { normalizeImageGenerationUrl, type AvatarImageProvider } from "../../../shared/image-generation";

const PROVIDER_LABEL: Record<AvatarImageProvider, LocaleKey> = {
  openai: "imageGen.provider.openai",
  xai: "imageGen.provider.xai",
  custom: "imageGen.provider.custom",
};
const PROVIDER_HINT: Record<AvatarImageProvider, LocaleKey> = {
  openai: "imageGen.hint.openai",
  xai: "imageGen.hint.xai",
  custom: "imageGen.hint.custom",
};
const PROVIDER_KEY: Record<AvatarImageProvider, LocaleKey> = {
  openai: "imageGen.key.openai",
  xai: "imageGen.key.xai",
  custom: "imageGen.key.custom",
};

const INPUT_CLASS = "w-full min-w-0 rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[12.5px] text-ink placeholder:text-ink-secondary focus:outline-none disabled:opacity-50";
const BUTTON_CLASS = "flex items-center justify-center gap-1.5 rounded-lg bg-control px-3 py-2 text-[12.5px] text-ink hover:bg-raised-hover disabled:opacity-50";

const CREDENTIAL = {
  openai: "openaiImageApiKey",
  xai: "xaiApiKey",
  custom: "customImageApiKey",
} as const;

export function ImageGenerationSettings() {
  const { state, dispatch } = useStore();
  const imageGen = state.config?.imageGen;
  const savedProvider = imageGen?.provider ?? "openai";
  const [providerDraft, setProviderDraft] = useState<AvatarImageProvider | null>(null);
  const [urlDraft, setUrlDraft] = useState<string | null>(null);
  const [modelDraft, setModelDraft] = useState<string | null>(null);
  const [imageKey, setImageKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const provider = providerDraft ?? savedProvider;
  const customUrl = urlDraft ?? imageGen?.customUrl ?? "";
  const customModel = modelDraft ?? imageGen?.customModel ?? "";
  const busy = saving;
  const keyConfigured = provider === "custom"
    ? imageGen?.customKeyConfigured === true
    : provider === "xai"
      ? (imageGen?.xaiConfigured ?? state.config?.xai?.configured) === true
      : (imageGen?.openaiConfigured ?? (savedProvider === "openai" && imageGen?.configured)) === true;
  const settingsDirty = provider !== savedProvider || (provider === "custom" && (
    customUrl.trim() !== (imageGen?.customUrl ?? "") ||
    customModel.trim() !== (imageGen?.customModel ?? "")
  ));
  const unsaved = settingsDirty || !!imageKey.trim();
  const configured = provider === savedProvider && imageGen?.configured === true;

  useEffect(() => {
    setImageKey("");
  }, [provider]);

  const saveConfig = async (patch: object) => {
    const status: ConfigStatus = await api("/api/config", {
      method: "PUT",
      body: JSON.stringify(patch),
    });
    dispatch({ type: "configStatus", config: status });
  };

  const saveCredential = async (key: string) => {
    const status: ConfigStatus = window.ogb?.setCredential
      ? await window.ogb.setCredential(CREDENTIAL[provider], key)
      : await api("/api/config", {
          method: "PUT",
          body: JSON.stringify(provider === "xai"
            ? { xai: { key } }
            : { imageGen: provider === "custom" ? { customApiKey: key } : { key } }),
        });
    dispatch({ type: "configStatus", config: status });
    setImageKey("");
  };

  const chooseProvider = async (next: AvatarImageProvider) => {
    if (busy) return;
    setProviderDraft(next);
    setImageKey("");
    setUrlDraft(null);
    setModelDraft(null);
    setError(null);
    if (next === "custom") return;
    setSaving(true);
    try {
      await saveConfig({ imageGen: { provider: next } });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setProviderDraft(null);
      setSaving(false);
    }
  };

  const saveConnection = async () => {
    if (busy || (provider === "custom" && (!customUrl.trim() || !customModel.trim()))) return;
    if (provider !== "custom" && !imageKey.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const url = provider === "custom" ? normalizeImageGenerationUrl(customUrl.trim()) : "";
      const model = customModel.trim();
      if (provider === "custom" && (model.length > 200 || ["\r", "\n", "\0"].some((character) => model.includes(character)))) {
        throw new Error(t("imageGen.modelError"));
      }
      if (imageKey.trim()) await saveCredential(imageKey.trim());
      if (provider === "custom") {
        await saveConfig({ imageGen: {
          provider,
          customUrl: url,
          customModel: model,
        } });
        setProviderDraft(null);
        setUrlDraft(null);
        setModelDraft(null);
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  const removeKey = async () => {
    if (busy) return;
    setSaving(true);
    setError(null);
    try {
      await saveCredential("");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2.5">
      <label className="block text-[13px] text-ink-secondary">
        {t("imageGen.provider")}
        <select
          value={provider}
          onChange={(event) => void chooseProvider(event.target.value as AvatarImageProvider)}
          disabled={busy || !state.config}
          aria-label={t("imageGen.provider")}
          className={`${INPUT_CLASS} mt-1`}
        >
          {(Object.keys(PROVIDER_LABEL) as AvatarImageProvider[]).map((value) => (
            <option key={value} value={value}>{t(PROVIDER_LABEL[value])}</option>
          ))}
        </select>
      </label>
      <p className="text-[11.5px] leading-relaxed text-ink-secondary">{t(PROVIDER_HINT[provider])}</p>

      {provider === "custom" && (
        <>
          <label className="block text-[11.5px] text-ink-secondary">
            {t("imageGen.baseUrl")}
            <input
              type="url"
              value={customUrl}
              disabled={busy}
              onChange={(event) => setUrlDraft(event.target.value)}
              placeholder={t("imageGen.baseUrlPlaceholder")}
              autoComplete="off"
              className={`${INPUT_CLASS} mt-1`}
            />
          </label>
          <label className="block text-[11.5px] text-ink-secondary">
            {t("imageGen.model")}
            <input
              value={customModel}
              disabled={busy}
              onChange={(event) => setModelDraft(event.target.value)}
              placeholder={t("imageGen.modelPlaceholder")}
              aria-label={t("imageGen.model")}
              autoComplete="off"
              className={`${INPUT_CLASS} mt-1`}
            />
          </label>
          <p className="text-[11px] leading-relaxed text-ink-secondary">{t("imageGen.customNote")}</p>
        </>
      )}

      <label className="block text-[11.5px] text-ink-secondary">
        {t(PROVIDER_KEY[provider])}
        <input
          type="password"
          value={imageKey}
          disabled={busy}
          onChange={(event) => setImageKey(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void saveConnection();
            }
          }}
          placeholder={keyConfigured ? t("imageGen.key.saved") : provider === "custom" ? t("imageGen.key.keyless") : t("imageGen.key.paste")}
          aria-label={t(PROVIDER_KEY[provider])}
          autoComplete="off"
          className={`${INPUT_CLASS} mt-1`}
        />
      </label>
      {provider === "xai" && (
        <p className="text-[11px] leading-relaxed text-ink-secondary">{t("imageGen.xaiShares")}</p>
      )}
      {provider === "custom" && keyConfigured && (
        <p className="text-[11px] leading-relaxed text-ink-secondary">{t("imageGen.customSaved")}</p>
      )}
      <div className="flex items-center justify-end gap-2">
        {keyConfigured && (
          <button type="button" onClick={() => void removeKey()} disabled={busy} className="mr-auto rounded-md py-1.5 text-[11.5px] text-ink-secondary hover:text-danger disabled:opacity-50">
            {t("imageGen.removeKey")}
          </button>
        )}
        <button
          type="button"
          onClick={() => void saveConnection()}
          disabled={busy || (provider === "custom" ? !customUrl.trim() || !customModel.trim() || (!unsaved && configured) : !imageKey.trim())}
          className={BUTTON_CLASS}
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
          {provider === "custom" ? t("imageGen.saveConnection") : t("imageGen.saveKey")}
        </button>
      </div>
      {error && <div role="alert" className="text-[12px] text-danger">{error}</div>}
    </div>
  );
}
