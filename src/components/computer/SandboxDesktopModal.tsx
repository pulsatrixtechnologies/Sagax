// "Take control" of the server environment desktop opens it here, large
// (92vw by 88vh, the remote screen scaled to fit and letterboxed), while the
// Computer tab's square stays view-only. The header names the environment,
// shows its state, releases or takes control again, carries Play / Pause /
// Stop and a full screen toggle, and closes. Closing releases control: the
// control view's WebSocket ends, so the server lets the bots' clicks through
// again and tells the bot, as before (server/sandbox-control.ts).
//
// Keys go to the VNC canvas while it has focus. Cmd/Ctrl+Shift+Escape always
// closes; a plain Escape closes only when focus is not in the remote screen
// (src/lib/sandbox-desktop.ts takeoverKey).
//
// The bot's browser takes control in this same window (BrowserPanel): its
// live browser in place of the VNC screen, without Play / Pause / Stop.
// Opening moves keyboard focus into the window; closing gives it back.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Eye, Hand, Maximize2, Minimize2, Pause, Play, Square, X } from "lucide-react";

import { cn } from "@/lib/cn";
import type { ScreenState } from "@/lib/desktop-local-vm";
import { t } from "@/lib/i18n";
import { takeoverKey } from "@/lib/sandbox-desktop";
import { SandboxDesktopView } from "../SandboxDesktopView";
import { screenStateLabel, type ScreenControls } from "./ComputerScreen";

export function SandboxDesktopModal({ title, state, controls, busy = false, onClose, onConnected, screen: content, kind = "sandbox" }: {
  /** "<Bot>'s screen": the environment the bot works in. */
  title: string;
  state: ScreenState;
  /** Play / Pause / Stop in the header; none for the browser. */
  controls?: ScreenControls;
  busy?: boolean;
  /** Also releases control (the view unmounts). */
  onClose: () => void;
  onConnected?: () => void;
  /** The live screen, given whether the person has control (the server
   * environment's VNC desktop by default). */
  screen?: (control: boolean) => ReactNode;
  kind?: "sandbox" | "browser";
}) {
  const [control, setControl] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    // Capture phase on window: before the VNC canvas and before the panels
    // behind this window (their own Escape must not fire too).
    const capture = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const inScreen = event.target instanceof Node && Boolean(screen.current?.contains(event.target));
      if (takeoverKey(event, inScreen) !== "close") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      close.current();
    };
    const screenChange = () => setFullscreen(document.fullscreenElement === panel.current && panel.current !== null);
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.focus({ preventScroll: true });
    window.addEventListener("keydown", capture, true);
    document.addEventListener("fullscreenchange", screenChange);
    return () => {
      window.removeEventListener("keydown", capture, true);
      document.removeEventListener("fullscreenchange", screenChange);
      if (document.fullscreenElement && document.fullscreenElement === panel.current) void document.exitFullscreen().catch(() => {});
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void panel.current?.requestFullscreen().catch(() => {});
  };

  const body = (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px]" data-sandbox-takeover data-takeover-kind={kind}>
      <div ref={panel} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}
        className={cn("flex flex-col overflow-hidden bg-card shadow-2xl outline-none", fullscreen ? "h-full w-full" : "h-[88vh] w-[92vw] rounded-2xl border border-hairline")}>
        <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{title}</span>
          <span data-power={state} className="flex items-center gap-1.5 rounded-full bg-control px-2 py-0.5 text-[11px] text-ink-secondary">
            <span aria-hidden="true" className={cn("size-1.5 rounded-full", state === "running" ? "bg-accent" : state === "paused" || state === "starting" ? "bg-accent/50" : state === "error" ? "bg-danger" : "bg-ink-secondary/50")} />
            {screenStateLabel(state)}
            <span aria-hidden="true">·</span>
            {control ? <Hand size={11} aria-hidden="true" /> : <Eye size={11} aria-hidden="true" />}
            {t(control ? "sandboxDesktop.controlling" : "sandboxDesktop.watching")}
          </span>
          <button type="button" onClick={() => setControl((value) => !value)} data-takeover-control={control ? "release" : "take"}
            title={control ? t("sandboxDesktop.controlHint") : undefined}
            className={cn("flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium",
              control ? "bg-accent text-accent-ink hover:brightness-110" : "bg-control text-ink hover:bg-raised-hover")}>
            <Hand size={12} aria-hidden="true" />
            {t(control ? "sandboxDesktop.releaseControl" : "sandboxDesktop.takeControl")}
          </button>
          {controls && <div role="group" aria-label={t("computerScreen.controls")} className="flex items-center gap-0.5 rounded-full bg-control p-0.5">
            <HeaderButton icon={Play} label={state === "paused" ? t("computerScreen.resume") : t("computerScreen.play")}
              onClick={state === "paused" ? controls.resume : controls.play} busy={busy} />
            <HeaderButton icon={Pause} label={t("computerScreen.pause")} onClick={controls.pause} busy={busy} />
            <HeaderButton icon={Square} label={t("computerScreen.stop")} onClick={controls.stop} busy={busy} />
          </div>}
          <HeaderButton icon={fullscreen ? Minimize2 : Maximize2} label={t(fullscreen ? "sandboxDesktop.exitFullscreen" : "sandboxDesktop.fullscreen")}
            onClick={toggleFullscreen} busy={false} />
          <HeaderButton icon={X} label={t("sandboxDesktop.closeWindow")} onClick={onClose} busy={false} data-takeover-close />
        </div>
        <div ref={screen} className={cn("relative min-h-0 flex-1", kind === "browser" ? "flex flex-col bg-card p-2" : "bg-black")}>
          {content ? content(control) : <SandboxDesktopView embedded control={control} onConnected={onConnected} />}
        </div>
      </div>
    </div>
  );
  return typeof document === "undefined" ? body : createPortal(body, document.body);
}

function HeaderButton({ icon: Icon, label, onClick, busy, ...rest }: {
  icon: typeof Play; label: string; onClick: (() => void) | undefined; busy: boolean; "data-takeover-close"?: boolean;
}) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} disabled={!onClick || busy} {...rest}
      className="flex size-8 items-center justify-center rounded-full text-ink hover:bg-raised-hover disabled:opacity-35 disabled:hover:bg-transparent">
      <Icon size={14} aria-hidden="true" fill={Icon === Square ? "currentColor" : "none"} />
    </button>
  );
}
