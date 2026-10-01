// A floating bot's desktop window (electron/floating-bot-window.mjs): a dumb
// renderer. The main app page decides the pose and the balloon and sends a
// snapshot; this page draws it, moves its own window when dragged, sizes the
// window to what is drawn, lets clicks fall through wherever it is
// transparent (the 3D owl's own pixels take the pointer, not its empty
// corners), lets the mascot fly the window off and back while its bot works,
// and reports every click and typed message back. It holds no session and
// calls no API.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { FloatingBotView, type FloatingMover } from "./FloatingBotView";
import { createWindowPilot } from "./pilot";
import { isFloatingSnapshot, mascotFields, type FloatingEvent, type FloatingSnapshot, type FloatingWindowBridge } from "./protocol";

export function FloatingBotWindow({ bridge = typeof window === "undefined" ? undefined : window.floatingBotWindow }: { bridge?: FloatingWindowBridge }) {
  const [snapshot, setSnapshot] = useState<FloatingSnapshot | null>(null);
  const root = useRef<HTMLDivElement>(null);

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
  }, [bridge, snapshot === null]);

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

  if (!snapshot) return <div ref={root} className="fb-root fb-window" />;
  return (
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
  );
}

export default FloatingBotWindow;
