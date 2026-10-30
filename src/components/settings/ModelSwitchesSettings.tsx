// Settings > Models > Active models (2026-10-30, "Providers, models and
// voice", lot 2): one switch per model, grouped by provider. Two levels:
// what the organization turned off in Perspicax (greyed here, with the
// reason, changed there only) and what the person turns off for their own
// bots, Auto and voice (shared/offered-models.ts, GET/PUT /api/me/models).
// A model nobody turned off is on, a new one included. Ids stay out of
// sight: each row names the model, "Copy the identifier" is not needed here
// (the provider's row on Providers has it).
import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";

import { api, useStore, type InstanceInfo } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useOfferedInstances } from "@/lib/offered-instances";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import { canEditConfig } from "@/lib/viewer";
import { modelKey, modelOffer, type ModelSwitches } from "../../../shared/offered-models";
import { engineReady } from "../EngineLibrary";
import { FIELD, FoldRow, HelpTip, SettingsGroup, Switch } from "../SettingsPrimitives";

/** The rows a group lists: an engine's own models, never a model of this
 * computer grafted on it (those are Providers > This computer). */
export function switchableModels(instance: Pick<InstanceInfo, "models">): Array<{ id: string; label: string }> {
  return (instance.models?.options ?? []).filter((option) => !option.local && !option.id.includes("::")).map((option) => ({ id: option.id, label: option.label || option.id }));
}

/** On / total for a group's count. */
export function onCount(instanceId: string, models: ReadonlyArray<{ id: string }>, switches: ModelSwitches): number {
  return models.filter((model) => modelOffer(switches, instanceId, model.id) === "on").length;
}

/** The person's list after one switch. */
export function toggledList(mine: readonly string[], key: string, on: boolean): string[] {
  const rest = mine.filter((entry) => entry !== key);
  return on ? rest : [...rest, key];
}

const SEARCH_FROM = 12;

function EngineModels({ instance, switches, mayEdit, onToggle, busy }: {
  instance: InstanceInfo;
  switches: ModelSwitches;
  mayEdit: boolean;
  onToggle: (key: string, on: boolean) => void;
  busy: boolean;
}) {
  const models = switchableModels(instance);
  const [query, setQuery] = useState("");
  const shown = query.trim() ? models.filter((model) => `${model.label} ${model.id}`.toLowerCase().includes(query.trim().toLowerCase())) : models;
  const on = onCount(instance.instanceId, models, switches);
  return (
    <FoldRow
      cardId={`models.engine.${instance.instanceId}`}
      label={instance.displayName}
      description={t("modelSwitches.count", { on, total: models.length })}
      count={on}
      toggleLabel={t("modelSwitches.toggle", { name: instance.displayName })}
    >
      <div className="flex flex-col gap-1" data-model-switches={instance.instanceId}>
        {models.length >= SEARCH_FROM && (
          <label className="relative mb-1 block">
            <Search size={13} aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-secondary" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("modelSwitches.search")} aria-label={t("modelSwitches.search")} className={cn(FIELD, "pl-8")} />
          </label>
        )}
        {shown.map((model) => {
          const offer = modelOffer(switches, instance.instanceId, model.id);
          const key = modelKey(instance.instanceId, model.id);
          return (
            <div key={model.id} data-model-switch={model.id} data-model-offer={offer} className="flex min-h-[36px] items-center justify-between gap-3">
              <span className="min-w-0">
                <span className={cn("block truncate text-[13px]", offer === "adminOff" ? "text-ink-secondary" : "text-ink")}>{model.label}</span>
                {offer === "adminOff" && <span className="block text-[12px] leading-4 text-ink-secondary">{t("modelSwitches.adminOff")}</span>}
              </span>
              <Switch
                checked={offer === "on"}
                disabled={!mayEdit || busy || offer === "adminOff"}
                aria-label={t("modelSwitches.switch", { name: model.label })}
                onClick={() => onToggle(key, offer !== "on")}
              />
            </div>
          );
        })}
      </div>
    </FoldRow>
  );
}

export function ModelSwitchesSettings() {
  const { state } = useStore();
  const org = usePerspicaxOrg();
  const engines = useOfferedInstances("settings").filter((instance) => engineReady(instance) && switchableModels(instance).length > 0);
  const [mine, setMine] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const configMine = state.config?.myDisabledModels;
  useEffect(() => { setMine(configMine ? [...configMine] : null); }, [configMine]);
  const switches = useMemo<ModelSwitches>(() => ({ org: state.config?.disabledModels ?? null, mine: mine ?? configMine ?? null }), [state.config?.disabledModels, mine, configMine]);
  // the person's own on an organization server; the installation's on a solo one
  const mayEdit = org !== null || canEditConfig(state.config);
  if (!engines.length) return null;
  const toggle = (key: string, on: boolean) => {
    const next = toggledList(switches.mine ?? [], key, on);
    setMine(next);
    setBusy(true);
    setError(null);
    api<{ mine: string[] }>("/api/me/models", { method: "PUT", body: JSON.stringify({ disabledModels: next }) })
      .then((answer) => setMine(answer.mine))
      .catch((failure: Error) => { setError(failure.message); setMine(configMine ? [...configMine] : null); })
      .finally(() => setBusy(false));
  };
  return (
    <div data-settings-card="models.switches" data-model-switches-page="">
      <SettingsGroup
        title={t("modelSwitches.title")}
        groupId="model-switches"
        accessory={<HelpTip label={t("settings.moreAbout", { title: t("modelSwitches.title") })}>{t("modelSwitches.help")}</HelpTip>}
      >
        {org !== null && <p className="px-3.5 py-1.5 text-[12px] leading-relaxed text-ink-secondary" data-model-switches-org="">{t("modelSwitches.orgBand")}</p>}
        {engines.map((instance) => <EngineModels key={instance.instanceId} instance={instance} switches={switches} mayEdit={mayEdit} onToggle={toggle} busy={busy} />)}
        {error && <p role="alert" className="px-3.5 py-1.5 text-[12px] text-danger">{error}</p>}
      </SettingsGroup>
    </div>
  );
}
