// The installation voice engine: which engine speaks, and its non-secret
// settings (Fish model, Chatterbox server). Every bot shares it. A bot's own
// voice stays in VoiceSettings. No key is typed or managed here: each engine
// uses its key from the Keys list (Settings > Models and voice), Grok the xAI
// key, and since 2026-10-15 this card only says whether that key is saved,
// with "Add in Keys" when it is missing (one place for every key). A Grok
// voice key of an older build was folded into the xAI key (server/config.ts
// migrateGrokVoiceKey).
import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";

import { api, useStore, type ConfigStatus } from "@/state/store";
import { useDesktopCapabilities } from "@/components/DesktopCapabilities";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { KeyInKeys, keyRowSaved, type KeyRowId } from "./ProviderKeys";
import { DescribedRow, PILL, PillSelect } from "../SettingsPrimitives";

const FISH_MODELS = [
  { value: "s2.1-pro", label: "voice.fish.modelPro" },
  { value: "s2.1-pro-free", label: "voice.fish.modelFree" },
] as const;
type FishModel = (typeof FISH_MODELS)[number]["value"];

const INPUT_CLASS = "w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink placeholder:text-ink-secondary focus:outline-none";
const SAVE_CLASS = cn(PILL, "shrink-0 disabled:cursor-not-allowed");

/** The key row of the list a cloud voice engine runs on. */
export function voiceKeyRow(provider: string | undefined): KeyRowId | null {
  if (provider === "fish") return "fishAudio";
  if (provider === "xai") return "xai";
  if (provider === "system" || provider === "chatterbox") return null;
  return "elevenlabs";
}

/** `keysLink`: the Keys list is on this page, so a missing key links to its
 * row (false in a remote window, where the list is not shown). */
export function VoiceEngineSettings({ keysLink = true }: { keysLink?: boolean }) {
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
  const keySaved = keyRow ? keyRowSaved(keyRow, state.config) : false;

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

  // 0.5.6: rows of the Voice group (Grok Bot's settings rows). The engine in
  // a pill menu, its key in the grey line under it.
  const engines = ([
    { value: "elevenlabs", label: t("voice.engine.elevenlabs"), available: true },
    { value: "fish", label: t("voice.engine.fish"), available: true },
    { value: "system", label: t("voice.engine.system"), available: systemVoicesAvailable },
    { value: "chatterbox", label: t("voice.engine.chatterbox"), available: true },
    { value: "xai", label: t("voice.grok.label"), available: true },
  ] as const).filter((option) => option.available || option.value === provider);

  return (
    <>
      <DescribedRow
        label={t("voice.engine.aria")}
        rowId="voiceEngine"
        description={keyRow ? (
          <div data-voice-key={keyRow} data-voice-key-saved={keySaved || (keyRow === "elevenlabs" && included) ? "true" : "false"}>
            <KeyInKeys row={keyRow} saved={keySaved} included={keyRow === "elevenlabs" && included} link={keysLink} />
          </div>
        ) : undefined}
      >
        <PillSelect
          value={provider}
          ariaLabel={t("voice.engine.aria")}
          disabled={switching}
          onChange={(next) => setProvider(next)}
          options={engines.map(({ value, label }) => ({ value, label }))}
        />
      </DescribedRow>

      {provider === "fish" && (
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

      {provider === "chatterbox" && (
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

      {error && <div role="alert" className="px-3.5 pb-2 text-[12px] text-danger">{error}</div>}
    </>
  );
}
