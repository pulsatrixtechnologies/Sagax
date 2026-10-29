import { useId } from "react";
import { t } from "@/lib/i18n";
import { HelpTip } from "./EditorSection";
import { useShowThreads } from "@/lib/thread-preferences";
import type { Bot } from "@/state/store";

/** A destination is just an existing conversation, not another execution mode.
 * One conversation (threads hidden, #1207): the bot's main thread is the only
 * conversation the person sees, so it is the only choice offered. */
export function ResultsDestination({ bot, value, allowCurrent = false, onChange, compact = false }: {
  bot?: Bot;
  value: string | null | undefined;
  allowCurrent?: boolean;
  onChange: (threadId: string | null | undefined) => void;
  /** 2026-10-29: one row (label, value) with the help one click away. */
  compact?: boolean;
}) {
  const id = useId();
  const showThreads = useShowThreads();
  const tasks = (bot?.tasks ?? []).filter((task) => !task.routineRunId);
  const selectedMissing = typeof value === "string" && !tasks.some((task) => task.threadId === value);
  const groups = [...(bot?.projects ?? []), { id: "", name: t("folder.none") }];
  const help = t(showThreads ? "routines.results.mainHelp" : "routines.results.mainHelpOne");
  return <div data-results-destination className={compact ? "flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5" : "min-w-0 space-y-1.5"}>
    <span className={compact ? "flex w-48 shrink-0 items-center gap-1" : undefined}>
      <label htmlFor={id} className="block text-[12px] font-medium text-ink">{t("routines.results.label")}</label>
      {compact && <HelpTip id={`${id}-help`} text={help} />}
    </span>
    <select id={id} aria-describedby={`${id}-help`} disabled={!bot} value={value ?? (value === null ? "new" : "current")}
      onChange={(event) => onChange(event.target.value === "new" ? null : event.target.value === "current" ? undefined : event.target.value)}
      className={compact ? "min-w-0 flex-1 rounded-lg border border-hairline/50 bg-inset px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-accent disabled:opacity-50" : "w-full min-w-0 rounded-lg border border-hairline/50 bg-inset px-3 py-2 text-[12.5px] text-ink outline-none focus:border-accent disabled:opacity-50"}>
      {allowCurrent && <option value="current">{t("routines.results.keep")}</option>}
      <option value="new">{t("routines.results.main")}</option>
      {showThreads && selectedMissing && <option value={value!} disabled>{t("routines.results.unavailable")}</option>}
      {showThreads && groups.map((group) => {
        const members = tasks.filter((task) => group.id ? task.projectId === group.id : !bot?.projects?.some((project) => project.id === task.projectId));
        return members.length ? <optgroup key={group.id} label={group.name}>
          {members.map((task) => <option key={task.threadId} value={task.threadId}>{task.title}</option>)}
        </optgroup> : null;
      })}
    </select>
    {!compact && <p id={`${id}-help`} className="text-[11px] leading-relaxed text-ink-secondary">{help}</p>}
  </div>;
}
