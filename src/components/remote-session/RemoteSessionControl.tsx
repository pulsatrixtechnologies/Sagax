import { useEffect, useState } from "react";

import { t } from "@/lib/i18n";
import { useFocusedRemoteSession } from "@/lib/remote-session-focus";
import { controlSupportedOs } from "@/lib/remote-control-os";
import { RemoteControlSurface } from "./RemoteControlSurface";
import { RemoteSessionActions } from "./RemoteSessionActions";
import { RemoteSessionFacts } from "./RemoteSessionFacts";
import { useRemoteControl } from "./use-remote-control";
import { useRemoteSessions } from "./use-remote-sessions";

/** The Computer tab picture. A failed fetch says the screen is unavailable.
 * This is the view-only picture kept from stage 1; live control is the layer
 * added over it in RemoteSessionControl, not a separate tab. */
export function RemoteSessionScreen({ shot, missed }: { shot: string | null; missed: boolean }) {
  return (
    <div data-remote-session-screen="" data-remote-input="none">
      <div className="px-3 py-2 text-[12px] text-ink-secondary">{t("remoteSession.screen")}</div>
      {shot
        // the picture keeps its own proportions: no fixed box, so no band under it
        ? <img data-remote-session-shot="" src={shot} alt="" className="block h-auto w-full" />
        : (
          <div className="flex aspect-[16/10] items-center justify-center bg-inset">
            <span className="text-[12px] text-ink-secondary">{missed ? t("remoteSession.screenUnavailable") : t("remoteSession.screen")}</span>
          </div>
        )}
    </div>
  );
}

/** Poll the read-only screenshot every few seconds. Used while control is not
 * active (or on a computer where live control is not available). */
function useScreenPoll(botId: string, sessionId: string | undefined, enabled: boolean) {
  const [shot, setShot] = useState<string | null>(null);
  const [missed, setMissed] = useState(false);
  useEffect(() => {
    if (!sessionId || !enabled) return;
    let stop = false;
    let current: string | null = null;
    const tick = async () => {
      try {
        const res = await fetch(`/api/bots/${encodeURIComponent(botId)}/remote-sessions/${encodeURIComponent(sessionId)}/screen`);
        if (stop) return;
        if (!res.ok) { setMissed(true); return; }
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
    return () => { stop = true; clearInterval(timer); if (current) URL.revokeObjectURL(current); };
  }, [botId, sessionId, enabled]);
  return { shot, missed };
}

/** The Computer tab for the session in focus: the screen with a live-control
 * layer over it (Windows), the hardware facts, and the shell/file actions. */
export function RemoteSessionControl({ botId, showEmpty = false }: { botId: string; showEmpty?: boolean }) {
  const { rows } = useRemoteSessions(botId);
  const focusedId = useFocusedRemoteSession(botId);
  const session = rows.find((row) => row.id === focusedId) ?? rows.find((row) => row.focused) ?? rows[rows.length - 1] ?? null;
  const controllable = session ? controlSupportedOs(session.os) : false;
  const control = useRemoteControl(botId, session?.id);
  const active = control.phase === "active";
  // The read-only poll runs only while control is not driving the picture.
  const { shot, missed } = useScreenPoll(botId, session?.id, !active);

  if (!session) {
    return showEmpty
      ? <p data-remote-session-control-empty="" className="py-6 text-center text-[12.5px] text-ink-secondary">{t("remoteSession.empty")}</p>
      : null;
  }
  return (
    <div data-remote-session-control="" className="mb-4 overflow-hidden rounded-xl border border-hairline">
      <RemoteControlSurface
        controllable={controllable}
        active={active}
        connecting={control.phase === "connecting"}
        frameUrl={active ? control.frameUrl : shot}
        aspect={control.aspect}
        error={control.error}
        missed={missed}
        onToggle={controllable ? control.toggle : undefined}
        surfaceRef={control.surfaceRef}
        onPointerMove={control.onPointerMove}
        onPointerDown={control.onPointerDown}
        onPointerUp={control.onPointerUp}
        onContextMenu={control.onContextMenu}
        onWheel={control.onWheel}
      />
      <RemoteSessionFacts view={session} />
      <RemoteSessionActions botId={botId} view={session} />
    </div>
  );
}
