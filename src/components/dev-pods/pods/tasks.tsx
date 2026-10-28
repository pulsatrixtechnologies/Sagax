// Background tasks: the parallel tasks of this conversation (shared/parallel-tasks.ts),
// the same ones its cards show. Each row says how long it has run and offers
// Stop while it is not done. The count is how many have finished.
import { useEffect, useState } from "react";
import { ListChecks, Square } from "lucide-react";
import { liveParallelState, type ParallelTaskState } from "../../../../shared/parallel-tasks";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { formatElapsed } from "@/lib/working-time";
import { registerDevPod, type DevPodContext } from "../registry";

type TaskState = ParallelTaskState | "waiting";

export interface BackgroundTask {
  threadId: string;
  title: string;
  state: TaskState;
  /** How long it has run, in milliseconds, when a start is known. */
  elapsed?: number;
  /** Still going: it can be stopped. */
  live: boolean;
}

const FINISHED: ReadonlySet<TaskState> = new Set(["done", "failed", "stopped"]);

/** The parallel tasks of this one conversation, running first. A task of
 * another conversation is not here. */
export function backgroundTasks(ctx: Pick<DevPodContext, "bot" | "task">, now: number): BackgroundTask[] {
  const threadId = ctx.task?.threadId ?? ctx.bot.threadId;
  return (ctx.bot.tasks ?? []).flatMap((task) => {
    const link = task.parallelOf;
    if (!link || link.threadId !== threadId) return [];
    const state = liveParallelState(link.outcome, { busy: task.busy, activity: task.activity }, false);
    const live = state === "running" || state === "waiting" || state === "queued";
    const started = task.turnStartedAt ?? link.at;
    const ended = link.reportedAt;
    const elapsed = live ? now - started : ended !== undefined ? ended - started : undefined;
    return [{ threadId: task.threadId, title: task.title, state, ...(elapsed !== undefined && elapsed > 0 ? { elapsed } : {}), live }];
  }).sort((a, b) => Number(b.live) - Number(a.live));
}

export function finishedCount(tasks: readonly BackgroundTask[]): number {
  return tasks.filter((task) => FINISHED.has(task.state)).length;
}

const STATE_KEY: Record<TaskState, LocaleKey> = {
  queued: "devPods.tasks.state.queued",
  running: "devPods.tasks.state.running",
  waiting: "devPods.tasks.state.waiting",
  done: "devPods.tasks.state.done",
  failed: "devPods.tasks.state.failed",
  stopped: "devPods.tasks.state.stopped",
};

function TasksBody({ data, ctx }: { data: BackgroundTask[]; ctx: DevPodContext }) {
  const finished = finishedCount(data);
  return (
    <div className="flex flex-col gap-0.5">
      <ul className="flex flex-col">
        {data.map((task) => (
          <li key={task.threadId} data-task={task.threadId} data-task-state={task.state} className="flex min-h-[32px] items-center gap-2 py-0.5">
            <span className="min-w-0 flex-1 truncate text-ink" title={task.title}>{task.title}</span>
            <span className="shrink-0 text-[12px] text-ink-secondary">
              {t(STATE_KEY[task.state])}
              {task.elapsed !== undefined ? ` · ${formatElapsed(task.elapsed)}` : ""}
            </span>
            {task.live && (
              <button
                type="button"
                data-task-stop={task.threadId}
                onClick={() => ctx.dispatch({ type: "stopParallelTask", botId: ctx.bot.id, threadId: task.threadId })}
                title={t("chat.parallel.stop")}
                aria-label={t("chat.parallel.stop")}
                className="flex size-6 shrink-0 items-center justify-center rounded-md text-ink-secondary hover:bg-hover hover:text-ink"
              >
                <Square size={11} className="fill-current" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {finished > 0 && (
        <p data-tasks-finished="" className="px-0.5 text-[12px] text-ink-secondary">{t("devPods.tasks.finished", { count: String(finished) })}</p>
      )}
    </div>
  );
}

function useTasks(ctx: DevPodContext) {
  const [now, setNow] = useState(() => Date.now());
  const tasks = backgroundTasks(ctx, now);
  const live = tasks.some((task) => task.live);
  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [live]);
  return tasks.length ? { status: "ready" as const, data: tasks } : { status: "empty" as const };
}

registerDevPod<BackgroundTask[]>({
  id: "tasks",
  order: 60,
  title: () => t("devPods.tasks.title"),
  icon: ListChecks,
  collapsible: true,
  useData: (ctx) => useTasks(ctx),
  Body: TasksBody,
});
