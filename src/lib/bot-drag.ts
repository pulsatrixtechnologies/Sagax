/** The drag payload that schedules a bot: a bot row of the left sidebar
 * carries it, and a time slot of the Automations calendar accepts it (a new
 * routine for that bot at that time, the same dialog as a click). The value
 * is the bot id. The legacy name stays so older drags keep working. */
export const BOT_CALENDAR_DRAG_TYPE = "application/x-openmaus-bot";

/** Adds the scheduling payload to a drag that already started (the sidebar
 * keeps its own section-filing payload beside it), so both drop targets
 * accept the same gesture. */
export function addBotCalendarDrag(dataTransfer: Pick<DataTransfer, "setData" | "effectAllowed">, botId: string): void {
  dataTransfer.setData(BOT_CALENDAR_DRAG_TYPE, botId);
  // Filing into a section moves; dropping on the calendar copies.
  dataTransfer.effectAllowed = "copyMove";
}
