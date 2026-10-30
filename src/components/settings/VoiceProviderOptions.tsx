import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";

import { api, useStore, type ConfigStatus } from "@/state/store";
import { activeLocale, t } from "@/lib/i18n";
import { setVoiceDashes, useVoiceDashes } from "@/lib/voice-dashes-preference";
import { cn } from "@/lib/cn";
import { DescribedRow, PILL, PillSelect, SettingsGroup, Switch } from "../SettingsPrimitives";

const FISH_MODELS = [
  { value: "s2.1-pro", label: "voice.fish.modelPro" },
  { value: "s2.1-pro-free", label: "voice.fish.modelFree" },
] as const;
type FishModel = (typeof FISH_MODELS)[number]["value"];

const INPUT_CLASS = "w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink placeholder:text-ink-secondary focus:outline-none";
const SAVE_CLASS = cn(PILL, "shrink-0 disabled:cursor-not-allowed");

/** Non-secret options of voice providers, independent of the person's choice. */
export function VoiceProviderOptions({ installation = false }: { installation?: boolean }) {
  const { state, dispatch } = useStore();
  const tts = state.config?.tts;
  const [serverUrl, setServerUrl] = useState("");
  const [model, setModel] = useState("");
  const [savingServer, setSavingServer] = useState(false);
  const [savingFishModel, setSavingFishModel] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const configured = Boolean(tts?.baseUrl);
  const noDashes = useVoiceDashes(activeLocale());

  useEffect(() => {
    setServerUrl(tts?.baseUrl ?? "");
    setModel(tts?.model ?? "");
  }, [tts?.baseUrl, tts?.model]);

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
    <div data-settings-card="voice.options">
      <SettingsGroup title={t("voiceMode.call.advanced")} groupId="voice-options">
      {installation && (
        <DescribedRow label={t("voice.fish.model")} help={t("voice.fish.modelHint")} rowId="fishModel">
          <PillSelect
            value={(tts.fishModel ?? "s2.1-pro") as FishModel}
            ariaLabel={t("voice.fish.model")}
            disabled={savingFishModel}
            onChange={(next) => saveFishModel(next)}
            options={FISH_MODELS.map((option) => ({ value: option.value, label: t(option.label) }))}
          />
        </DescribedRow>
      )}

      {installation && (
        <DescribedRow
          label={t("voice.engine.server")}
          rowId="chatterbox"
          description={(
            <span className="flex items-center gap-1.5">
              <span className={cn("size-1.5 rounded-full", configured ? "bg-accent" : "bg-raised-hover")} aria-hidden="true" />
              {configured ? t("voice.engine.saved") : t("voice.engine.serverHint")}
              {" "}
              <a href="https://github.com/resemble-ai/chatterbox" target="_blank" rel="noopener noreferrer" className="font-medium text-accent-text hover:underline">
                {t("voice.engine.serverDocs")}
              </a>
            </span>
          )}
          below={(
            <div className="mt-2 flex flex-col gap-2">
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
                className={INPUT_CLASS}
              />
            </div>
          )}
        />
      )}

      <DescribedRow label={t("voice.noDashes.title")} description={t("voice.noDashes.short")} rowId="voiceNoDashes">
        <Switch checked={noDashes} aria-label={t("voice.noDashes.title")} onClick={() => setVoiceDashes(!noDashes)} />
      </DescribedRow>

      {error && <div role="alert" className="px-3.5 pb-2 text-[12px] text-danger">{error}</div>}
      </SettingsGroup>
    </div>
  );
}
