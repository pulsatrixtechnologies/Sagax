// A task's facts, folded (2026-10-29): when it started and ended, how
// long, who started it, the bot, the engine and model, whose credentials
// paid, the files it touched. Nothing is dropped from the old facts card;
// the fold's closed line says the two most useful ones and the rest is one
// click away.
import { useState } from "react";
import { ChevronRight, FileText } from "lucide-react";

import { cn } from "@/lib/cn";
import { activeLocale, t } from "@/lib/i18n";
import { GROUP_CARD } from "../SettingsPrimitives";

export interface TaskFact {
  key: string;
  label: string;
  value: string;
}

function formatTime(at: number): string {
  return new Date(at).toLocaleString(activeLocale(), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** The facts in the order the card lists them. */
export function taskFacts({ startedAt, endedAt, duration, startedBy, botName, engine, via, conversation }: {
  startedAt: number;
  endedAt?: number;
  duration: string;
  startedBy?: string;
  botName?: string;
  engine?: string;
  via?: string;
  /** The conversation's own title, when the task's is a later request. */
  conversation?: string;
}): TaskFact[] {
  const facts: TaskFact[] = [{ key: "started", label: t("botPanel.activity.started"), value: formatTime(startedAt) }];
  if (endedAt !== undefined) facts.push({ key: "ended", label: t("botPanel.activity.ended"), value: formatTime(endedAt) });
  facts.push({ key: "duration", label: t("botPanel.activity.duration"), value: duration });
  if (startedBy) facts.push({ key: "startedBy", label: t("botPanel.activity.startedBy"), value: startedBy });
  if (botName) facts.push({ key: "bot", label: t("botPanel.activity.bot"), value: botName });
  if (engine) facts.push({ key: "engine", label: t("botPanel.activity.engine"), value: engine });
  if (via) facts.push({ key: "via", label: t("botPanel.activity.via"), value: via });
  if (conversation) facts.push({ key: "conversation", label: t("activity.view.conversation"), value: conversation });
  return facts;
}

export function TaskFacts({ facts, files = [], defaultOpen = false, className }: {
  facts: readonly TaskFact[];
  files?: readonly string[];
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const closedLine = facts.filter((fact) => fact.key === "startedBy" || fact.key === "engine").map((fact) => fact.value).join(" · ")
    || facts.find((fact) => fact.key === "started")?.value || "";
  return (
    <section data-task-facts={open ? "open" : "closed"} className={cn("flex flex-col", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="task-facts-panel"
        onClick={() => setOpen((value) => !value)}
        className="flex min-w-0 items-center gap-1.5 rounded-md px-1 py-1 text-left text-[12.5px] text-ink-secondary hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        <ChevronRight size={13} aria-hidden="true" className={cn("shrink-0 transition-transform duration-150 motion-reduce:transition-none", open && "rotate-90")} />
        <span className="shrink-0 font-medium">{t("task.sheet.details")}</span>
        {!open && closedLine && <span className="min-w-0 truncate text-ink-tertiary">· {closedLine}</span>}
      </button>
      {open && (
        <div id="task-facts-panel" className="mt-1.5 flex flex-col gap-3">
          <dl className={GROUP_CARD}>
            {facts.map((fact) => (
              <div key={fact.key} data-task-fact={fact.key} className="flex min-h-[32px] min-w-0 items-center justify-between gap-3 px-3.5 py-1">
                <dt className="shrink-0 text-[12.5px] text-ink">{fact.label}</dt>
                <dd className="min-w-0 truncate text-right text-[12.5px] text-ink-secondary" title={fact.value}>{fact.value}</dd>
              </div>
            ))}
          </dl>
          {files.length > 0 && (
            <div>
              <h4 className="mb-1 px-1 text-[12px] text-ink-secondary">{t("botPanel.activity.files")}</h4>
              <ul className="flex flex-col gap-0.5">
                {files.map((file) => (
                  <li key={file} className="flex min-w-0 items-center gap-2 px-1 text-[12px] text-ink">
                    <FileText size={12} aria-hidden="true" className="shrink-0 text-ink-secondary" />
                    <span className="min-w-0 truncate font-mono" title={file}>{file}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
