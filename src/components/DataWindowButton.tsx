// The bot's Data window entry (experimental, src/lib/data-window.ts): an
// item of the conversation's "..." menu (ExportTranscriptMenu), beside the
// Inspector. Absent while the experimental switch is off and on the
// companion connection, where Data is not served.
import { useEffect, useRef } from "react";
import { useStore, type Bot } from "@/state/store";
import { dataWindowEnabled } from "@/lib/feature-flags";
import { openDataWindow, subscribeDataWindowMessages } from "@/lib/data-window";
import { t } from "@/lib/i18n";

/** The "Open the Data window" item for this bot, or null where Data is off.
 * A blocked pop-up says so in the chat's error banner (the menu is gone by
 * then). */
export function useDataWindowItem(bot: Pick<Bot, "id" | "name">): { label: string; onOpen: () => void } | null {
  const { state, dispatch } = useStore();
  if (!dataWindowEnabled(state.config) || window.ogb?.remoteClient?.active === true) return null;
  return {
    label: t("dataWindow.open"),
    onOpen: () => {
      void openDataWindow({ botId: bot.id, title: t("dataWindow.title", { name: bot.name }) }).then((result) => {
        if (result === "blocked") dispatch({ type: "error", message: t("dataWindow.blocked") });
      });
    },
  };
}

/** The main page's side of the Data window: the result in view there is
 * kept here, so the composer sends it with the next message to that bot
 * (shared/data-context.ts). A window that goes clears only its own bot's. */
export function DataWindowViewSync() {
  const { state, dispatch } = useStore();
  const current = useRef(state.dataView);
  current.current = state.dataView;
  useEffect(() => subscribeDataWindowMessages((message) => {
    if (message.type !== "view") return;
    if (message.view) dispatch({ type: "dataView", view: message.view });
    else if (current.current?.botId === message.botId) dispatch({ type: "dataView", view: null });
  }), [dispatch]);
  return null;
}
