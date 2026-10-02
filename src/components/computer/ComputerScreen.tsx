// The bot's screen on an organization server, drawn like the solo panel: one
// large rounded screen with the live view when the computer runs (or a
// monitor icon and its state when it does not), Play / Pause / Stop on the
// screen itself, and "<Bot>'s screen" below. The two computers it can show
// (ServerComputerScreen, LocalComputerScreen) only feed it a state.
import type { ReactNode } from "react";
import { AlertTriangle, Loader2, Monitor, Pause, Play, Square } from "lucide-react";

import { cn } from "@/lib/cn";
import type { ScreenState } from "@/lib/desktop-local-vm";
import { t } from "@/lib/i18n";

export interface ScreenControls {
  play?: (() => void) | undefined;
  pause?: (() => void) | undefined;
  resume?: (() => void) | undefined;
  stop?: (() => void) | undefined;
}

export interface ScreenAction { label: string; onClick: () => void; primary?: boolean }

export function screenStateLabel(state: ScreenState): string {
  return t(`computerScreen.state.${state}`);
}

export function ComputerScreen({
  state, caption, live, message, actions = [], controls, busy = false, error, source,
}: {
  state: ScreenState;
  caption: string;
  /** The live view, shown while running or paused. */
  live?: ReactNode;
  /** What the screen says when nothing is live (never raw output). */
  message?: string | undefined;
  actions?: ScreenAction[];
  controls: ScreenControls;
  busy?: boolean;
  error?: string | undefined;
  source: "server" | "local";
}) {
  const showLive = Boolean(live) && (state === "running" || state === "paused");
  const Icon = state === "starting" ? Loader2 : state === "error" ? AlertTriangle : Monitor;
  return (
    <figure className="m-0 flex flex-col gap-1.5" data-computer-screen={state} data-computer-source={source}>
      <div className="group relative flex aspect-[16/10] w-full items-center justify-center overflow-hidden rounded-2xl border border-hairline bg-card">
        {showLive ? live : (
          <div className="flex max-w-[85%] flex-col items-center gap-2 text-center text-ink-secondary">
            <Icon size={28} aria-hidden="true" className={cn(state === "starting" && "animate-spin", state === "error" && "text-warning")} />
            <span className="text-[13px] font-medium text-ink">{screenStateLabel(state)}</span>
            {message && <p role="status" className="text-[12px] leading-relaxed">{message}</p>}
            {actions.length > 0 && (
              <div className="mt-1 flex flex-wrap justify-center gap-2">
                {actions.map((action) => (
                  <button key={action.label} type="button" onClick={action.onClick} disabled={busy} className={cn(
                    "min-h-[44px] rounded-lg px-3 py-1.5 text-[12px] disabled:opacity-50 md:min-h-0",
                    action.primary ? "bg-accent font-medium text-accent-ink hover:brightness-110" : "bg-control text-ink hover:bg-raised-hover",
                  )}>{action.label}</button>
                ))}
              </div>
            )}
          </div>
        )}
        <span data-power={state} className={cn(
          "pointer-events-none absolute left-2 top-2 flex items-center gap-1.5 rounded-full bg-black/55 px-2 py-0.5 text-[11px] text-white",
        )}>
          <span aria-hidden="true" className={cn("size-1.5 rounded-full", state === "running" ? "bg-success" : state === "paused" || state === "starting" ? "bg-warning" : state === "error" ? "bg-danger" : "bg-white/50")} />
          {screenStateLabel(state)}
        </span>
        <div role="group" aria-label={t("computerScreen.controls")} className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/60 p-1 shadow-sm">
          <ScreenButton icon={Play} label={state === "paused" ? t("computerScreen.resume") : t("computerScreen.play")}
            onClick={state === "paused" ? controls.resume : controls.play} busy={busy} />
          <ScreenButton icon={Pause} label={t("computerScreen.pause")} onClick={controls.pause} busy={busy} />
          <ScreenButton icon={Square} label={t("computerScreen.stop")} onClick={controls.stop} busy={busy} />
        </div>
      </div>
      {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
      <figcaption className="text-center text-[13px] text-ink-secondary">{caption}</figcaption>
    </figure>
  );
}

function ScreenButton({ icon: Icon, label, onClick, busy }: { icon: typeof Play; label: string; onClick: (() => void) | undefined; busy: boolean }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} disabled={!onClick || busy}
      className="flex size-9 items-center justify-center rounded-full text-white hover:bg-white/20 disabled:opacity-35 disabled:hover:bg-transparent md:size-8">
      <Icon size={15} aria-hidden="true" fill={Icon === Square ? "currentColor" : "none"} />
    </button>
  );
}
