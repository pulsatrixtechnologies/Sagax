// Background tasks: the parallel tasks of this conversation (shared/parallel-tasks.ts),
// the same ones its cards show: the work the bot sends to the background so
// the conversation stays free (#1491). Each row says where it stands and how
// long it has run, offers Stop while it is not done, Open (its own thread)
// and, once it reported back, its result in this conversation. The count is
// how many have finished.
import { useEffect, useState } from "react";
import { ChevronRight, ListChecks, Square } from "lucide-react";
import { liveParallelState, type ParallelTaskState } from "../../../../shared/parallel-tasks";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { useShowThreads } from "@/lib/thread-preferences";
import { formatElapsed } from "@/lib/working-time";
import { openThread } from "@/state/store";
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
  /** Its answer in this conversation, once it reported back. */
  resultMessageId?: string;
}

const FINISHED: ReadonlySet<TaskState> = new Set(["done", "failed", "stopped"]);

/** The parallel tasks of this one conversation, running first. A task of
 * another conversation is not here. */
export function backgroundTasks(ctx: Pick<DevPodContext, "bot" | "task"> & Partial<Pick<DevPodContext, "messages">>, now: number): BackgroundTask[] {
  const threadId = ctx.task?.threadId ?? ctx.bot.threadId;
  return (ctx.bot.tasks ?? []).flatMap((task) => {
    const link = task.parallelOf;
    if (!link || link.threadId !== threadId) return [];
    const state = liveParallelState(link.outcome, { busy: task.busy, activity: task.activity }, false);
    const live = state === "running" || state === "waiting" || state === "queued";
    const started = task.turnStartedAt ?? link.at;
    const ended = link.reportedAt;
    const elapsed = live ? now - started : ended !== undefined ? ended - started : undefined;
    const result = ctx.messages?.find((message) => message.parallelTask?.role === "result" && message.parallelTask.threadId === task.threadId);
    return [{ threadId: task.threadId, title: task.title, state, ...(elapsed !== undefined && elapsed > 0 ? { elapsed } : {}), live, ...(result ? { resultMessageId: result.id } : {}) }];
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

const STATE_DOT: Record<TaskState, string> = {
  queued: "bg-ink-tertiary",
  running: "animate-pulse bg-accent",
  waiting: "bg-warning",
  done: "bg-success",
  failed: "bg-danger",
  stopped: "bg-ink-tertiary",
};
const ROW_ACTION = "flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[12px] text-ink-secondary hover:bg-hover hover:text-ink";

function TasksBody({ data, ctx }: { data: BackgroundTask[]; ctx: DevPodContext }) {
  const showThreads = useShowThreads();
  const finished = finishedCount(data);
  return (
    <div className="flex flex-col gap-1">
      <ul className="flex flex-col gap-1">
        {data.map((task) => (
          <li key={task.threadId} data-task={task.threadId} data-task-state={task.state} className="flex flex-col gap-0.5 py-0.5">
            <div className="flex min-h-[24px] items-center gap-2">
              <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", STATE_DOT[task.state])} />
              <span className="min-w-0 flex-1 break-words text-ink [overflow-wrap:anywhere]">{task.title}</span>
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
            </div>
            <div className="flex flex-wrap items-center gap-x-1 pl-3.5">
              <span data-task-status="" className="mr-auto text-[12px] tabular-nums text-ink-secondary">
                {t(STATE_KEY[task.state])}
                {task.elapsed !== undefined ? ` · ${formatElapsed(task.elapsed)}` : ""}
              </span>
              {task.resultMessageId && (
                <button
                  type="button"
                  data-task-result={task.threadId}
                  onClick={() => ctx.dispatch({ type: "focusMessage", threadId: ctx.bot.threadId, messageId: task.resultMessageId! })}
                  className={ROW_ACTION}
                >
                  {t("devPods.tasks.result")}
                </button>
              )}
              <button
                type="button"
                data-task-open={task.threadId}
                onClick={() => openThread(ctx.dispatch, { botId: ctx.bot.id, threadId: task.threadId }, { bots: [ctx.bot], groups: [], selectedId: ctx.bot.id }, showThreads)}
                className={ROW_ACTION}
              >
                {t("chat.parallel.open")}
                <ChevronRight size={12} aria-hidden="true" />
              </button>
            </div>
          </li>
        ))}
      </ul>
      {finished > 0 && (
        <p data-tasks-finished="" className="text-[12px] text-ink-secondary">{t("devPods.tasks.finished", { count: String(finished) })}</p>
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
