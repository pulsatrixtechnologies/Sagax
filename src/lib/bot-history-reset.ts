// "Reset the history" of a bot (2026-10-21, parity with Grok Bot): the
// conversation starts again from nothing while the bot keeps its memory,
// files, routines, skills and settings. Nothing is deleted: a new
// conversation opens, then every open conversation of the person with that
// bot goes to the archive, where it can still be read or brought back.
// Routine runs and confidential conversations are left as they are.
import type { Bot } from "@/state/store";

/** The open conversations a reset archives. Pure. */
export function historyResetThreads(bot: Pick<Bot, "tasks" | "threadId">): string[] {
  const tasks = bot.tasks ?? [{ threadId: bot.threadId }];
  return tasks
    .filter((task) => !("routineRunId" in task && task.routineRunId) && !("confidential" in task && task.confidential) && !("archivedAt" in task && task.archivedAt !== undefined))
    .map((task) => task.threadId);
}
