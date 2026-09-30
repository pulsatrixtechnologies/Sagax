// The detached Hibou 98 assistant: what the small always-on-top window shows
// (electron/retro-assistant-window.mjs). It is a dumb renderer: the main app
// page decides the pose and the balloon and sends a snapshot; this page draws
// it, moves its own window when dragged, lets clicks fall through wherever it
// is transparent, and reports every click back to the main page.
import "./retro-assistant.css";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@/lib/cn";
import type { MascotSkinId } from "../../../shared/mascot-skins";
import { AssistantArt, useCustomArtUrls } from "./AssistantArt";
import { BulbIcon } from "./RetroArt";
import { characterBox } from "./logic";
import { isDetachedSnapshot, type AssistantWindowBridge, type DetachedEvent, type DetachedSnapshot } from "./detached-protocol";

/** How far the pointer must travel before a press becomes a drag. */
const DRAG_SLOP = 4;

export function DetachedAssistant({ bridge = typeof window === "undefined" ? undefined : window.retroAssistantWindow }: { bridge?: AssistantWindowBridge }) {
  const [snapshot, setSnapshot] = useState<DetachedSnapshot | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean; id: number } | null>(null);
  const hovering = useRef(false);
  const custom = useCustomArtUrls(snapshot?.character === "custom");

  // A transparent page: only the character and its balloon are painted.
  useEffect(() => {
    document.documentElement.dataset.retroDetached = "";
    return () => {
      delete document.documentElement.dataset.retroDetached;
    };
  }, []);

  useEffect(() => {
    if (!bridge) return;
    const off = bridge.onState((value) => {
      if (isDetachedSnapshot(value)) setSnapshot(value);
    });
    bridge.ready();
    return off;
  }, [bridge]);

  useEffect(() => {
    if (snapshot?.locale) document.documentElement.lang = snapshot.locale;
  }, [snapshot?.locale]);

  const send = useCallback((event: DetachedEvent) => bridge?.send(event), [bridge]);

  // Size the window to what is drawn: the balloon grows it upward.
  useLayoutEffect(() => {
    const node = root.current;
    if (!node || !bridge || typeof ResizeObserver === "undefined") return;
    const report = () => void bridge.resize(Math.ceil(node.scrollWidth), Math.ceil(node.scrollHeight));
    const observer = new ResizeObserver(report);
    observer.observe(node);
    report();
    return () => observer.disconnect();
  }, [bridge, snapshot?.balloon, menuOpen]);

  // Clicks pass through the transparent parts until the pointer is on the art.
  const interactive = (on: boolean) => {
    hovering.current = on;
    if (!drag.current) bridge?.setInteractive(on);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (menuOpen) setMenuOpen(false);
      else send({ type: "dismiss" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen, send]);

  // With no balloon to type in, give the focus back to whatever had it.
  const hasAsk = Boolean(snapshot?.balloon?.ask);
  useEffect(() => {
    if (!hasAsk) bridge?.setFocusable(false);
  }, [bridge, hasAsk]);

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { x: event.screenX, y: event.screenY, moved: false, id: event.pointerId };
    bridge?.setInteractive(true);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const start = drag.current;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.screenX - start.x;
    const dy = event.screenY - start.y;
    if (!start.moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
    start.moved = true;
    start.x = event.screenX;
    start.y = event.screenY;
    void bridge?.moveBy(dx, dy);
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const start = drag.current;
    drag.current = null;
    if (!start || start.id !== event.pointerId) return;
    if (start.moved) bridge?.moved();
    else {
      setMenuOpen(false);
      send({ type: "click" });
    }
    if (!hovering.current) bridge?.setInteractive(false);
  };

  const onSearch = (event: FormEvent) => {
    event.preventDefault();
    send({ type: "search", query });
  };

  if (!snapshot) return <div ref={root} className="r98-root r98-detached" />;
  const box = characterBox(snapshot.character);
  const balloon = snapshot.balloon;
  const look = snapshot.look ? { color: snapshot.look.color, skin: snapshot.look.skin as MascotSkinId } : undefined;

  return (
    <div ref={root} className="r98-root r98-detached" data-reduced={snapshot.reduced ? "" : undefined}>
      {balloon && (
        <div
          role="dialog"
          aria-label={snapshot.label}
          className="r98-balloon r98-balloon-docked"
          onPointerEnter={() => interactive(true)}
          onPointerLeave={() => interactive(false)}
          onPointerDown={() => { if (balloon.ask) bridge?.setFocusable(true); }}
        >
          <span className="r98-balloon-shade" aria-hidden="true" />
          <div className="r98-balloon-face">
            <span className="r98-tail" aria-hidden="true" />
            {balloon.title && (
              <div className="r98-tip-head">
                <BulbIcon size={18} />
                <strong>{balloon.title}</strong>
              </div>
            )}
            {balloon.text && <p>{balloon.text}</p>}
            {balloon.question && <p className="r98-question">{balloon.question}</p>}
            {balloon.bullets.length > 0 && (
              <ul className="r98-bullets">
                {balloon.bullets.map((item) => (
                  <li key={item.id}>
                    <button type="button" onClick={() => send({ type: "bullet", id: item.id })}>
                      <span className="r98-dot" aria-hidden="true" />
                      <span>{item.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {balloon.buttons.length > 0 && (
              <div className="r98-row r98-row-3">
                {balloon.buttons.map((item) => (
                  <button key={item.id} type="button" className={cn("r98-btn", item.default && "r98-default")} onClick={() => send({ type: "button", id: item.id })}>
                    {item.label}
                  </button>
                ))}
              </div>
            )}
            {balloon.ask && (
              <form className="r98-ask" onSubmit={onSearch}>
                <label className="r98-ask-label" htmlFor="r98-detached-ask">{balloon.ask.label}</label>
                <input id="r98-detached-ask" className="r98-field" value={query} placeholder={balloon.ask.placeholder} autoComplete="off" onChange={(event) => setQuery(event.target.value)} />
                <div className="r98-row">
                  <button type="button" className="r98-btn" onClick={() => send({ type: "options" })}>{balloon.ask.options}</button>
                  <button type="submit" className="r98-btn r98-default">{balloon.ask.search}</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
      {menuOpen && (
        <div role="menu" className="r98-menu r98-detached-menu" onPointerEnter={() => interactive(true)} onPointerLeave={() => interactive(false)}>
          {snapshot.menu.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className="r98-menu-item"
              onClick={() => {
                setMenuOpen(false);
                send({ type: "menu", id: item.id });
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
      <div className="r98-detached-stage" style={{ width: box.width, height: box.height }}>
        {snapshot.bulb && !balloon && (
          <button
            type="button"
            className="r98-bulb"
            title={snapshot.bulb}
            aria-label={snapshot.bulb}
            onPointerEnter={() => interactive(true)}
            onPointerLeave={() => interactive(false)}
            onClick={() => send({ type: "bulb" })}
          >
            <BulbIcon />
          </button>
        )}
        <button
          type="button"
          className="r98-owl r98-detached-art"
          aria-label={snapshot.label}
          aria-haspopup="menu"
          onPointerEnter={() => interactive(true)}
          onPointerLeave={() => interactive(false)}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => { drag.current = null; }}
          onContextMenu={(event) => {
            event.preventDefault();
            setMenuOpen((open) => !open);
          }}
        >
          <AssistantArt character={snapshot.character} pose={snapshot.pose} reduced={snapshot.reduced} look={look} custom={custom} />
        </button>
      </div>
    </div>
  );
}

export default DetachedAssistant;
