// The desktop mascot's chat balloon: it grows with its content up to about
// 480 px wide and 60 % of the screen high, then scrolls (earlier exchanges
// above, the last one in view); it renders replies as markdown like the
// chat; a grip on its free corner resizes it (at least 280 x 160); its header
// drags it away from the mascot and a pin puts it back; size and place are
// remembered per bot on this device. Enter sends, Shift+Enter starts a new
// line, the field grows to four lines, Escape closes. Trombi talks in the
// Hibou 98 look (a 98 title bar to drag, a 98 grip).
import { memo, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Phone } from "lucide-react";
import { cn } from "@/lib/cn";
import { BalloonMarkdown } from "./BalloonMarkdown";
import type { FloatingBalloon, FloatingEvent } from "./protocol";
import { balloonReserve, type Size } from "./window-frame";

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

/** The gap the root's flex layout keeps between the docked balloon and the mascot's stage, px. */
export const BALLOON_GAP = 8;
/** How far the balloon may overlap the character's box before it covers its face, px. */
export const FACE_INSET = 12;

/**
 * What the balloon must not cover: the character's box in its stage (the
 * stage itself is mostly transparent room for hops and spread wings, and the
 * balloon may sit over it), and the balloon's own size.
 */
export interface BalloonNear {
  stage: Size;
  owl: { left: number; top: number; size: number };
  balloon: { w: number; h: number };
}

/**
 * Where the balloon may stand, as an offset from its docked spot: away from
 * the mascot as far as the room on screen allows, and toward it right up to
 * its character (over the stage's empty room, touching or slightly
 * overlapping the character's box), never over its face. Without `near` it
 * only moves away (the docked spot is then the closest).
 */
export function clampBalloon(offset: { dx: number; dy: number }, side: BalloonSide, room: { x: number; y: number }, near?: BalloonNear, from?: { dx: number; dy: number }): { dx: number; dy: number } {
  const awayX = side.right ? 1 : -1;
  const awayY = side.below ? 1 : -1;
  // toward the mascot: along x the docked balloon already lines up with the stage's edge (the
  // window's), along y it may come down over the whole stage
  const towardY = near ? near.stage.height + BALLOON_GAP : 0;
  const along = (value: number, away: number, limit: number, toward: number) => Math.min(Math.max(0, limit), Math.max(-toward, value * away)) * away + 0;
  let dx = Math.round(along(offset.dx, awayX, room.x, 0));
  let dy = Math.round(along(offset.dy, awayY, room.y, towardY));
  if (!near) return { dx, dy };
  const { stage, owl, balloon } = near;
  // the balloon's box and the face's, in the stage's coordinates
  const face = { left: owl.left + FACE_INSET, top: owl.top + FACE_INSET, right: owl.left + owl.size - FACE_INSET, bottom: owl.top + owl.size - FACE_INSET };
  const boxAt = (x: number, y: number) => {
    const left = (side.right ? 0 : stage.width - balloon.w) + x;
    const top = (side.below ? stage.height + BALLOON_GAP : -BALLOON_GAP - balloon.h) + y;
    return { left, top, overX: left < face.right && left + balloon.w > face.left, overY: top < face.bottom && top + balloon.h > face.top };
  };
  const at = boxAt(dx, dy);
  if (!at.overX || !at.overY) return { dx, dy };
  // over the face: step back, away from it, along the side it came from (else the shorter way)
  const pushX = side.right ? face.right - at.left : at.left + balloon.w - face.left;
  const pushY = side.below ? face.bottom - at.top : at.top + balloon.h - face.top;
  const fitsX = dx * awayX + pushX <= Math.max(0, room.x);
  const fitsY = dy * awayY + pushY <= Math.max(0, room.y);
  const was = from ? boxAt(from.dx, from.dy) : null;
  const sideways = was && was.overY && !was.overX ? true : was && was.overX && !was.overY ? false : pushX < pushY;
  if (fitsX && (sideways || !fitsY)) dx += pushX * awayX;
  else dy += pushY * awayY;
  return { dx: Math.round(dx) + 0, dy: Math.round(dy) + 0 };
}

