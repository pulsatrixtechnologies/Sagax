import { useState } from "react";
import { Monitor } from "lucide-react";

import { formatEndLabel, publicText, type RemoteSessionView } from "../../../shared/remote-session";
import { cn } from "@/lib/cn";
import { GROUPED_CARD, GROUPED_ROW } from "@/lib/grouped-card";
import { t } from "@/lib/i18n";
import { clearRemoteSessionLocal, focusRemoteSessionLocal, startRemoteControl } from "@/lib/remote-session-focus";
import { useStore, type Bot } from "@/state/store";
import { closeRemoteSession, focusRemoteSession } from "./remote-session-client";
import { useRemoteSessions } from "./use-remote-sessions";

function endLabel(view: RemoteSessionView): string {
  const time = formatEndLabel(view.endAt);
  return time ? `${view.code}, ${t("remoteSession.ends", { time })}` : view.code;
}

/** First click asks. The next click on the same row closes. */
export function remoteClosePhase(confirmId: string | null, id: string): "ask" | "commit" {
  return confirmId === id ? "commit" : "ask";
}

/** Close stays on its own button: it never focuses the Computer tab. */
export async function runRemoteSessionClose(input: {
  confirmId: string | null;
  viewId: string;
  close: () => Promise<string | null>;
  onAsk: () => void;
  onClosed: () => void;
  onError: (message: string) => void;
}): Promise<void> {
  if (remoteClosePhase(input.confirmId, input.viewId) === "ask") {
    input.onAsk();
    return;
  }
  const failed = await input.close();
  if (failed) input.onError(failed);
  else input.onClosed();
}

/** Focus this session and open the Computer tab, in Simple as in Advanced.
 * The tab shows the read-only screen for now; live mouse and keyboard
 * control is a later addition to that same tab (RemoteSessionControl). */
export function beginRemoteControl(input: {
  botId: string;
  sessionId: string;
  focusLocal: (botId: string, sessionId: string) => void;
  focusRemote: (botId: string, sessionId: string) => void;
  openComputer: () => void;
}): void {
  input.focusLocal(input.botId, input.sessionId);
  void input.focusRemote(input.botId, input.sessionId);
  input.openComputer();
}

/** The Prendre le contrôle wiring every surface shares (panel row, chat card). */
export function takeRemoteControl(botId: string, sessionId: string, openComputerTab: () => void): void {
  beginRemoteControl({
    botId,
    sessionId,
    focusLocal: focusRemoteSessionLocal,
    focusRemote: focusRemoteSession,
    openComputer: () => {
      // before the tab opens, so Simple does not close it again
      startRemoteControl(botId);
      openComputerTab();
    },
  });
}

/** The sidebar list. Always there: an empty list says so in one line. */
export function RemoteSessionsPanel({
  rows,
  confirmId,
  error,
  onTakeControl,
  onClose,
}: {
  rows: RemoteSessionView[];
  confirmId: string | null;
  error: string | null;
  onTakeControl: (view: RemoteSessionView) => void;
  onClose: (view: RemoteSessionView) => void;
}) {
  return (
    <section data-remote-sessions="" data-remote-sessions-count={rows.length} className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Monitor size={16} className="text-ink-secondary" />
        <h2 className="min-w-0 flex-1 text-[13px] font-normal leading-[18px] text-ink-secondary">{t("remoteSession.section")}</h2>
      </div>
      {rows.length === 0 && (
        <p data-remote-sessions-empty="" className="text-[13px] leading-[18px] text-ink-secondary">{t("remoteSession.empty")}</p>
      )}
      {rows.length > 0 && (
        <div className={GROUPED_CARD}>
          {rows.map((view) => {
            const name = publicText(view.hostname) || view.code;
            const user = publicText(view.user);
            const confirming = confirmId === view.id;
            return (
              <div key={view.id} data-remote-session-row="" className={cn("flex flex-col gap-2", GROUPED_ROW)}>
                <div className="min-w-0">
                  <span className="block truncate text-[13px] font-medium leading-[18px] text-ink">{name}</span>
                  {user && <span className="block truncate text-[13px] leading-[18px] text-ink-secondary">{user}</span>}
                  <span className="block text-[13px] leading-[18px] text-ink-secondary">{endLabel(view)}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    data-remote-take-control=""
                    onClick={() => onTakeControl(view)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-hairline/50 bg-panel px-2.5 py-1 text-[12.5px] text-ink hover:bg-raised"
                  >
                    <Monitor size={14} aria-hidden="true" /> {t("remoteSession.takeControl")}
                  </button>
                  <button
                    type="button"
                    data-remote-close={confirming ? "confirm" : "ask"}
                    aria-label={confirming ? t("remoteSession.confirmClose") : t("remoteSession.close")}
                    onClick={(event) => { event.stopPropagation(); onClose(view); }}
                    className={confirming
                      ? "rounded-lg border border-danger/60 px-2.5 py-1 text-[12.5px] text-danger hover:bg-raised"
                      : "rounded-lg border border-hairline/50 px-2.5 py-1 text-[12.5px] text-ink-secondary hover:bg-raised hover:text-ink"}
                  >
                    {confirming ? t("remoteSession.confirmClose") : t("remoteSession.close")}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {error && <p className="text-[12px] text-danger" role="alert">{error}</p>}
    </section>
  );
}

/** Sidebar list of the bot's connected sessions, with an empty state. */
export function RemoteSessionsSection({ bot }: { bot: Bot }) {
  const { dispatch } = useStore();
  const { rows, reload } = useRemoteSessions(bot.id);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const takeControl = (view: RemoteSessionView) => {
    takeRemoteControl(bot.id, view.id, () => dispatch({ type: "toggleComputer", open: true }));
  };

  const close = (view: RemoteSessionView) => {
    void runRemoteSessionClose({
      confirmId,
      viewId: view.id,
      close: () => closeRemoteSession(bot.id, view.id),
      onAsk: () => setConfirmId(view.id),
      onClosed: () => {
        clearRemoteSessionLocal(bot.id, view.id);
        setConfirmId(null);
        reload();
      },
      onError: (message) => {
        setError(message);
      },
    });
  };

  return (
    <RemoteSessionsPanel
      rows={rows}
      confirmId={confirmId}
      error={error}
      onTakeControl={takeControl}
      onClose={close}
    />
  );
}
