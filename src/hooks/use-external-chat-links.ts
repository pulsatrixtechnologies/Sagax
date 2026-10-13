// Chat links opened from outside the app (#2383): openmausbot://thread/… and
// openmausbot://bot/…, handed over by the desktop shell. Subscribed from the
// always-mounted shell, not a view: the sidebar is not mounted on every page,
// and a link must work from any of them.
import { useEffect, useState } from "react";
import { openChatLink } from "@/components/ThreadRefs";
import { useShowThreads } from "@/lib/thread-preferences";
import type { Action, AppState } from "@/state/store";

export function useExternalChatLinks(state: AppState, dispatch: (action: Action) => void): void {
  const [link, setLink] = useState<string | null>(null);
  const showThreads = useShowThreads();
  useEffect(() => window.ogb?.onChatLink?.(setLink), []);
  // One that arrives at launch waits until the bots have loaded, so it can
  // find its chat; a newer link replaces one still waiting.
  useEffect(() => {
    if (!link || !state.hydrated) return;
    setLink(null);
    // Settings and the shortcuts list are modals over the chat: the link's
    // chat, or its notice, would open behind them. Closing them loses
    // nothing; a backdrop click does it. Dialogs that hold unsaved input
    // (New Bot, a trigger draft) stay open.
    if (state.appSettingsOpen) dispatch({ type: "toggleAppSettings", open: false });
    if (state.shortcutsOpen) dispatch({ type: "toggleShortcuts", open: false });
    openChatLink(dispatch, link, state, showThreads);
  }, [link, state, showThreads, dispatch]);
}