/** A move from the header: within the room left on screen, and right up to the mascot (clampBalloon). */
export function moveBalloon(start: { dx: number; dy: number }, delta: { x: number; y: number }, side: BalloonSide, room: { x: number; y: number }, near?: BalloonNear): { dx: number; dy: number } {
  return clampBalloon({ dx: start.dx + delta.x, dy: start.dy + delta.y }, side, room, near, start);
}

/** The part of an offset that goes away from the mascot (it grows the window) and the part toward it (drawn over the stage). */
export function splitOffset(place: { dx?: number; dy?: number }, side: BalloonSide): { away: { dx: number; dy: number }; toward: { dx: number; dy: number } } {
  const dx = place.dx ?? 0;
  const dy = place.dy ?? 0;
  const away = { dx: (side.right ? Math.max(0, dx) : Math.min(0, dx)) + 0, dy: (side.below ? Math.max(0, dy) : Math.min(0, dy)) + 0 };
  return { away, toward: { dx: dx - away.dx + 0, dy: dy - away.dy + 0 } };
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
  /** The call button's label, where voice mode serves this bot (absent: no button). */
  callLabel?: string;
  /** The mascot's stage under the balloon, for the room the window holds. */
  stage?: Size;
  /** The character's box in that stage: the balloon comes right up to it, never over its face. */
  owl?: BalloonNear["owl"];
  /** Desktop: the room the balloon may take (null once closed); `exact` fits the window to it now. */
  onReserve?: (reserve: Size | null, exact: boolean) => void;
}

/**
 * An earlier exchange: its text no longer changes, so it is parsed once, not
 * again for every word of the reply streaming under it.
 */
const Earlier = memo(function Earlier({ asked, text }: { asked: string; text: string }) {
  return (
    <div className="fb-exchange fb-earlier">
      {asked && <p className="fb-asked">{asked}</p>}
      {text && <BalloonMarkdown text={text} />}
    </div>
  );
});

