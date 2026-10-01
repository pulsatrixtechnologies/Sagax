// A floating bot's desktop window (electron/floating-bot-window.mjs): a dumb
// renderer. The main app page decides the pose and the balloon and sends a
// snapshot; this page draws it, moves its own window when dragged, sizes the
// window to what is drawn, lets clicks fall through wherever it is
// transparent (the 3D owl's own pixels take the pointer, not its empty
// corners), lets the mascot fly the window off and back while its bot works,
// and reports every click and typed message back. It holds no session and
// calls no API.
import { Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { OwlAvatar } from "@/components/OwlAvatar";
import { FloatingBotView, MASCOT_SIZE, type FloatingMover } from "./FloatingBotView";
import { createWindowPilot } from "./pilot";
import { isFloatingSnapshot, mascotFields, type FloatingEvent, type FloatingSnapshot, type FloatingWindowBridge } from "./protocol";

/** With nothing to draw this long, the window shows the plain owl rather than nothing. */
export const BLANK_FALLBACK_MS = 2000;

/**
 * The plain owl, standing where the mascot would: never an empty, invisible
 * window. It still takes the pointer over itself (the window lets clicks
 * through everywhere else), can be dragged, and opens the app on a click.
 */
function PlainOwl({ color, rootRef, bridge }: { color: string; rootRef: React.Ref<HTMLDivElement>; bridge?: FloatingWindowBridge }) {
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  return (
    <div ref={rootRef} className="fb-root fb-window" data-fallback="">
      <div className="fb-stage" style={{ width: MASCOT_SIZE.width, height: MASCOT_SIZE.height, display: "grid", placeItems: "center" }}>
        <button
          type="button"
          className="fb-art"
          style={{ width: 120, height: 120 }}
          aria-label="Sagax"
          onPointerEnter={() => bridge?.setInteractive(true)}
          onPointerLeave={() => {
            if (!drag.current) bridge?.setInteractive(false);
          }}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture?.(event.pointerId);
            drag.current = { x: event.screenX, y: event.screenY, moved: false };
            bridge?.setInteractive(true);
          }}
          onPointerMove={(event) => {
            const start = drag.current;
            if (!start) return;
            const dx = event.screenX - start.x;
            const dy = event.screenY - start.y;
            if (!start.moved && Math.hypot(dx, dy) < 4) return;
            start.moved = true;
            start.x = event.screenX;
            start.y = event.screenY;
            void bridge?.moveBy(dx, dy);
          }}
          onPointerUp={() => {
            const start = drag.current;
            drag.current = null;
            if (start?.moved) bridge?.moved();
            else bridge?.send({ type: "open" });
          }}
        >
          <OwlAvatar color={color} size={120} state="idle" trackPointer={false} label={null} />
        </button>
      </div>
    </div>
  );
}

/** A drawing error must not leave the window empty: report it (main logs it) and show the plain owl. */
class Fallback extends Component<{ color: string; rootRef: React.Ref<HTMLDivElement>; bridge?: FloatingWindowBridge; onFail: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`floating mascot failed to draw: ${error?.message ?? error}`, info.componentStack);
    this.props.onFail();
  }
  render() {
    return this.state.failed ? <PlainOwl color={this.props.color} rootRef={this.props.rootRef} bridge={this.props.bridge} /> : this.props.children;
  }
}

export function FloatingBotWindow({ bridge = typeof window === "undefined" ? undefined : window.floatingBotWindow }: { bridge?: FloatingWindowBridge }) {
  const [snapshot, setSnapshot] = useState<FloatingSnapshot | null>(null);
  const [blank, setBlank] = useState(false);
  const [failed, setFailed] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  // still nothing to draw after a moment (no snapshot came): show the plain owl meanwhile
  useEffect(() => {
    if (snapshot) return;
    const later = setTimeout(() => {
      console.error("floating mascot: no state from the app yet; showing the plain owl");
      setBlank(true);
    }, BLANK_FALLBACK_MS);
    return () => clearTimeout(later);
  }, [snapshot]);

  useEffect(() => {
    document.documentElement.dataset.floatingBot = "";
    return () => {
      delete document.documentElement.dataset.floatingBot;
    };
  }, []);

  useEffect(() => {
    if (!bridge) return;
    const off = bridge.onState((value) => {
      if (isFloatingSnapshot(value)) setSnapshot({ ...value, ...mascotFields(value) });
      // main's log shows it (console errors of this page are forwarded)
      else console.error(`floating mascot: refused a state with keys ${value && typeof value === "object" ? Object.keys(value).join(",") : typeof value}`);
    });
    bridge.ready();
    return off;
  }, [bridge]);

  // Size the window to what is drawn: the balloon and menu grow it upward.
  useLayoutEffect(() => {
    const node = root.current;
    if (!node || !bridge || typeof ResizeObserver === "undefined") return;
    const report = () => void bridge.resize(Math.ceil(node.scrollWidth), Math.ceil(node.scrollHeight));
    const observer = new ResizeObserver(report);
    observer.observe(node);
    report();
    return () => observer.disconnect();
  }, [bridge, snapshot === null, blank, failed]);

  const onEvent = useCallback((event: FloatingEvent) => bridge?.send(event), [bridge]);
  const interactive = useCallback((on: boolean) => bridge?.setInteractive(on), [bridge]);
  const wantsKeyboard = useCallback((on: boolean) => bridge?.setFocusable(on), [bridge]);
  const mover = useMemo<FloatingMover>(
    () => ({
      coords: "screen",
      moveBy: (dx, dy) => void bridge?.moveBy(dx, dy),
      moved: () => bridge?.moved(),
    }),
    [bridge],
  );
  // the mascot flies its own window off while its bot works, and back
  const pilot = useMemo(() => createWindowPilot(bridge), [bridge]);

  if (!snapshot) return blank ? <PlainOwl color="green" rootRef={root} bridge={bridge} /> : <div ref={root} className="fb-root fb-window" />;
  return (
    <Fallback color={snapshot.color} rootRef={root} bridge={bridge} onFail={() => setFailed(true)}>
    <FloatingBotView
      rootRef={root}
      className="fb-window"
      snapshot={snapshot}
      onEvent={onEvent}
      mover={mover}
      interactive={interactive}
      wantsKeyboard={wantsKeyboard}
      pilot={pilot}
    />
    </Fallback>
  );
}

export default FloatingBotWindow;
