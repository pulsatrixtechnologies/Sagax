// Settings > Computer > Local models. Both switches start off. Only the
// signed-in person can change their own list. Other people never edit it.
import { useEffect, useState } from "react";
import { Server, Trash2 } from "lucide-react";

import { t } from "@/lib/i18n";
import { loadLocalModels, normalizeLoopbackBase, saveLocalModels, type LocalModelSettings } from "@/lib/desktop-local-models";
import { cn } from "@/lib/cn";
import { DescribedRow, FIELD, FoldRow, PILL, SettingsGroup, SettingsTextRow, Switch, cardCount } from "../SettingsPrimitives";

type Endpoint = LocalModelSettings["endpoints"][number];

/** The name shown for a loopback server: its label, else host:port. */
export function endpointName(endpoint: Endpoint): string {
  if (endpoint.label) return endpoint.label;
  try { return new URL(endpoint.baseUrl).host; } catch { return endpoint.baseUrl; }
}

/** The one-line summary of the folded list: "8 local servers · DwarfStar, Ollama, …". */
export function endpointsSummary(endpoints: Endpoint[]): string {
  const count = cardCount("servers", endpoints.length);
  if (endpoints.length === 0) return count;
  const names = endpoints.slice(0, 3).map(endpointName).join(", ");
  return `${count} · ${names}${endpoints.length > 3 ? ", …" : ""}`;
}

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

  // 2026-10-18 (JC): a group of rows, as the other pages draw them
  // (SettingsPrimitives); the loopback servers fold under their row.
  return (
    <div data-settings-card="computer.localModels" data-local-models={settings.expose ? "on" : "off"} data-local-models-share={settings.share ? "on" : "off"}>
      <SettingsGroup title={t("localModels.title")} groupId="localModels">
        <SettingsTextRow>{t("localModels.help")}</SettingsTextRow>
        <DescribedRow label={t("localModels.expose")} description={t("localModels.exposeHelp")} rowId="localModels.expose">
          <Switch checked={settings.expose} aria-label={t("localModels.expose")} onClick={() => save({ expose: !settings.expose })} />
        </DescribedRow>
        <DescribedRow label={t("localModels.share")} description={t("localModels.shareHelp")} rowId="localModels.share">
          <Switch checked={settings.share} aria-label={t("localModels.share")} onClick={() => save({ share: !settings.share })} />
        </DescribedRow>
        <FoldRow cardId="computer.localModels.endpoints" label={t("localModels.endpoints")}
          description={loaded ? endpointsSummary(settings.endpoints) : undefined} count={loaded ? settings.endpoints.length : undefined}>
          <div className="flex flex-col gap-2" data-loopback-servers={settings.endpoints.length}>
            <p className="text-[12px] leading-4 text-ink-secondary">{t("localModels.endpointsHelp")} {t("localModels.suggestions")}</p>
            {loaded && settings.endpoints.length > 0 && (
              <ul className="flex flex-col">
                {settings.endpoints.map((endpoint) => {
                  const name = endpointName(endpoint);
                  return (
                    <li key={endpoint.id || endpoint.baseUrl} className="group flex min-h-[44px] items-center gap-3 py-1" data-loopback-server={endpoint.baseUrl}>
                      <Server size={14} aria-hidden="true" className="shrink-0 text-ink-secondary" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] leading-[18px] text-ink">{name}</span>
                        <span className="block truncate font-mono text-[12px] leading-4 text-ink-secondary">{endpoint.baseUrl}</span>
                      </span>
                      <button type="button"
                        className="flex size-11 shrink-0 items-center justify-center rounded-lg text-ink-secondary opacity-0 transition-opacity hover:bg-control hover:text-danger focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 group-hover:opacity-100 group-focus-within:opacity-100 touch:opacity-100 motion-reduce:transition-none md:size-7"
                        aria-label={t("localModels.remove", { label: name })} title={t("localModels.remove", { label: name })}
                        onClick={() => save({ endpoints: settings.endpoints.filter((row) => row.baseUrl !== endpoint.baseUrl) })}>
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <form className="flex items-center gap-2" onSubmit={(event) => { event.preventDefault(); add(); }}>
              <input value={draft} onChange={(event) => { setDraft(event.target.value); setInvalid(false); }}
                placeholder={t("localModels.placeholder")} aria-label={t("localModels.endpoints")}
                className={cn(FIELD, "flex-1 font-mono text-[12px]")} />
              <button type="submit" disabled={!loaded} className={cn(PILL, "shrink-0")}>{t("localModels.add")}</button>
            </form>
            {invalid && <p role="alert" className="text-[12px] text-danger">{t("localModels.invalid")}</p>}
          </div>
        </FoldRow>
        {loaded && settings.expose && !settings.connected && <SettingsTextRow live>{t("localModels.offline")}</SettingsTextRow>}
        {loaded && settings.expose && settings.connected && settings.published.length === 0 && <SettingsTextRow live>{t("localModels.none")}</SettingsTextRow>}
        {error && <SettingsTextRow tone="danger">{t("localModels.error")}</SettingsTextRow>}
      </SettingsGroup>
    </div>
  );
}
