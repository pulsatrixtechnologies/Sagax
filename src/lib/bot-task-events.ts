// The window event the store fires when the server says a bot's task list
// changed (frame `bot.tasks`, ids only). Its own module so the store and
// the Tasks section do not import each other.
export const BOT_TASKS_EVENT = "sagax-bot-tasks";

export interface BotTasksEventDetail {
  botId: string;
}
