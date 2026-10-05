import { useRef, useState } from "react";
import { api, useStore, type ConfigStatus } from "@/state/store";
import { t } from "@/lib/i18n";
import { Card, ScopeMark } from "./SettingsPrimitives";
import { useBusySendPreference, writeBusySendPreference } from "@/lib/busy-send";
import { DEFAULT_MAX_PARALLEL_PER_PERSON, MAX_PARALLEL_PER_PERSON, parseBusySendPreference } from "../../shared/parallel-tasks";

export function ThreadConcurrencySettings() {
  const { state, dispatch } = useStore();
  const confirmed = state.config?.threads?.maxConcurrentPerBot ?? 3;
  const parallelLimit = state.config?.threads?.maxParallelPerPerson ?? DEFAULT_MAX_PARALLEL_PER_PERSON;
  const busySend = useBusySendPreference();
  const [pending, setPending] = useState<number | null>(null);
  const [error, setError] = useState("");
  const saving = useRef(false);
  const save = async (limit: number, key: "maxConcurrentPerBot" | "maxParallelPerPerson" = "maxConcurrentPerBot") => {
    if (saving.current || limit === (key === "maxConcurrentPerBot" ? confirmed : parallelLimit)) return;
    saving.current = true;
    setPending(limit);
    setError("");
    try {
      const config: ConfigStatus = await api("/api/config", {
        method: "PATCH",
        body: JSON.stringify({ threads: { [key]: limit } }),
      });
      dispatch({ type: "configStatus", config });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.threads.error"));
    } finally {
      saving.current = false;
      setPending(null);
    }
  };
  return (
    <Card
      collapsible
      scope="installation"
      cardId="general.threads"
      defaultOpen={false}
      title={t("settings.threads.title")}
      subtitle={t("settings.threads.subtitle")}
      summary={t("settings.card.threads", { count: confirmed })}
    >
      <label htmlFor="thread-concurrency" className="block text-[13px] font-medium text-ink">{t("settings.threads.label")}</label>
      <select id="thread-concurrency" value={pending ?? confirmed} disabled={pending !== null}
        aria-describedby="thread-concurrency-help"
        onChange={(event) => void save(Number(event.target.value))}
        className="mt-2 rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink disabled:opacity-50">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((limit) => <option key={limit} value={limit}>{limit}</option>)}
      </select>
      <p id="thread-concurrency-help" className="mt-2 text-[12px] leading-relaxed text-ink-secondary">{t("settings.threads.help")}</p>
      <label htmlFor="busy-send-default" className="mt-4 flex items-center gap-2 text-[13px] font-medium text-ink">
        {t("settings.threads.busySend.label")}
        <ScopeMark scope="me" />
      </label>
      <select id="busy-send-default" value={busySend}
        onChange={(event) => writeBusySendPreference(parseBusySendPreference(event.target.value))}
        className="mt-2 rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink">
        <option value="ask">{t("settings.threads.busySend.ask")}</option>
        <option value="steer">{t("composer.busy.choice.steer")}</option>
        <option value="parallel">{t("composer.busy.choice.parallel")}</option>
        <option value="after">{t("composer.busy.choice.after")}</option>
      </select>
      <p className="mt-2 text-[12px] leading-relaxed text-ink-secondary">{t("settings.threads.busySend.help")}</p>
      <label htmlFor="parallel-limit" className="mt-4 block text-[13px] font-medium text-ink">{t("settings.threads.parallel.label")}</label>
      <select id="parallel-limit" value={parallelLimit} disabled={pending !== null}
        onChange={(event) => void save(Number(event.target.value), "maxParallelPerPerson")}
        className="mt-2 rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink disabled:opacity-50">
        {Array.from({ length: MAX_PARALLEL_PER_PERSON }, (_, i) => i + 1).map((limit) => <option key={limit} value={limit}>{limit}</option>)}
      </select>
      <p className="mt-2 text-[12px] leading-relaxed text-ink-secondary">{t("settings.threads.parallel.help")}</p>
      {pending !== null && <p role="status" className="mt-2 text-[12px] text-ink-secondary">{t("settings.threads.saving")}</p>}
      {error && <p role="alert" className="mt-2 text-[12px] text-danger">{error}</p>}
    </Card>
  );
}
