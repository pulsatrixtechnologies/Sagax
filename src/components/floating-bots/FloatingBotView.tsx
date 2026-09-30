// What a floating bot looks like: the bot's own avatar (its owl, with its
// colour and skin, or its picture) standing on the desktop or over the app,
// with Trombi-like poses, a speech balloon with a small input, and a
// right-click menu. It only draws a snapshot and reports what was clicked or
// typed; the brain (FloatingBots.tsx) decides everything else. The same view
// runs in a desktop window (FloatingBotWindow.tsx) and in the in-app overlay.
import "./floating-bots.css";
import { lazy, Suspense, useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent, type Ref } from "react";
import { cn } from "@/lib/cn";
import { OwlAvatar } from "@/components/OwlAvatar";
import type { OwlState } from "@/lib/owl/owl-art";
import type { FloatingEvent, FloatingPose, FloatingSnapshot } from "./protocol";

// The Hibou 98 extras (retro balloon stylesheet, Trombi's sparkle) load only
// while that skin is worn, so a device that never found the egg never fetches them.
const RetroDecor = lazy(() => import("./RetroDecor"));

/** How far the pointer must travel before a press becomes a drag. */
const DRAG_SLOP = 4;
/** A press held this long opens the menu where there is no right click (touch). */
const LONG_PRESS_MS = 550;
export const CHARACTER_SIZE = 88;

export function owlStateForPose(pose: FloatingPose): OwlState {
  if (pose === "think") return "thinking";
  if (pose === "speak") return "working";
  if (pose === "celebrate") return "success";
  if (pose === "alert") return "alert";
  if (pose === "sleep") return "sleepy";
  return "idle";
}

export interface FloatingMover {
  /** "screen" in a desktop window that moves under the pointer; "client" in the app. */
  coords: "screen" | "client";
  moveBy(dx: number, dy: number): void;
  moved(): void;
}

export interface FloatingBotViewProps {
  snapshot: FloatingSnapshot;
  onEvent: (event: FloatingEvent) => void;
  mover: FloatingMover;
  /** Desktop: let clicks reach the art and balloon, pass through elsewhere. */
  interactive?: (on: boolean) => void;
  /** Desktop: the window may take the keyboard while the input is used. */
  wantsKeyboard?: (on: boolean) => void;
  rootRef?: Ref<HTMLDivElement>;
  className?: string;
  style?: React.CSSProperties;
  /** The overlay's balloon folds under the bot when it stands near the top. */
  below?: boolean;
}

function Character({ snapshot }: { snapshot: FloatingSnapshot }) {
  const { avatar } = snapshot;
  if (avatar) {
    const radius = avatar.crop === "circle" ? "50%" : avatar.crop === "rounded" ? "22%" : "4px";
    const origin = `${avatar.focusX * 100}% ${avatar.focusY * 100}%`;
    return (
      <span className="fb-picture" style={{ width: CHARACTER_SIZE, height: CHARACTER_SIZE, borderRadius: radius }}>
        <img
          src={avatar.src}
          alt=""
          draggable={false}
          width={CHARACTER_SIZE}
          height={CHARACTER_SIZE}
          style={{ objectPosition: origin, transform: avatar.zoom === 1 ? undefined : `scale(${avatar.zoom})`, transformOrigin: origin }}
        />
      </span>
    );
  }
  return (
    <OwlAvatar
      color={snapshot.color}
      skin={snapshot.skin}
      size={CHARACTER_SIZE}
      state={owlStateForPose(snapshot.pose)}
      reducedMotion={snapshot.reduced}
      trackPointer={false}
      label={null}
    />
  );
}

