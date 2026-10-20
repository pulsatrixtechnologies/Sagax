/** A thread another bot opened on this one (pair, work or an agent ask): a
 * bot-to-bot conversation, never shown to the person (JC's rule): not in the
 * sidebar, typing dots, unread counts or notifications. A bot's own thread
 * (opened by itself, e.g. its incidents thread) is not one. */
export function isInterBotThread(ownerBotId: string | undefined, task: { openedBy?: { botId?: string } }): boolean {
  const opener = task.openedBy?.botId;
  return Boolean(opener) && opener !== ownerBotId;
}

/** A conversation the person never sees in the sidebar: a routine's
 * detached execution, an AI client's hidden conversation (#291), or, with
 * the owning bot's id, a bot-to-bot thread. */
export function taskHiddenFromSidebar(task: { routineRunId?: string; hidden?: true; openedBy?: { botId?: string } }, ownerBotId?: string): boolean {
  return Boolean(task.routineRunId) || task.hidden === true || (ownerBotId !== undefined && isInterBotThread(ownerBotId, task));
}

/** Sidebar dot, dock badge, and notifying pose.
 * A hidden routine execution is not a conversation, so it never counts, and
 * neither does an AI client's hidden conversation.
 * An archived thread's reply never counts: it stays put away.
 * Bots saved before task lists still use their own unread flag. */
export function botShowsUnread(bot: {
  id?: string;
  unread?: boolean;
  tasks?: ReadonlyArray<{ unread?: boolean; routineRunId?: string; hidden?: true; openedBy?: { botId?: string }; archivedAt?: number }> | null;
}): boolean {
  if (!bot.tasks?.length) return Boolean(bot.unread);
  return bot.tasks.some((task) => Boolean(task.unread) && task.archivedAt === undefined && !taskHiddenFromSidebar(task, bot.id ?? ""));
}
