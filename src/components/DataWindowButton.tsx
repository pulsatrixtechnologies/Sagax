// The chat header's Data button, beside the threads button: opens this bot's
// Data window (experimental, src/lib/data-window.ts). Absent while the
// experimental switch is off and on the companion connection, where Data is
// not served.
import { useEffect, useRef, useState } from "react";
import { Database } from "lucide-react";
import { useStore, type Bot } from "@/state/store";
import { CIRCLE_BUTTON } from "@/lib/circle-button";
import { cn } from "@/lib/cn";
import { dataWindowEnabled } from "@/lib/feature-flags";
import { openDataWindow, subscribeDataWindowMessages } from "@/lib/data-window";
import { t } from "@/lib/i18n";

export function DataWindowButton({ bot }: { bot: Pick<Bot, "id" | "name"> }) {
  const { state } = useStore();
  const [blocked, setBlocked] = useState(false);
  if (!dataWindowEnabled(state.config) || window.ogb?.remoteClient?.active === true) return null;
  const label = blocked ? t("dataWindow.blocked") : t("dataWindow.open");
  return (
    <button
      type="button"
      data-data-window-button=""
      onClick={() => {
        void openDataWindow({ botId: bot.id, title: t("dataWindow.title", { name: bot.name }) }).then((result) => setBlocked(result === "blocked"));
      }}
      aria-label={t("dataWindow.open")}
      title={label}
      className={cn(CIRCLE_BUTTON, "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60")}
    >
      <Database size={18} strokeWidth={1.75} aria-hidden="true" />
    </button>
  );
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