export function FloatingBotView({ snapshot, onEvent, mover, interactive, wantsKeyboard, rootRef, className, style, below }: FloatingBotViewProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const drag = useRef<{ x: number; y: number; moved: boolean; id: number; timer?: ReturnType<typeof setTimeout>; menu?: boolean } | null>(null);
  const hovering = useRef(false);
  const textRef = useRef<HTMLDivElement>(null);
  const balloon = snapshot.balloon;
  const retro = snapshot.retro;

  // Follow a streaming reply to its newest words.
  useEffect(() => {
    const node = textRef.current;
    if (node && balloon?.streaming) node.scrollTop = node.scrollHeight;
  }, [balloon?.text, balloon?.streaming]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (menuOpen) setMenuOpen(false);
      else if (balloon) onEvent({ type: "dismiss" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen, balloon, onEvent]);

  // With no balloon to type in, give the keyboard back to whatever had it.
  const hasInput = Boolean(balloon?.input);
  useEffect(() => {
    if (!hasInput) wantsKeyboard?.(false);
  }, [hasInput, wantsKeyboard]);

  const hover = (on: boolean) => {
    hovering.current = on;
    if (!drag.current) interactive?.(on);
  };

  const point = (event: ReactPointerEvent) => (mover.coords === "screen" ? { x: event.screenX, y: event.screenY } : { x: event.clientX, y: event.clientY });

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const start = { ...point(event), moved: false, id: event.pointerId } as NonNullable<typeof drag.current>;
    if (event.pointerType === "touch") {
      start.timer = setTimeout(() => {
        start.menu = true;
        setMenuOpen(true);
      }, LONG_PRESS_MS);
    }
    drag.current = start;
    interactive?.(true);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const start = drag.current;
    if (!start || start.id !== event.pointerId) return;
    const now = point(event);
    const dx = now.x - start.x;
    const dy = now.y - start.y;
    if (!start.moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
    if (!start.moved) clearTimeout(start.timer);
    start.moved = true;
    start.x = now.x;
    start.y = now.y;
    mover.moveBy(dx, dy);
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const start = drag.current;
    drag.current = null;
    if (!start || start.id !== event.pointerId) return;
    clearTimeout(start.timer);
    if (start.moved) mover.moved();
    else if (!start.menu) {
      setMenuOpen(false);
      onEvent({ type: "click" });
    }
    if (!hovering.current) interactive?.(false);
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    onEvent({ type: "send", text });
    setDraft("");
  };

  const button = retro ? "r98-btn" : "fb-btn";

  return (
    <div
      ref={rootRef}
      className={cn("fb-root", retro && "r98-root", below && "fb-below", className)}
      style={style}
      data-reduced={snapshot.reduced ? "" : undefined}
      data-retro={retro ? "" : undefined}
      lang={snapshot.locale}
    >
      {balloon && (
        <div
          role="dialog"
          aria-label={snapshot.name}
          data-kind={balloon.kind}
          className={cn("fb-balloon", retro && "r98-balloon r98-balloon-docked")}
          onPointerEnter={() => hover(true)}
          onPointerLeave={() => hover(false)}
          onPointerDown={() => {
            if (balloon.input) wantsKeyboard?.(true);
          }}
        >
          {retro && <span className="r98-balloon-shade" aria-hidden="true" />}
          <div className={retro ? "r98-balloon-face" : "fb-face"}>
            {retro ? <span className="r98-tail" aria-hidden="true" /> : <span className="fb-tail" aria-hidden="true" />}
            <div className="fb-head">
              <strong className="fb-name">{balloon.title ?? snapshot.name}</strong>
              <button type="button" className="fb-close" aria-label={balloon.close} title={balloon.close} onClick={() => onEvent({ type: "dismiss" })}>
                ×
              </button>
            </div>
            {balloon.asked && balloon.kind !== "approval" && <p className="fb-asked">{balloon.asked}</p>}
            <div
              ref={textRef}
              className="fb-text"
              data-streaming={balloon.streaming ? "" : undefined}
              aria-live={balloon.streaming ? "off" : "polite"}
              tabIndex={0}
            >
              {balloon.kind === "thinking" ? (
                <span className="fb-thinking">
                  {balloon.text}
                  <span className="fb-dots" aria-hidden="true"><span /><span /><span /></span>
                </span>
              ) : (
                balloon.text
              )}
            </div>
            {(balloon.kind !== "chat" || balloon.asked || balloon.truncated) && (
              <button type="button" className="fb-open" onClick={() => onEvent({ type: "open" })}>
                {balloon.open}
              </button>
            )}
            {balloon.input && (
              <form className="fb-ask" onSubmit={onSubmit}>
                <input
                  className={retro ? "r98-field fb-input" : "fb-field fb-input"}
                  value={draft}
                  aria-label={balloon.input.label}
                  placeholder={balloon.input.placeholder}
                  autoComplete="off"
                  maxLength={4000}
                  onFocus={() => wantsKeyboard?.(true)}
                  onChange={(event) => setDraft(event.target.value)}
                />
                <button type="submit" className={cn(button, "fb-send", retro && "r98-default")} disabled={!draft.trim()}>
                  {balloon.input.send}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
      {menuOpen && (
        <div role="menu" aria-label={snapshot.name} className={cn("fb-menu", retro && "r98-menu")} onPointerEnter={() => hover(true)} onPointerLeave={() => hover(false)}>
          {snapshot.menu.map((item) => (
            <button
              key={item.id}
              type="button"
              role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
              aria-checked={item.checked}
              className={cn("fb-menu-item", retro && "r98-menu-item")}
              onClick={() => {
                setMenuOpen(false);
                onEvent({ type: "menu", id: item.id });
              }}
            >
              <span className="fb-check" aria-hidden="true">{item.checked ? "✓" : ""}</span>
              {item.label}
            </button>
          ))}
        </div>
      )}
      <div className="fb-stage" data-pose={snapshot.pose}>
        {retro && (
          <Suspense fallback={null}>
            <RetroDecor sparkle={snapshot.sparkle} reduced={snapshot.reduced} />
          </Suspense>
        )}
        {snapshot.pose === "think" && (
          <span className="fb-thought" aria-hidden="true"><span /><span /><span /></span>
        )}
        <button
          type="button"
          className="fb-art"
          aria-label={snapshot.label}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onPointerEnter={() => hover(true)}
          onPointerLeave={() => hover(false)}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            clearTimeout(drag.current?.timer);
            drag.current = null;
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onEvent({ type: "click" });
            } else if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
              event.preventDefault();
              setMenuOpen((open) => !open);
            }
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            onEvent({ type: "context" });
            setMenuOpen((open) => !open);
          }}
        >
          <span className="fb-body">
            <Character snapshot={snapshot} />
          </span>
        </button>
      </div>
    </div>
  );
}
