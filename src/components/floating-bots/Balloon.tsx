// The desktop mascot's chat balloon: it grows with its content up to about
// 480 px wide and 60 % of the screen high, then scrolls (earlier exchanges
// above, the last one in view); it renders replies as markdown like the
// chat; a grip on its free corner resizes it (at least 280 x 160); its header
// drags it away from the mascot and a pin puts it back; size and place are
// remembered per bot on this device. Enter sends, Shift+Enter starts a new
// line, the field grows to four lines, Escape closes. Trombi talks in the
// Hibou 98 look (a 98 title bar to drag, a 98 grip).
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@/lib/cn";
import { BalloonMarkdown } from "./BalloonMarkdown";
import type { FloatingBalloon, FloatingEvent } from "./protocol";

export interface BalloonPlace {
  /** px; absent: as wide as the content wants, within bounds. */
  w?: number;
  h?: number;
  /** Offset from the docked spot, px (always away from the mascot). */
  dx?: number;
  dy?: number;
}

export const BALLOON_MIN = { w: 280, h: 160 } as const;
export const BALLOON_MAX_W = 480;
const KEY = "omb.floatingBots.balloon.v1";

type PlaceStorage = Pick<Storage, "getItem" | "setItem">;
const defaultStorage = (): PlaceStorage | undefined => {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
};

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export function readBalloonPlace(botId: string, storage: PlaceStorage | undefined = defaultStorage()): BalloonPlace {
  try {
    const all = JSON.parse(storage?.getItem(KEY) ?? "{}") as Record<string, BalloonPlace>;
    const place = all?.[botId];
    if (!place || typeof place !== "object") return {};
    const out: BalloonPlace = {};
    if (finite(place.w)) out.w = Math.max(BALLOON_MIN.w, Math.round(place.w));
    if (finite(place.h)) out.h = Math.max(BALLOON_MIN.h, Math.round(place.h));
    if (finite(place.dx)) out.dx = Math.round(place.dx);
    if (finite(place.dy)) out.dy = Math.round(place.dy);
    return out;
  } catch {
    return {};
  }
}

export function writeBalloonPlace(botId: string, place: BalloonPlace, storage: PlaceStorage | undefined = defaultStorage()): void {
  if (!botId) return;
  try {
    const all = JSON.parse(storage?.getItem(KEY) ?? "{}") as Record<string, BalloonPlace>;
    storage?.setItem(KEY, JSON.stringify({ ...all, [botId]: place }));
  } catch {
    /* private mode or quota: the size holds for this session */
  }
}

/** Which way the balloon opens from the mascot: above or below, to its left or its right. */
export interface BalloonSide {
  below: boolean;
  right: boolean;
}

/** A resize from the grip at the balloon's free corner: the side away from the mascot grows. */
export function resizeBalloon(start: { w: number; h: number }, delta: { x: number; y: number }, side: BalloonSide, max: { w: number; h: number }): { w: number; h: number } {
  const w = start.w + (side.right ? delta.x : -delta.x);
  const h = start.h + (side.below ? delta.y : -delta.y);
  return {
    w: Math.round(Math.min(max.w, Math.max(BALLOON_MIN.w, w))),
    h: Math.round(Math.min(max.h, Math.max(BALLOON_MIN.h, h))),
  };
}

/** A move from the header: only away from the mascot, and only as far as the room allows. */
export function moveBalloon(start: { dx: number; dy: number }, delta: { x: number; y: number }, side: BalloonSide, room: { x: number; y: number }): { dx: number; dy: number } {
  const awayX = side.right ? 1 : -1;
  const awayY = side.below ? 1 : -1;
  // "+ 0" keeps a docked balloon at 0, not -0
  const along = (value: number, away: number, limit: number) => Math.min(Math.max(0, limit), Math.max(0, value * away)) * away + 0;
  return { dx: Math.round(along(start.dx + delta.x, awayX, room.x)), dy: Math.round(along(start.dy + delta.y, awayY, room.y)) };
}

