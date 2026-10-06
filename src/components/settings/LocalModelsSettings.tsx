// Settings > Computer > Local models. Both switches start off. Only the
// signed-in person can change their own list. Other people never edit it.
import { useEffect, useState } from "react";

import { t } from "@/lib/i18n";
import { loadLocalModels, normalizeLoopbackBase, saveLocalModels, type LocalModelSettings } from "@/lib/desktop-local-models";
import { Card } from "../SettingsPrimitives";

const OFF: LocalModelSettings = { expose: false, share: false, endpoints: [], published: [], connected: false };

export function LocalModelsSettings() {
  const [settings, setSettings] = useState<LocalModelSettings>(OFF);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadLocalModels().then((value) => {
      if (cancelled || !value) return;
      setSettings(value);
      setLoaded(true);
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, []);

  const save = (patch: { expose?: boolean; share?: boolean; endpoints?: LocalModelSettings["endpoints"] }) => {
    setError(false);
    void saveLocalModels(patch).then((value) => {
      setSettings(value);
      setLoaded(true);
    }).catch(() => setError(true));
  };

  const add = () => {
    if (!loaded) return;
    const baseUrl = normalizeLoopbackBase(draft.trim());
    if (!baseUrl) { setInvalid(true); return; }
    setInvalid(false);
    setDraft("");
    save({ endpoints: [...settings.endpoints.filter((row) => row.baseUrl !== baseUrl), { id: "", label: "", baseUrl }] });
  };

  return (
    <Card cardId="computer.localModels" title={t("localModels.title")} summary={settings.expose ? t("localModels.expose") : t("localModels.title")}>
      <div className="flex flex-col gap-3 text-[13px]" data-local-models={settings.expose ? "on" : "off"} data-local-models-share={settings.share ? "on" : "off"}>
        <p className="text-[12px] leading-relaxed text-ink-secondary">{t("localModels.help")}</p>
        <label className="flex min-h-[44px] items-center gap-2 md:min-h-0">
          <input type="checkbox" checked={settings.expose} onChange={(event) => save({ expose: event.target.checked })} />
          <span>{t("localModels.expose")}</span>
        </label>
        <p className="text-[12px] leading-relaxed text-ink-secondary">{t("localModels.exposeHelp")}</p>
        <label className="flex min-h-[44px] items-center gap-2 md:min-h-0">
          <input type="checkbox" checked={settings.share} onChange={(event) => save({ share: event.target.checked })} />
          <span>{t("localModels.share")}</span>
        </label>
        <p className="text-[12px] leading-relaxed text-ink-secondary">{t("localModels.shareHelp")}</p>
        <div className="flex flex-col gap-1">
          <span className="text-ink-secondary">{t("localModels.endpoints")}</span>
          <p className="text-[12px] leading-relaxed text-ink-secondary">{t("localModels.endpointsHelp")}</p>
          <p className="text-[12px] leading-relaxed text-ink-secondary">{t("localModels.suggestions")}</p>
          {loaded && settings.endpoints.map((endpoint) => (
            <div key={endpoint.id || endpoint.baseUrl} className="flex items-center justify-between gap-2">
              <span>{endpoint.label ? `${endpoint.label} ` : ""}<span className="text-ink-secondary">{endpoint.baseUrl}</span></span>
              <button type="button" className="min-h-[44px] rounded-lg px-2 text-[12px] text-ink-secondary hover:bg-control hover:text-ink md:min-h-0"
                aria-label={t("localModels.remove", { label: endpoint.label || endpoint.baseUrl })}
                onClick={() => save({ endpoints: settings.endpoints.filter((row) => row.baseUrl !== endpoint.baseUrl) })}>
                {t("localModels.remove", { label: endpoint.label || endpoint.baseUrl })}
              </button>
            </div>
          ))}
          <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); add(); }}>
            <input value={draft} onChange={(event) => { setDraft(event.target.value); setInvalid(false); }}
              placeholder={t("localModels.placeholder")} aria-label={t("localModels.endpoints")}
              className="min-h-[44px] min-w-0 flex-1 rounded-lg border border-hairline/40 bg-inset px-2 text-[12.5px] md:min-h-0" />
            <button type="submit" disabled={!loaded} className="min-h-[44px] rounded-lg bg-control px-3 text-[12.5px] text-ink hover:bg-raised-hover disabled:opacity-40 md:min-h-0">{t("localModels.add")}</button>
          </form>
          {invalid && <p role="alert" className="text-[12px] text-danger">{t("localModels.invalid")}</p>}
          {loaded && settings.expose && !settings.connected && <p role="status" className="text-[12px] text-ink-secondary">{t("localModels.offline")}</p>}
          {loaded && settings.expose && settings.connected && settings.published.length === 0 && <p role="status" className="text-[12px] text-ink-secondary">{t("localModels.none")}</p>}
          {error && <p role="alert" className="text-[12px] text-danger">{t("localModels.error")}</p>}
        </div>
      </div>
    </Card>
  );
}
