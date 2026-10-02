// Approvals asked by the parallel tasks of the open conversation
// (shared/parallel-tasks.ts). A parallel task runs in its own thread and its
// approval cards live there, but the person is reading the conversation the
// task answers: its pending approvals join that conversation's approval box
// (the stepper), each naming the task it belongs to, and the answer goes to
// the task's own thread.
import { useEffect, useState } from "react";

import { api, type Bot } from "@/state/store";
import { pendingApprovals, type Pending } from "./PendingApproval";

/** The parallel tasks of `threadId` that wait for the person. */
export function waitingParallelTasks(bot: Pick<Bot, "tasks"> | undefined, threadId: string | undefined) {
  if (!bot || !threadId) return [];
  return (bot.tasks ?? []).filter((task) => task.parallelOf?.threadId === threadId
    && task.parallelOf.reportedAt === undefined && task.activity === "waiting-on-you");
}

/** Tag a parallel task's open approvals with that task. */
export function parallelPendings(messages: Parameters<typeof pendingApprovals>[0], task: { threadId: string; title: string }): Pending[] {
  return pendingApprovals(messages).map((pending) => ({ ...pending, threadId: task.threadId, parallelTitle: task.title }));
}

export function useParallelApprovals(bot: Bot | undefined): Pending[] {
  const waiting = waitingParallelTasks(bot, bot?.threadId);
  const key = waiting.map((task) => `${task.threadId}:${task.updatedAt ?? 0}`).join("|");
  const [found, setFound] = useState<{ key: string; pendings: Pending[] }>({ key: "", pendings: [] });
  useEffect(() => {
    if (!key) return;
    let live = true;
    void Promise.all(waiting.map(async (task) => {
      const page = await api(`/api/threads/${task.threadId}/messages?limit=60`) as { messages?: Parameters<typeof pendingApprovals>[0] };
      return parallelPendings(page.messages ?? [], task);
    })).then((lists) => {
      if (live) setFound({ key, pendings: lists.flat() });
    }).catch(() => {});
    return () => {
      live = false;
    };
    // `waiting` is derived from `key`'s inputs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return key && found.key === key ? found.pendings : [];
}
