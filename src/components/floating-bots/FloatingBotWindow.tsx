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
import type { BalloonSide } from "./Balloon";
import { isFloatingSnapshot, mascotFields, type FloatingEvent, type FloatingSnapshot, type FloatingWindowBridge } from "./protocol";
import { applyFloatingTheme, cleanTheme } from "./theme";
import { createMoveCoalescer, nextWindowSize, type Size } from "./window-frame";

/**
 * Linux cannot let clicks through a window's transparent part (main keeps it
 * clickable), so there the window never reserves room it does not draw in.
 */
const RESERVES_ROOM = typeof navigator === "undefined" || !/Linux/.test(navigator.userAgent) || /Android/.test(navigator.userAgent);

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
  const anchor = useRef<{ x: "left" | "right"; y: "top" | "bottom" }>({ x: "right", y: "bottom" });
  const onSide = useCallback((side: BalloonSide) => {
    anchor.current = { x: side.right ? "left" : "right", y: side.below ? "top" : "bottom" };
  }, []);

  // no state yet: keep asking every second (main replays it, or asks the app for it)
  useEffect(() => {
    if (snapshot || !bridge) return;
    const again = setInterval(() => bridge.ready(), 1000);
    return () => clearInterval(again);
  }, [bridge, snapshot]);

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
      if (isFloatingSnapshot(value)) {
        // the app's theme first, so the balloon never draws a frame in the old one
        applyFloatingTheme(cleanTheme(value.theme));
        setSnapshot({ ...value, ...mascotFields(value) });
      }
      // main's log shows it (console errors of this page are forwarded)
      else console.error(`floating mascot: refused a state with keys ${value && typeof value === "object" ? Object.keys(value).join(",") : typeof value}`);
    });
    bridge.ready();
    return off;
  }, [bridge]);

  // Size the window to what is drawn: the balloon and menu grow it upward.
  // While the balloon is open the window holds the room it may take and only
  // grows (window-frame.ts): a streaming reply, a resize or a move of the
  // balloon then happen inside it, with no window resize per frame. Reports
  // are coalesced to one per frame, and never sent while the mascot is dragged.
  const frame = useRef({ size: null as Size | null, reserve: null as Size | null, exact: false, scheduled: false, dragging: false, report: () => undefined as void });
  useLayoutEffect(() => {
    const node = root.current;
    if (!node || !bridge || typeof ResizeObserver === "undefined") return;
    const state = frame.current;
    const send = () => {
      state.scheduled = false;
      if (state.dragging) return;
      const content = { width: Math.ceil(node.scrollWidth), height: Math.ceil(node.scrollHeight) };
      const exact = state.exact || !state.reserve;
      state.exact = false;
      const next = nextWindowSize({ content, current: state.size, reserve: state.reserve, exact });
      if (!next) return;
      state.size = next;
      // the window keeps the mascot's corner in place: bottom-right, or the corner the balloon opened away from
      void bridge.resize(next.width, next.height, anchor.current).then((placed) => {
        const bounds = placed as Partial<Size> | null;
        // main may clamp it to the screen: remember what the window really is
        if (bounds && typeof bounds.width === "number" && typeof bounds.height === "number") state.size = { width: bounds.width, height: bounds.height };
      }, () => undefined);
    };
    state.report = () => {
      if (state.scheduled) return;
      state.scheduled = true;
      requestAnimationFrame(send);
    };
    const observer = new ResizeObserver(() => state.report());
    observer.observe(node);
    // the first size goes at once: the window must not show a frame of the wrong size
    send();
    return () => {
      observer.disconnect();
      state.report = () => undefined;
    };
  }, [bridge, snapshot === null, blank, failed]);
  /** The room the open balloon may take (null once closed); `exact` fits the window to it now. */
  const onReserve = useCallback((reserve: Size | null, exact: boolean) => {
    const state = frame.current;
    state.reserve = RESERVES_ROOM ? reserve : null;
    if (exact || !reserve) state.exact = true;
    state.report();
  }, []);

  const onEvent = useCallback((event: FloatingEvent) => bridge?.send(event), [bridge]);
  const pointer = useRef<boolean | null>(null);
  const interactive = useCallback((on: boolean) => {
    if (pointer.current === on) return;
    pointer.current = on;
    bridge?.setInteractive(on);
  }, [bridge]);
  // the window only hears of a change: hovering in and out of the art and the balloon asks many times
  const keyboard = useRef<boolean | null>(null);
  const wantsKeyboard = useCallback((on: boolean) => {
    // "on" goes again on every press (the window may have lost the focus meanwhile); main skips what changes nothing
    if (!on && keyboard.current === false) return;
    keyboard.current = on;
    bridge?.setFocusable(on);
  }, [bridge]);
  // a drag moves the window at most once a frame, one request in flight, and the size waits for its end
  const mover = useMemo<FloatingMover>(() => {
    const moves = createMoveCoalescer((dx, dy) => bridge?.moveBy(dx, dy));
    return {
      coords: "screen",
      moveBy: (dx, dy) => {
        frame.current.dragging = true;
        moves.add(dx, dy);
      },
      moved: () => {
        void moves.flush().then(() => {
          frame.current.dragging = false;
          frame.current.report();
          bridge?.moved();
        });
      },
    };
  }, [bridge]);
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
      onSide={onSide}
      onReserve={onReserve}
    />
    </Fallback>
  );
}

export default FloatingBotWindow;
