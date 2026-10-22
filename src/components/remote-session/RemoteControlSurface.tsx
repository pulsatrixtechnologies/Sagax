import type { PointerEvent as ReactPointerEvent, Ref, WheelEvent as ReactWheelEvent } from "react";
import { MousePointerClick, Radio } from "lucide-react";

import { t } from "@/lib/i18n";

/** The Computer-tab control surface: a live frame of the remote screen with a
 * toggle that takes or gives back control. Presentational, so a headless
 * render (and the gallery) can show every state from props. While control is
 * active the screen carries data-remote-input="control" and a visible badge;
 * otherwise it is view-only, exactly the stage-1 read-only picture. */
export function RemoteControlSurface(props: {
  /** Windows session: the toggle is shown. Otherwise the screen is view-only. */
  controllable: boolean;
  active: boolean;
  connecting: boolean;
  /** A frame to show: the live JPEG while controlling, else the polled shot. */
  frameUrl: string | null;
  aspect?: number;
  error: string | null;
  missed: boolean;
  onToggle?: () => void;
  surfaceRef?: Ref<HTMLDivElement>;
  onPointerMove?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onContextMenu?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onWheel?: (event: ReactWheelEvent<HTMLDivElement>) => void;
}) {
  const mode = props.active ? "control" : "none";
  return (
    <div data-remote-control-surface="" data-remote-input={mode}>
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-secondary">
          {props.active ? <Radio size={13} className="text-danger" /> : null}
          {props.active ? t("remoteControl.active") : t("remoteSession.screen")}
        </span>
        {props.controllable && props.onToggle && (
          <button
            type="button"
            data-remote-control-toggle=""
            data-control-active={props.active ? "" : undefined}
            aria-pressed={props.active}
            onClick={props.onToggle}
            className="inline-flex items-center gap-1.5 rounded-lg border border-hairline/50 bg-panel px-2.5 py-1 text-[12px] text-ink hover:bg-raised"
          >
            <MousePointerClick size={13} />
            {props.connecting ? t("remoteControl.connecting") : props.active ? t("remoteControl.release") : t("remoteSession.takeControl")}
          </button>
        )}
      </div>
      <div
        ref={props.surfaceRef}
        data-remote-control-viewport=""
        // While controlling the surface takes keyboard focus and swallows
        // the browser's own gestures so keys and clicks reach the host.
        tabIndex={props.active ? 0 : -1}
        style={props.active ? { touchAction: "none", cursor: "none", outline: "none" } : undefined}
        onPointerMove={props.active ? props.onPointerMove : undefined}
        onPointerDown={props.active ? props.onPointerDown : undefined}
        onPointerUp={props.active ? props.onPointerUp : undefined}
        onContextMenu={props.active ? props.onContextMenu : undefined}
        onWheel={props.active ? props.onWheel : undefined}
      >
        {props.frameUrl
          ? <img data-remote-session-shot="" src={props.frameUrl} alt="" className="block h-auto w-full select-none" draggable={false} />
          : (
            <div className="flex items-center justify-center bg-inset" style={{ aspectRatio: String(props.aspect ?? 16 / 10) }}>
              <span className="text-[12px] text-ink-secondary">{props.missed ? t("remoteSession.screenUnavailable") : t("remoteSession.screen")}</span>
            </div>
          )}
      </div>
      {props.active && <p className="px-3 py-1.5 text-[11.5px] text-ink-secondary">{t("remoteControl.hint")}</p>}
      {!props.controllable && <p data-remote-control-viewonly="" className="px-3 py-1.5 text-[11.5px] text-ink-secondary">{t("remoteControl.viewOnlyOs")}</p>}
      {props.error && <p className="px-3 py-1.5 text-[12px] text-danger" role="alert">{props.error}</p>}
    </div>
  );
}
