// The bot's task list in its panel. The rows are the server's. An empty
// list stays empty. This is not the code work journal below it.
import { useEffect, useState } from "react";

import { t } from "@/lib/i18n";
import { api } from "@/state/store";
import { canReopenBotTask, type BotTask, type BotTaskState } from "../../../shared/bot-task-list";

const LABEL: Record<BotTaskState, "botTasks.doing" | "botTasks.waiting" | "botTasks.done"> = {
  doing: "botTasks.doing",
  waiting: "botTasks.waiting",
  done: "botTasks.done",
};

export function BotTaskSection({ botId }: { botId: string }) {
  const [tasks, setTasks] = useState<BotTask[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setTasks(null);
    setFailed(false);
    api<{ tasks: BotTask[] }>(`/api/bots/${encodeURIComponent(botId)}/task-list`)
      .then((body) => { if (live) setTasks(body.tasks); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [botId]);
  const reopen = (id: string) => {
    void api(`/api/bots/${encodeURIComponent(botId)}/task-list/${encodeURIComponent(id)}/reopen`, { method: "POST", body: "{}" })
      .then(() => api<{ tasks: BotTask[] }>(`/api/bots/${encodeURIComponent(botId)}/task-list`))
      .then((body) => setTasks(body.tasks))
      .catch(() => setFailed(true));
  };
  return (
    <section data-bot-settings-section="task-list" className="flex flex-col gap-2">
      <h3 className="text-[13px] font-medium text-ink">{t("botTasks.title")}</h3>
      <p className="text-[12px] text-ink-secondary">{t("botTasks.hint")}</p>
      {failed ? <p className="text-[12px] text-danger">{t("botTasks.error")}</p> : null}
      {tasks && tasks.length === 0 ? <p className="text-[12px] text-ink-tertiary">{t("botTasks.empty")}</p> : null}
      {tasks && tasks.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {tasks.map((task) => (
            <li key={task.id} data-bot-task={task.state} className="flex items-center gap-2 text-[12.5px]">
              <span className="min-w-0 flex-1 truncate text-ink">{task.title}</span>
              <span className="text-ink-secondary">{t(LABEL[task.state])}</span>
              {canReopenBotTask(task.state) ? (
                <button type="button" onClick={() => reopen(task.id)} className="text-accent hover:underline">{t("botTasks.reopen")}</button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