export interface BalloonProps {
  botId: string;
  name: string;
  balloon: FloatingBalloon;
  retro: boolean;
  side: BalloonSide;
  /** How far the balloon may go from its docked spot, px, and how big it may grow. */
  room: { x: number; y: number; w: number; h: number };
  onEvent: (event: FloatingEvent) => void;
  hover: (on: boolean) => void;
  wantsKeyboard?: (on: boolean) => void;
  /** Labels the window has no translations for. */
  pinLabel: string;
}

export function Balloon({ botId, name, balloon, retro, side, room, onEvent, hover, wantsKeyboard, pinLabel }: BalloonProps) {
  const [draft, setDraft] = useState("");
  const [place, setPlace] = useState<BalloonPlace>(() => readBalloonPlace(botId));
  const box = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const gesture = useRef<{ kind: "move" | "resize"; x: number; y: number; start: BalloonPlace & { w0: number; h0: number } } | null>(null);

  useEffect(() => setPlace(readBalloonPlace(botId)), [botId]);

  // Follow a streaming reply to its newest words; a finished one shows its start.
  useEffect(() => {
    const node = textRef.current;
    if (node && balloon.streaming) node.scrollTop = node.scrollHeight;
  }, [balloon.text, balloon.streaming]);

  // ready to type when it opens
  useEffect(() => {
    if (!balloon.input) return;
    wantsKeyboard?.(true);
    const later = setTimeout(() => field.current?.focus(), 60);
    return () => clearTimeout(later);
  }, [Boolean(balloon.input), wantsKeyboard]);

  // the field grows with what is typed, up to four lines
  useLayoutEffect(() => {
    const node = field.current;
    if (!node) return;
    node.style.height = "auto";
    const line = Number.parseFloat(getComputedStyle(node).lineHeight) || 18;
    node.style.height = `${Math.min(node.scrollHeight, line * 4 + 10)}px`;
  }, [draft]);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    onEvent({ type: "send", text });
    setDraft("");
  };
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    send();
  };

  const startGesture = (kind: "move" | "resize") => (event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const rect = box.current?.getBoundingClientRect();
    gesture.current = { kind, x: event.screenX, y: event.screenY, start: { ...place, w0: rect?.width ?? BALLOON_MIN.w, h0: rect?.height ?? BALLOON_MIN.h } };
  };
  const onGestureMove = (event: ReactPointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    const delta = { x: event.screenX - g.x, y: event.screenY - g.y };
    if (g.kind === "resize") {
      const size = resizeBalloon({ w: g.start.w ?? g.start.w0, h: g.start.h ?? g.start.h0 }, delta, side, { w: room.w, h: room.h });
      setPlace((current) => ({ ...current, ...size }));
    } else {
      const offset = moveBalloon({ dx: g.start.dx ?? 0, dy: g.start.dy ?? 0 }, delta, side, room);
      setPlace((current) => ({ ...current, ...offset }));
    }
  };
  const endGesture = () => {
    if (!gesture.current) return;
    gesture.current = null;
    setPlace((current) => {
      writeBalloonPlace(botId, current);
      return current;
    });
  };
  const pinBack = () => {
    const next = { ...place, dx: 0, dy: 0 };
    setPlace(next);
    writeBalloonPlace(botId, next);
  };
  const detached = Boolean(place.dx || place.dy);

  // away from the mascot: a margin on the side facing it, so the window grows to hold both
  const offsetStyle: React.CSSProperties = {
    ...(side.right ? { marginLeft: place.dx ?? 0 } : { marginRight: -(place.dx ?? 0) }),
    ...(side.below ? { marginTop: place.dy ?? 0 } : { marginBottom: -(place.dy ?? 0) }),
  };
  const sizeStyle: React.CSSProperties = {
    width: place.w ?? undefined,
    height: place.h ?? undefined,
    maxWidth: place.w ? undefined : Math.min(BALLOON_MAX_W, room.w),
    maxHeight: place.h ? undefined : room.h,
  };
  const grip = `${side.below ? "bottom" : "top"}-${side.right ? "right" : "left"}`;

  return (
    <div
      ref={box}
      role="dialog"
      aria-label={name}
      data-kind={balloon.kind}
      data-detached={detached ? "" : undefined}
      className={cn("fb-balloon", retro && "r98-balloon r98-balloon-docked")}
      style={{ ...offsetStyle, ...sizeStyle }}
      onPointerEnter={() => hover(true)}
      onPointerLeave={() => hover(false)}
      onPointerDown={() => {
        if (balloon.input) wantsKeyboard?.(true);
      }}
      onPointerMove={onGestureMove}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
    >
      {retro && <span className="r98-balloon-shade" aria-hidden="true" />}
      <div className={cn(retro ? "r98-balloon-face" : "fb-face", "fb-balloon-face")}>
        {!detached && (retro ? <span className="r98-tail" aria-hidden="true" /> : <span className="fb-tail" aria-hidden="true" />)}
        <div className={cn("fb-head", retro && "r98-titlebar")} onPointerDown={startGesture("move")} data-drag-handle="">
          <strong className={retro ? "r98-titlebar-text" : "fb-name"}>{balloon.title ?? name}</strong>
          {detached && (
            <button type="button" className={retro ? "r98-titlebar-btn" : "fb-close"} aria-label={pinLabel} title={pinLabel} onPointerDown={(event) => event.stopPropagation()} onClick={pinBack}>
              ⌖
            </button>
          )}
          <button type="button" className={retro ? "r98-titlebar-btn" : "fb-close"} aria-label={balloon.close} title={balloon.close} onPointerDown={(event) => event.stopPropagation()} onClick={() => onEvent({ type: "dismiss" })}>
            ×
          </button>
        </div>
        <div ref={textRef} className="fb-text fb-thread" data-streaming={balloon.streaming ? "" : undefined} aria-live={balloon.streaming ? "off" : "polite"} tabIndex={0}>
          {(balloon.history ?? []).map((item, index) => (
            <div key={index} className="fb-exchange fb-earlier">
              {item.asked && <p className="fb-asked">{item.asked}</p>}
              {item.text && <BalloonMarkdown text={item.text} />}
            </div>
          ))}
          <div className="fb-exchange">
            {balloon.asked && balloon.kind !== "approval" && <p className="fb-asked">{balloon.asked}</p>}
            {balloon.kind === "thinking" ? (
              <span className="fb-thinking">
                {balloon.text}
                <span className="fb-dots" aria-hidden="true"><span /><span /><span /></span>
              </span>
            ) : balloon.kind === "chat" ? (
              <BalloonMarkdown text={balloon.text} />
            ) : (
              <p>{balloon.text}</p>
            )}
          </div>
        </div>
        {(balloon.kind !== "chat" || balloon.asked || balloon.truncated) && (
          <button type="button" className="fb-open" onClick={() => onEvent({ type: "open" })}>
            {balloon.open}
          </button>
        )}
        {balloon.input && (
          <form className="fb-ask" onSubmit={onSubmit}>
            <textarea
              ref={field}
              rows={1}
              className={retro ? "r98-field fb-input" : "fb-field fb-input"}
              value={draft}
              aria-label={balloon.input.label}
              placeholder={balloon.input.placeholder}
              autoComplete="off"
              maxLength={4000}
              onFocus={() => wantsKeyboard?.(true)}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                // Enter sends, Shift+Enter starts a new line
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  send();
                }
              }}
            />
            <button type="submit" className={cn(retro ? "r98-btn" : "fb-btn", "fb-send", retro && "r98-default")} disabled={!draft.trim()}>
              {balloon.input.send}
            </button>
          </form>
        )}
        <span className={cn("fb-grip", retro && "fb-grip-98")} data-corner={grip} aria-hidden="true" onPointerDown={startGesture("resize")} />
      </div>
    </div>
  );
}
