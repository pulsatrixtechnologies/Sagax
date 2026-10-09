import type { Bot, BotAnnouncement, Group } from "@/state/store";

type FolderBot = Pick<Bot, "id" | "threadId" | "unread" | "tasks">;
/** A conversation with a person files its threads the same way. */
type FolderGroup = Pick<Group, "id" | "threadId" | "unread" | "tasks">;

export function folderUnreadThreadIds(bot: FolderBot | FolderGroup, projectId: string): string[] {
  return ((bot.tasks ?? []) as Array<{ threadId: string; projectId?: string; unread?: boolean }>)
    .filter((task) => task.projectId === projectId && (task.unread ?? (task.threadId === bot.threadId && bot.unread)))
    .map((task) => task.threadId);
}

/** Reading changes only unread state; never navigate to, answer, or dismiss a
 * conversation. Keep each confirmed response in order, including partial success. */
export async function markFolderRead(
  bot: FolderBot,
  projectId: string,
  request: (path: string, init?: RequestInit) => Promise<{ bot: BotAnnouncement }>,
  onRead: (bot: BotAnnouncement) => void,
): Promise<void> {
  for (const threadId of folderUnreadThreadIds(bot, projectId)) {
    const result = await request(`/api/bots/${bot.id}/read`, {
      method: "POST",
      body: JSON.stringify({ threadId }),
    });
    onRead(result.bot);
  }
}

/** The same for a conversation with a person: each unread thread of the
 * folder is read for this person only (server/people-dms.ts). */
export async function markGroupFolderRead(
  group: FolderGroup,
  projectId: string,
  request: (path: string, init?: RequestInit) => Promise<{ group?: Partial<Group> & { id: string } }>,
  onRead: (group: Partial<Group> & { id: string }) => void,
): Promise<void> {
  for (const threadId of folderUnreadThreadIds(group, projectId)) {
    const result = await request(`/api/groups/${group.id}/read`, {
      method: "POST",
      body: JSON.stringify({ threadId }),
    });
    if (result.group) onRead(result.group);
  }
}