export function Balloon({ botId, name, balloon, retro, side, room, onEvent, hover, wantsKeyboard, pinLabel, callLabel, stage, owl, onReserve }: BalloonProps) {
  const [draft, setDraft] = useState("");
  const [place, setPlace] = useState<BalloonPlace>(() => readBalloonPlace(botId));
  const box = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const gesture = useRef<{ kind: "move" | "resize"; x: number; y: number; start: BalloonPlace & { w0: number; h0: number }; delta?: { x: number; y: number }; frame?: number } | null>(null);

  useEffect(() => setPlace(readBalloonPlace(botId)), [botId]);

  // The window holds the room this balloon may take (window-frame.ts), set
  // before the first paint so it opens at its size in one step; a gesture
  // reserves its whole range at its start and fits again at its end.
  const reserveFor = (range: "place" | "move" | "resize") => {
    if (!stage) return null;
    const grown = range === "resize" ? { ...place, w: Math.max(place.w ?? 0, room.w), h: Math.max(place.h ?? 0, room.h) } : place;
    // only the part away from the mascot grows the window; toward it the balloon is drawn over the stage
    const moved = range === "move" ? { ...grown, dx: room.x, dy: room.y } : { ...grown, ...splitOffset(grown, side).away };
    return balloonReserve({ stage, room, place: moved, maxWidth: BALLOON_MAX_W });
  };
  const reserveRef = useRef(reserveFor);
  reserveRef.current = reserveFor;
  const ended = useRef(false);
  useLayoutEffect(() => {
    if (!onReserve || gesture.current) return;
    // after a gesture the window fits the balloon's new size and place again
    onReserve(reserveRef.current("place"), ended.current);
    ended.current = false;
  }, [onReserve, stage, room.w, room.h, room.x, room.y, place, side.right, side.below]);

  // A place kept from another opening (another side, another screen) must not cover the face now
  const nearFor = (size: { w: number; h: number }): BalloonNear | undefined => (stage && owl ? { stage, owl, balloon: size } : undefined);
  useLayoutEffect(() => {
    const node = box.current;
    if (!node || !stage || !owl || gesture.current) return;
    const fixed = clampBalloon({ dx: place.dx ?? 0, dy: place.dy ?? 0 }, side, room, nearFor({ w: node.offsetWidth, h: node.offsetHeight }));
    if (fixed.dx !== (place.dx ?? 0) || fixed.dy !== (place.dy ?? 0)) setPlace((current) => ({ ...current, ...fixed }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side.right, side.below, stage, owl, room.x, room.y, place.w, place.h]);
  useEffect(() => () => onReserve?.(null, true), [onReserve]);

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
    // the layout size, not the drawn one (the opening pop scales it for a moment)
    const node = box.current;
    gesture.current = { kind, x: event.screenX, y: event.screenY, start: { ...place, w0: node?.offsetWidth || BALLOON_MIN.w, h0: node?.offsetHeight || BALLOON_MIN.h } };
    // the window takes the gesture's whole range once, rather than a resize per step
    onReserve?.(reserveRef.current(kind), false);
  };
  // one layout per frame, however many moves the pointer reports
  const applyGesture = () => {
    const g = gesture.current;
    if (!g?.delta) return;
    g.frame = undefined;
    const delta = g.delta;
    if (g.kind === "resize") {
      const size = resizeBalloon({ w: g.start.w ?? g.start.w0, h: g.start.h ?? g.start.h0 }, delta, side, { w: room.w, h: room.h });
      setPlace((current) => (current.w === size.w && current.h === size.h ? current : { ...current, ...size }));
    } else {
      setPlace((current) => {
        // stopped by the face, the balloon stays on the side it came from (the last frame's)
        const offset = clampBalloon({ dx: (g.start.dx ?? 0) + delta.x, dy: (g.start.dy ?? 0) + delta.y }, side, room, nearFor({ w: g.start.w0, h: g.start.h0 }), { dx: current.dx ?? 0, dy: current.dy ?? 0 });
        return current.dx === offset.dx && current.dy === offset.dy ? current : { ...current, ...offset };
      });
    }
  };
  const onGestureMove = (event: ReactPointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    g.delta = { x: event.screenX - g.x, y: event.screenY - g.y };
    if (g.frame === undefined) g.frame = requestAnimationFrame(applyGesture);
  };
  const endGesture = () => {
    const g = gesture.current;
    if (!g) return;
    if (g.frame !== undefined) cancelAnimationFrame(g.frame);
    applyGesture();
    gesture.current = null;
    ended.current = true;
    // a new object, so the window is fitted again even when the gesture changed nothing
    setPlace((current) => {
      writeBalloonPlace(botId, current);
      return { ...current };
    });
  };
  const pinBack = () => {
    const next = { ...place, dx: 0, dy: 0 };
    setPlace(next);
    writeBalloonPlace(botId, next);
  };
  const detached = Boolean(place.dx || place.dy);

  // Away from the mascot: a margin on the side facing it, so the window grows to hold both.
  // Toward it: drawn over the stage's empty room (`translate`, which the opening pop's
  // transform leaves alone), inside the window it already has.
  const { away, toward } = splitOffset(place, side);
  const offsetStyle: React.CSSProperties = {
    ...(side.right ? { marginLeft: away.dx } : { marginRight: -away.dx }),
    ...(side.below ? { marginTop: away.dy } : { marginBottom: -away.dy }),
    ...(toward.dx || toward.dy ? { translate: `${toward.dx}px ${toward.dy}px` } : {}),
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
          {callLabel && (
            <button type="button" className={retro ? "r98-titlebar-btn" : "fb-close fb-call-btn"} aria-label={callLabel} title={callLabel} data-call-start="" onPointerDown={(event) => event.stopPropagation()} onClick={() => onEvent({ type: "call", action: "start" })}>
              <Phone size={retro ? 9 : 13} strokeWidth={2.25} aria-hidden="true" />
            </button>
          )}
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
            <Earlier key={index} asked={item.asked} text={item.text} />
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
