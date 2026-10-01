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

/** The plain owl, standing where the mascot would: never an empty, invisible window. */
function PlainOwl({ color, rootRef }: { color: string; rootRef: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={rootRef} className="fb-root fb-window" data-fallback="">
      <div className="fb-stage" style={{ width: MASCOT_SIZE.width, height: MASCOT_SIZE.height, display: "grid", placeItems: "center" }}>
        <OwlAvatar color={color} size={120} state="idle" trackPointer={false} label={null} />
      </div>
    </div>
  );
}

/** A drawing error must not leave the window empty: report it (main logs it) and show the plain owl. */
class Fallback extends Component<{ color: string; rootRef: React.Ref<HTMLDivElement>; onFail: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`floating mascot failed to draw: ${error?.message ?? error}`, info.componentStack);
    this.props.onFail();
  }
  render() {
    return this.state.failed ? <PlainOwl color={this.props.color} rootRef={this.props.rootRef} /> : this.props.children;
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

  if (!snapshot) return blank ? <PlainOwl color="green" rootRef={root} /> : <div ref={root} className="fb-root fb-window" />;
  return (
    <Fallback color={snapshot.color} rootRef={root} onFail={() => setFailed(true)}>
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
