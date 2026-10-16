import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { taskHiddenFromSidebar } from "@/lib/bot-unread";
import type { Bot, Task } from "@/state/store";

/** At most this many unread threads sit under a bot's row (Grok Bot: 3). */
export const SIDEBAR_UNREAD_THREAD_LIMIT = 3;

/** The threads listed under a bot's row, as Grok Bot does it: only the
 * unread ones a person can open, newest first, at most three, never the one
 * on screen. Every other thread is reached from the chat header's thread
 * button; the sidebar no longer unfolds a bot's whole thread list
 * (JC, 2026-10-15). */
export function sidebarUnreadThreads(bot: Pick<Bot, "id" | "tasks">, openThreadId: string | null): Task[] {
  return (bot.tasks ?? [])
    .filter((task) => task.unread && task.threadId !== openThreadId && !task.archivedAt && !taskHiddenFromSidebar(task, bot.id))
    .sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt))
    .slice(0, SIDEBAR_UNREAD_THREAD_LIMIT);
}

/** The disclosure that sits over the bot's avatar while the pointer is on
 * it (the avatar fades out under it), and the nested unread rows: 32px
 * tall, 2px apart, indented past the 36px avatar and its 8px gap, the name
 * then the blue unread dot. Open by default. */
export function SidebarUnreadThreads({ bot, threads, onOpen, children }: {
  bot: Pick<Bot, "id" | "name">;
  threads: Task[];
  onOpen: (threadId: string) => void;
  /** The bot's row, drawn under the disclosure. */
  children: React.ReactNode;
}) {
  const [folded, setFolded] = useState(false);
  if (threads.length === 0) return <>{children}</>;
  return (
    <div className="flex min-w-0 flex-col" data-sidebar-unread-threads={bot.id}>
      <div className="group/threads relative flex min-w-0 flex-col">
        {children}
        <button
          type="button"
          data-sidebar-threads-toggle={bot.id}
          aria-expanded={!folded}
          aria-label={t("sidebar.threadsFor", { name: bot.name })}
          title={t("sidebar.threadsFor", { name: bot.name })}
          onClick={() => setFolded((value) => !value)}
          className="absolute inset-y-0 left-2 my-auto flex size-9 items-center justify-center rounded-full text-sidebar-ink-secondary opacity-0 outline-none hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <ChevronRight aria-hidden="true" size={16} className={cn("transition-transform", !folded && "rotate-90")} />
        </button>
      </div>
      {!folded && (
        <div role="list" className="flex flex-col gap-0.5 pt-0.5">
          {threads.map((task) => (
            <button
              key={task.threadId}
              type="button"
              role="listitem"
              data-sidebar-unread-thread={task.threadId}
              aria-label={t("sidebar.openUnreadThread", { name: task.title || t("task.newShort") })}
              onClick={() => onOpen(task.threadId)}
              className="ml-11 flex h-8 w-[calc(100%-44px)] min-w-0 items-center gap-2 rounded-[10px] px-2 text-left text-sidebar-ink outline-none hover:bg-sidebar-hover focus-visible:ring-1 focus-visible:ring-accent/60"
            >
              <span className="min-w-0 grow truncate text-[14px] leading-5">{task.title || t("task.newShort")}</span>
              <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-unread" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
