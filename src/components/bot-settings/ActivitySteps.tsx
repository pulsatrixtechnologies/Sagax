// The Steps list of an activity entry: each tool call by a plain name, where
// it ran, its short summary, and its raw id and arguments under Technical
// details. A sub-agent's step (Claude's Agent tool) opens to show what it
// was asked, the calls it made (live while it runs) and what it reported.
import { useState } from "react";
import { Bot, ChevronDown, ChevronRight, Laptop, Server } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { activityWhereLabel, type BotActivityStep } from "@/lib/bot-activity";
import { humanStepName, isSubagentStep, stepTree } from "@/lib/activity-steps";

function Dot({ ok }: { ok?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "absolute -left-[17px] top-[11px] size-2 rounded-full",
        ok === undefined ? "bg-accent animate-pulse" : ok ? "bg-success" : "bg-danger",
      )}
    />
  );
}

function Technical({ step }: { step: BotActivityStep }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-0.5">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex items-center gap-0.5 text-[11px] text-ink-tertiary hover:text-ink-secondary"
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        {t("activity.step.technical")}
      </button>
      {open && (
        <div data-activity-technical={step.id} className="mt-1 rounded-md bg-inset px-2 py-1.5">
          <div className="break-all font-mono text-[11px] text-ink">{step.name}</div>
          {step.input && <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-ink-secondary">{step.input}</pre>}
        </div>
      )}
    </div>
  );
}

function StepRow({ step, substeps }: { step: BotActivityStep; substeps?: BotActivityStep[] }) {
  const subagent = isSubagentStep(step);
  const [open, setOpen] = useState(false);
  return (
    <li data-activity-step={step.name} data-activity-step-id={step.id} className="relative py-1">
      <Dot ok={step.ok} />
      <div className="flex min-w-0 items-center gap-2">
        {subagent ? (
          <button
            type="button"
            data-activity-subagent={step.id}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          >
            {open ? <ChevronDown size={13} className="shrink-0 text-ink-secondary" /> : <ChevronRight size={13} className="shrink-0 text-ink-secondary" />}
            <Bot size={13} aria-hidden="true" className="shrink-0 text-accent-text" />
            <span className="min-w-0 truncate text-[12.5px] font-medium text-ink">{humanStepName(step)}</span>
            {substeps?.length ? <span className="shrink-0 text-[11px] text-ink-secondary">· {substeps.length}</span> : null}
          </button>
        ) : (
          <span data-activity-step-name className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{humanStepName(step)}</span>
        )}
        {step.where && (
          <span data-activity-where={step.where} className="flex shrink-0 items-center gap-1 rounded-md bg-inset px-1.5 py-0.5 text-[11px] text-ink-secondary">
            {step.where === "computer" ? <Laptop size={11} aria-hidden="true" /> : <Server size={11} aria-hidden="true" />}
            {activityWhereLabel(step.where)}
          </span>
        )}
      </div>
      {step.summary && <p className="mt-0.5 line-clamp-2 break-words text-[11.5px] leading-snug text-ink-secondary">{step.summary}</p>}
      {subagent && open && (
        <div data-activity-subagent-body={step.id} className="mt-1.5 rounded-lg border border-hairline-weak bg-card px-3 py-2">
          {step.subagent?.prompt && (
            <>
              <h4 className="text-[11.5px] font-medium text-ink-secondary">{t("activity.subagent.prompt")}</h4>
              <p className="mt-0.5 max-h-32 overflow-auto whitespace-pre-wrap break-words text-[12px] text-ink">{step.subagent.prompt}</p>
            </>
          )}
          {substeps && substeps.length > 0 && (
            <>
              <h4 className="mt-2 text-[11.5px] font-medium text-ink-secondary">{t("activity.subagent.steps")}</h4>
              <ol className="relative mt-1 flex flex-col gap-0.5 border-l border-hairline-weak pl-3">
                {substeps.map((child) => <StepRow key={child.id} step={child} />)}
              </ol>
            </>
          )}
          <h4 className="mt-2 text-[11.5px] font-medium text-ink-secondary">{t("activity.subagent.result")}</h4>
          {step.subagent?.result
            ? <p data-activity-subagent-result className="mt-0.5 max-h-40 overflow-auto whitespace-pre-wrap break-words text-[12px] text-ink">{step.subagent.result}</p>
            : <p className="mt-0.5 text-[12px] text-ink-secondary">{step.ok === undefined ? t("activity.subagent.running") : "-"}</p>}
          {step.ok === undefined && <p className="mt-2 text-[11px] leading-snug text-ink-tertiary">{t("activity.subagent.engineNote")}</p>}
          <Technical step={step} />
        </div>
      )}
      {!subagent && <Technical step={step} />}
    </li>
  );
}

export function ActivitySteps({ steps, truncated }: { steps: readonly BotActivityStep[]; truncated: boolean }) {
  const { top, children } = stepTree(steps);
  return (
    <ol data-activity-steps className="relative flex flex-col gap-0.5 border-l border-hairline-weak pl-3">
      {truncated && <li className="pb-1 text-[11.5px] text-ink-secondary">{t("botPanel.activity.stepsOlder")}</li>}
      {top.map((step) => <StepRow key={step.id} step={step} substeps={children.get(step.id)} />)}
    </ol>
  );
}
