// Settings > Computer > Local models. Both switches start off. Only the
// signed-in person can change their own list. Other people never edit it.
import { useEffect, useState } from "react";
import { Server, Trash2 } from "lucide-react";

import { t } from "@/lib/i18n";
import { loadLocalModels, normalizeLoopbackBase, saveLocalModels, type LocalModelSettings } from "@/lib/desktop-local-models";
import { Card, SwitchRow, cardCount } from "../SettingsPrimitives";

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

  return (
    <Card cardId="computer.localModels" title={t("localModels.title")} summary={settings.expose ? t("localModels.expose") : t("localModels.title")}>
      <div className="flex flex-col gap-3 text-[13px]" data-local-models={settings.expose ? "on" : "off"} data-local-models-share={settings.share ? "on" : "off"}>
        <p className="text-[12px] leading-relaxed text-ink-secondary">{t("localModels.help")}</p>
        <SwitchRow label={t("localModels.expose")} description={t("localModels.exposeHelp")} checked={settings.expose} onChange={(next) => save({ expose: next })} />
        <SwitchRow label={t("localModels.share")} description={t("localModels.shareHelp")} checked={settings.share} onChange={(next) => save({ share: next })} />
        <Card collapsible cardId="computer.localModels.endpoints" defaultOpen={false} title={t("localModels.endpoints")}
          summary={loaded ? endpointsSummary(settings.endpoints) : undefined}>
          <div className="flex flex-col gap-2" data-loopback-servers={settings.endpoints.length}>
            <p className="text-[12px] leading-relaxed text-ink-secondary">{t("localModels.endpointsHelp")} {t("localModels.suggestions")}</p>
            {loaded && settings.endpoints.length > 0 && (
              <ul className="divide-y divide-hairline/40 overflow-hidden rounded-xl border border-hairline/40">
                {settings.endpoints.map((endpoint) => {
                  const name = endpointName(endpoint);
                  return (
                    <li key={endpoint.id || endpoint.baseUrl} className="group flex items-center gap-3 px-3 py-2" data-loopback-server={endpoint.baseUrl}>
                      <Server size={15} aria-hidden="true" className="shrink-0 text-ink-secondary" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-ink">{name}</span>
                        <span className="block truncate font-mono text-[11.5px] text-ink-secondary">{endpoint.baseUrl}</span>
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
                className="min-h-[44px] min-w-0 flex-1 rounded-lg border border-hairline/40 bg-inset px-2 font-mono text-[12px] md:min-h-0 md:py-1" />
              <button type="submit" disabled={!loaded} className="min-h-[44px] shrink-0 rounded-lg bg-control px-3 text-[12.5px] text-ink hover:bg-raised-hover disabled:opacity-40 md:min-h-0 md:py-1">{t("localModels.add")}</button>
            </form>
            {invalid && <p role="alert" className="text-[12px] text-danger">{t("localModels.invalid")}</p>}
          </div>
        </Card>
        {loaded && settings.expose && !settings.connected && <p role="status" className="text-[12px] text-ink-secondary">{t("localModels.offline")}</p>}
        {loaded && settings.expose && settings.connected && settings.published.length === 0 && <p role="status" className="text-[12px] text-ink-secondary">{t("localModels.none")}</p>}
        {error && <p role="alert" className="text-[12px] text-danger">{t("localModels.error")}</p>}
      </div>
    </Card>
  );
}
