import { useEffect, useState } from "react";

import { t } from "@/lib/i18n";
import { useFocusedRemoteSession } from "@/lib/remote-session-focus";
import { RemoteSessionActions } from "./RemoteSessionActions";
import { RemoteSessionFacts } from "./RemoteSessionFacts";
import { useRemoteSessions } from "./use-remote-sessions";

/** The Computer tab picture. A failed fetch says the screen is unavailable.
 * Read-only for now (`data-remote-input="none"`): live mouse and keyboard
 * control will be a layer over this picture, added here, not a new tab. */
export function RemoteSessionScreen({ shot, missed }: { shot: string | null; missed: boolean }) {
  return (
    <div data-remote-session-screen="" data-remote-input="none">
      <div className="px-3 py-2 text-[12px] text-ink-secondary">{t("remoteSession.screen")}</div>
      <div className="flex aspect-[16/10] items-center justify-center bg-inset">
        {shot
          ? <img src={shot} alt="" className="h-full w-full object-contain" />
          : <span className="text-[12px] text-ink-secondary">{missed ? t("remoteSession.screenUnavailable") : t("remoteSession.screen")}</span>}
      </div>
    </div>
  );
}

/** The Computer tab while a remote session is the one in focus. Read-only screen. */
export function RemoteSessionControl({ botId, showEmpty = false }: { botId: string; showEmpty?: boolean }) {
  const { rows } = useRemoteSessions(botId);
  const focusedId = useFocusedRemoteSession(botId);
  const session = rows.find((row) => row.id === focusedId) ?? rows.find((row) => row.focused) ?? rows[rows.length - 1] ?? null;
  const [shot, setShot] = useState<string | null>(null);
  const [missed, setMissed] = useState(false);

  useEffect(() => {
    if (!session) return;
    let stop = false;
    let current: string | null = null;
    const tick = async () => {
      try {
        const res = await fetch(`/api/bots/${encodeURIComponent(botId)}/remote-sessions/${encodeURIComponent(session.id)}/screen`);
        if (stop) return;
        if (!res.ok) {
          setMissed(true);
          return;
        }
        const blob = await res.blob();
        if (stop) return;
        const next = URL.createObjectURL(blob);
        if (current) URL.revokeObjectURL(current);
        current = next;
        setShot(next);
        setMissed(false);
      } catch {
        if (!stop) setMissed(true);
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 4000);
    return () => {
      stop = true;
      clearInterval(timer);
      if (current) URL.revokeObjectURL(current);
    };
  }, [botId, session?.id]);

  if (!session) {
    return showEmpty
      ? <p data-remote-session-control-empty="" className="py-6 text-center text-[12.5px] text-ink-secondary">{t("remoteSession.empty")}</p>
      : null;
  }
  return (
    <div data-remote-session-control="" className="mb-4 overflow-hidden rounded-xl border border-hairline">
      <RemoteSessionScreen shot={shot} missed={missed} />
      <RemoteSessionFacts view={session} />
      <RemoteSessionActions botId={botId} view={session} />
    </div>
  );
}
