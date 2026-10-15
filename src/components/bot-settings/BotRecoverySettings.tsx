// Automatic recovery of this bot (JC 2026-10-15, formerly Settings > General
// > Advanced for every bot): whether a backup model takes over when its
// provider fails before starting, and which one. Its ordered backups
// (FallbackChain in ModelSection) win over this backup when it has some.
// Owner or admin (server/routes/bot-runtime-settings.ts).
import { useState } from "react";

import { t } from "@/lib/i18n";
import { botRecovery, type BotRecovery } from "@/lib/bot-runtime-settings";
import { useStore, type Bot } from "@/state/store";
import { Switch } from "../SettingsPrimitives";
import { PaneSection } from "./PaneSection";
import { useBotRuntimeSettings } from "./useBotRuntimeSettings";

const SELECT = "mt-2 w-full min-w-0 cursor-pointer rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink disabled:opacity-50";

export function BotRecoverySettings({ bot }: { bot: Bot }) {
  const { state } = useStore();
  const { shown, save, saving, error } = useBotRuntimeSettings(bot);
  const [draft, setDraft] = useState<BotRecovery | null>(null);
  const value = draft ?? botRecovery(shown, state.config);
  const engines = state.instances.filter((instance) => instance.snapshot.state === "available" && !instance.policy);
  const engine = engines.find((instance) => instance.instanceId === value.backup?.instanceId);
  const models = engine?.models.options.filter((model) => engine.snapshot.authenticated !== false || model.custom) ?? [];
  const ready = models.some((model) => model.id === value.backup?.model);
  const ids = { enabled: `bot-recovery-${bot.id}`, engine: `bot-recovery-engine-${bot.id}`, model: `bot-recovery-model-${bot.id}` };
  const submit = async () => {
    if (!draft || saving || (draft.enabled && !ready)) return;
    const body: BotRecovery = { enabled: draft.enabled, ...(draft.backup?.model ? { backup: draft.backup } : {}) };
    if (await save({ automaticRecovery: body })) setDraft(null);
  };
  return (
    <PaneSection data-bot-recovery="" title={t("settings.recovery.title")} help={t("settings.recovery.scope")}>
      <div className="flex items-center justify-between gap-4">
        <label htmlFor={ids.enabled} className="text-[13px] font-medium text-ink">{t("settings.recovery.enable")}</label>
        <Switch id={ids.enabled} checked={value.enabled} disabled={saving}
          aria-describedby={`${ids.enabled}-help`}
          onClick={() => setDraft({ ...value, enabled: !value.enabled })} />
      </div>
      <p id={`${ids.enabled}-help`} className="mt-2 text-[12px] leading-relaxed text-ink-secondary">{t("settings.recovery.help")}</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="min-w-0">
          <label htmlFor={ids.engine} className="block text-[13px] font-medium text-ink">{t("settings.recovery.engine")}</label>
          <select id={ids.engine} value={value.backup?.instanceId ?? ""} disabled={saving || !value.enabled}
            onChange={(event) => setDraft({ enabled: value.enabled, ...(event.target.value ? { backup: { instanceId: event.target.value, model: "" } } : {}) })}
            className={SELECT}>
            <option value="">{t("settings.recovery.chooseEngine")}</option>
            {value.backup && !engine && <option value={value.backup.instanceId} disabled>{t("settings.recovery.unavailable", { name: value.backup.instanceId })}</option>}
            {engines.map((instance) => <option key={instance.instanceId} value={instance.instanceId}
              disabled={!instance.models.options.some((model) => instance.snapshot.authenticated !== false || model.custom)}>{instance.displayName}</option>)}
          </select>
        </div>
        <div className="min-w-0">
          <label htmlFor={ids.model} className="block text-[13px] font-medium text-ink">{t("settings.recovery.model")}</label>
          <select id={ids.model} value={value.backup?.model ?? ""} disabled={saving || !value.enabled || !engine}
            onChange={(event) => setDraft({ enabled: value.enabled, backup: { instanceId: engine!.instanceId, model: event.target.value } })}
            className={SELECT}>
            <option value="">{t("settings.recovery.chooseModel")}</option>
            {value.backup?.model && !ready && <option value={value.backup.model} disabled>{t("settings.recovery.unavailable", { name: value.backup.model })}</option>}
            {models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
          </select>
        </div>
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-ink-secondary">{t("settings.recovery.charges")}</p>
      {value.enabled && !ready && <p className="mt-2 text-[12px] text-ink-secondary">{t("settings.recovery.required")}</p>}
      <button type="button" disabled={!draft || saving || (value.enabled && !ready)} onClick={() => void submit()}
        className="mt-3 cursor-pointer rounded-lg bg-accent px-3 py-2 text-[13px] font-medium text-accent-ink disabled:opacity-50">{saving ? t("settings.threads.saving") : t("common.save")}</button>
      {error && <p role="alert" className="mt-2 text-[12px] text-danger">{error}</p>}
    </PaneSection>
  );
}
