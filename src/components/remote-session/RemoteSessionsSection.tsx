import { useState } from "react";
import { Monitor } from "lucide-react";

import { formatEndLabel, publicText, type RemoteSessionView } from "../../../shared/remote-session";
import { useAdvancedMode } from "@/lib/interface-mode";
import { t } from "@/lib/i18n";
import { clearRemoteSessionLocal, focusRemoteSessionLocal } from "@/lib/remote-session-focus";
import { useStore, type Bot } from "@/state/store";
import { closeRemoteSession, focusRemoteSession } from "./remote-session-client";
import { useRemoteSessions } from "./use-remote-sessions";

function endLabel(view: RemoteSessionView): string {
  const time = formatEndLabel(view.endAt);
  return time ? `${view.code}, ${t("remoteSession.ends", { time })}` : view.code;
}

/** Sidebar list. Hidden when no session is connected. */
export function RemoteSessionsSection({ bot }: { bot: Bot }) {
  const { dispatch } = useStore();
  const advanced = useAdvancedMode();
  const { rows, reload } = useRemoteSessions(bot.id);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (rows.length === 0) return null;

  const takeControl = (view: RemoteSessionView) => {
    focusRemoteSessionLocal(bot.id, view.id);
    void focusRemoteSession(bot.id, view.id);
    if (advanced) dispatch({ type: "toggleComputer", open: true });
  };

  const close = async (view: RemoteSessionView) => {
    if (confirmId !== view.id) {
      setConfirmId(view.id);
      return;
    }
    setError(null);
    const failed = await closeRemoteSession(bot.id, view.id);
    if (failed) setError(failed);
    else {
      clearRemoteSessionLocal(bot.id, view.id);
      setConfirmId(null);
      reload();
    }
  };

  return (
    <section data-remote-sessions="" className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Monitor size={16} className="text-ink-secondary" />
        <h2 className="min-w-0 flex-1 text-[13px] font-normal leading-[18px] text-ink-secondary">{t("remoteSession.section")}</h2>
      </div>
      <div className="flex flex-col gap-2">
        {rows.map((view) => {
          const name = publicText(view.hostname) || view.code;
          const user = publicText(view.user);
          return (
            <div key={view.id} className="flex items-start gap-2 rounded-xl border border-hairline/50 px-2 py-2">
              <button type="button" onClick={() => takeControl(view)} className="min-w-0 flex-1 rounded-lg px-1 py-0.5 text-left hover:bg-raised" aria-label={t("remoteSession.takeControl")}>
                <span className="block truncate text-[13px] font-medium text-ink">{name}</span>
                {user && <span className="block truncate text-[12px] text-ink-secondary">{user}</span>}
                <span className="block truncate text-[12px] text-ink-secondary">{endLabel(view)}</span>
              </button>
              <button
                type="button"
                aria-label={confirmId === view.id ? t("remoteSession.confirmClose") : t("remoteSession.close")}
                onClick={(event) => { event.stopPropagation(); void close(view); }}
                className="shrink-0 rounded-lg border border-hairline/50 px-2 py-1 text-[12px] text-ink-secondary hover:bg-raised hover:text-ink"
              >
                {confirmId === view.id ? t("remoteSession.confirmClose") : t("remoteSession.close")}
              </button>
            </div>
          );
        })}
      </div>
      {error && <p className="text-[12px] text-danger" role="alert">{error}</p>}
    </section>
  );
}
