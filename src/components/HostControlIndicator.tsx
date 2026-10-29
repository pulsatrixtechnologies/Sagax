// While a bot controls this computer's own screen, mouse and keyboard, a
// banner across the top of Sagax says which bot, with a Stop button
// (2026-10-28, shared/host-control.ts). The list comes from
// GET /api/computer/host-control (the turn holding the computer:host seat);
// Stop is the ordinary task stop (POST /api/bots/:id/interrupt), the one the
// chat's Stop uses. Web work happens out of sight by default
// (HOST_SCREEN_RULE, server/surface.ts), so this shows only when a bot was
// asked to work on the screen, or truly needed it.
import { useEffect, useState } from "react";
import { t } from "@/lib/i18n";
import { stopWorkingBot, type WorkingBot } from "@/lib/computer-working-bots";
import { api } from "@/state/store";

const POLL_MS = 2_000;
const HIDDEN_POLL_MS = 10_000;

export function loadHostControl(signal?: AbortSignal): Promise<WorkingBot[]> {
  return api<{ bots: WorkingBot[] }>("/api/computer/host-control", signal ? { signal } : {})
    .then((body) => body.bots ?? []);
}

/** The banner's text: each bot by name, never an id. */
export function hostControlText(bots: ReadonlyArray<Pick<WorkingBot, "name">>): string {
  return bots.map((bot) => t("hostControl.indicator", { bot: bot.name })).join(" · ");
}

export function HostControlIndicator({ load = loadHostControl, stop = stopWorkingBot }: {
  load?: (signal?: AbortSignal) => Promise<WorkingBot[]>;
  stop?: (bot: WorkingBot) => Promise<void>;
} = {}) {
  const [bots, setBots] = useState<WorkingBot[]>([]);
  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const poll = async () => {
      const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
      if (!hidden) {
        try {
          const next = await load(controller.signal);
          if (live) setBots(next);
        } catch (error) {
          // Not this viewer's computer (a member), or a server that never
          // drives its own screen (an organization server, an older build):
          // no more polling.
          const status = (error as { status?: number })?.status;
          if (live && (status === 403 || status === 404)) { setBots([]); return; }
        }
      }
      if (live) timer = setTimeout(() => void poll(), hidden ? HIDDEN_POLL_MS : POLL_MS);
    };
    void poll();
    return () => { live = false; controller.abort(); if (timer) clearTimeout(timer); };
  }, [load]);

  if (!bots.length) return null;
  const stopAll = async () => {
    if (stopping) return;
    setStopping(true);
    try {
      await Promise.allSettled(bots.map((bot) => stop(bot)));
      setBots([]);
    } finally { setStopping(false); }
  };
  return (
    <div role="status" data-host-control-indicator="" className="flex shrink-0 items-center justify-center gap-3 bg-danger px-3 py-1.5 text-[12px] font-medium text-white">
      <span className="min-w-0 truncate">{hostControlText(bots)}</span>
      <button
        type="button"
        onClick={() => void stopAll()}
        disabled={stopping}
        aria-label={t("hostControl.stopAria", { bot: bots.map((bot) => bot.name).join(", ") })}
        className="shrink-0 rounded-full bg-white px-3 py-0.5 text-[12px] font-semibold text-danger hover:opacity-90 disabled:opacity-60"
      >
        {t("hostControl.stop")}
      </button>
    </div>
  );
}
