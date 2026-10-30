import { useState } from "react";
import { useStore } from "@/state/store";
import { t } from "@/lib/i18n";
import { useAutoModelStatus } from "@/lib/auto-model-preview";
import { autoReasonSentence } from "@/lib/auto-model";
import type { AutoModelPreview } from "../../../shared/auto-model";

/** Only metadata produced by the same candidate list as dispatch, no paid probe. */
export function AutoModelStatus({ status }: { status: AutoModelPreview | null }) {
  return <section data-auto-model-status className="flex min-w-0 flex-col gap-2 rounded-xl bg-inset p-3 text-[12px] leading-relaxed text-ink-secondary">
    <h3 className="font-semibold text-ink">{t("model.auto.chain.title")}</h3>
    {status?.pick && <p>{autoReasonSentence(status.pick)}</p>}
    {!status ? <p role="status">{t("model.auto.chain.waiting")}</p> : <>
      {status.chain?.length ? <ol data-auto-model-chain className="list-decimal space-y-1 pl-4">
        {status.chain.map((entry) => <li key={`${entry.instanceId}/${entry.model}`}><span className="text-ink">{entry.modelLabel}</span> · {entry.engineLabel}</li>)}
      </ol> : <p>{t("model.auto.chain.empty")}</p>}
      {Boolean(status.excluded?.length) && <details data-auto-model-excluded>
        <summary className="cursor-pointer font-medium text-ink">{t("model.auto.chain.excluded", { count: status.excluded.length })}</summary>
        <ul className="mt-2 space-y-1">
          {status.excluded.map((entry, index) => <li key={`${entry.instanceId}/${entry.model ?? ""}/${index}`}>{entry.modelLabel ? `${entry.modelLabel} · ` : ""}{entry.engineLabel}: {t(`model.auto.exclude.${entry.reason}`)}</li>)}
        </ul>
      </details>}
    </>}
  </section>;
}

export function AutoModelSettings() {
  const { state } = useStore();
  const bots = state.bots ?? [];
  const [picked, setPicked] = useState("");
  const bot = bots.find((candidate) => candidate.id === picked) ?? bots[0];
  const revision = JSON.stringify([bot?.modelSelection, state.config?.disabledModels, state.config?.myDisabledModels, state.instances]);
  const status = useAutoModelStatus(bot?.id ?? "", undefined, Boolean(bot), revision);
  return <div className="flex min-w-0 flex-col gap-2" data-auto-model-settings>
    <p className="text-[12px] text-ink-secondary">{t("model.auto.settings.body")}</p>
    {bot && <label className="flex items-center gap-2 text-[12px] text-ink-secondary">
      <span>{t("model.auto.chain.bot")}</span>
      <select value={bot.id} onChange={(event) => setPicked(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-hairline/40 bg-inset px-2 py-1.5 text-ink">
        {bots.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
      </select>
    </label>}
    <AutoModelStatus status={status} />
  </div>;
}
