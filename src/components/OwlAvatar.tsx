// The Pulsa Bot owl as a React component. The art and the pose math live in
// src/lib/owl (pure); the animation runs on ONE shared requestAnimationFrame
// loop (src/lib/owl/owl-loop.ts) that writes transforms onto this component's
// SVG groups through refs, so a frame never re-renders React.
//
// animated=false draws the resting pose once and never joins the loop.
// prefers-reduced-motion keeps only the blinks. The success hop rises above
// the box, so the svg overflows on purpose.
import {
  forwardRef,
  memo,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { MAUS_COLORS } from "@/lib/mascot";
import {
  FAR_WING_MIRROR,
  gazeToOffset,
  hopForSize,
  owlPalette,
  owlRim,
  owlPose,
  owlSvgParts,
  pointerGazeOffset,
  poseTransforms,
  type OwlGaze,
  type OwlPath,
  type OwlState,
  type OwlWingMove,
} from "@/lib/owl/owl-art";
import { createOwlController, type OwlController } from "@/lib/owl/owl-loop";

export interface OwlAvatarHandle {
  /** Play a state for a moment (success/alert run once), then resume. */
  play: (state: OwlState, durationMs?: number) => void;
  blink: () => void;
  /** Open the wings for one move. */
  flourish: (move: OwlWingMove) => void;
}

export interface OwlAvatarProps {
  /** A bot color name (`green`) or any hex. */
  color: string;
  /** The continuous state. Pass success/alert to loop them. */
  state?: OwlState;
  /** Rendered px (width and height of the box). */
  size?: number;
  /** Accessible name; without one the owl is decorative. */
  label?: string | null;
  /** Off draws the resting pose once, with no loop at all. */
  animated?: boolean;
  /** Let the eye follow the pointer across this avatar. */
  trackPointer?: boolean;
  /** Pin the gaze (-1..1 per axis); undefined keeps the state's own. */
  gaze?: OwlGaze;
  /** Force reduced motion; undefined follows the OS setting. */
  reducedMotion?: boolean;
  /** Pin the wings open (0..1) in the still pose, for previews. */
  wings?: number;
  className?: string;
}

/** The pose a still owl holds: success rests as idle, alert keeps wide eyes. */
function stillPose(state: OwlState, hop: number) {
  if (state === "success") return owlPose("idle", 0, true, hop);
  if (state === "alert") return owlPose("alert", 0.6, true, hop);
  return owlPose(state, 0, true, hop);
}

/** The rim's stroke in viewBox units: about 1.6px on screen, never thinner than 5 units. */
const rimWidth = (size: number) => Math.round(Math.max(5, (1.6 * 256) / Math.max(size, 1)) * 100) / 100;

const rimPaths = (list: OwlPath[], stroke: string, width: number) =>
  list.map((p, i) => (
    <path key={`r${i}`} d={p.d} fill="none" stroke={stroke} strokeWidth={width} strokeLinejoin="round" />
  ));

const paths = (list: OwlPath[]) => list.map((p, i) => <path key={i} fill={p.fill} d={p.d} />);

function OwlAvatarComponent(
  {
    color,
    state = "idle",
    size = 44,
    label,
    animated = true,
    trackPointer = true,
    gaze,
    reducedMotion,
    wings = 0,
    className,
  }: OwlAvatarProps,
  ref: React.Ref<OwlAvatarHandle>,
) {
  const hex = (MAUS_COLORS as Record<string, string>)[color] ?? color;
  const parts = useMemo(() => owlSvgParts(owlPalette(hex), { size }), [hex, size]);
  const rim = owlRim(hex);
  const rimW = rimWidth(size);
  const uid = `owl-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const hop = hopForSize(size);

  const rig = useRef<SVGGElement>(null);
  const nearWing = useRef<SVGGElement>(null);
  const farWing = useRef<SVGGElement>(null);
  const nearWingBack = useRef<SVGGElement>(null);
  const eyes = useRef<SVGGElement>(null);
  const pupil = useRef<SVGGElement>(null);
  const lids = useRef<SVGGElement>(null);
  const controller = useRef<OwlController | null>(null);

  const pinned = gaze ? gazeToOffset(gaze) : null;
  const first = { ...stillPose(state, hop), open: Math.max(0, Math.min(1, wings)) };
  const still = poseTransforms(first, pinned ?? gazeToOffset(first.gaze));

  // Join the shared loop while animated; leave it on unmount or when stilled.
  useEffect(() => {
    if (!animated) return;
    const els = { rig: rig.current, nearWing: nearWing.current, eyes: eyes.current, pupil: pupil.current, lids: lids.current };
    if (!els.rig || !els.nearWing || !els.eyes || !els.pupil || !els.lids) return;
    const c = createOwlController(
      { rig: els.rig, nearWing: els.nearWing, eyes: els.eyes, pupil: els.pupil, lids: els.lids, farWing: farWing.current, nearWingBack: nearWingBack.current },
      { state, hop, pinnedGaze: pinned, reducedMotion },
    );
    controller.current = c;
    return () => {
      c.destroy();
      controller.current = null;
    };
    // The controller is created once per animated mount; the props below are
    // pushed into it by the effects that follow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animated]);

  useEffect(() => controller.current?.setState(state), [state]);
  useEffect(() => controller.current?.setHop(hop), [hop]);
  useEffect(() => controller.current?.setReducedMotion(reducedMotion), [reducedMotion]);
  const pinnedX = pinned?.x;
  const pinnedY = pinned?.y;
  useEffect(() => {
    controller.current?.setPinnedGaze(pinnedX == null || pinnedY == null ? null : { x: pinnedX, y: pinnedY });
  }, [pinnedX, pinnedY]);

  useImperativeHandle(ref, () => ({
    play: (s, durationMs) => controller.current?.play(s, durationMs),
    blink: () => controller.current?.blink(),
    flourish: (move) => controller.current?.flourish(move),
  }));

  const follow = trackPointer && animated;
  const onPointerMove = (event: ReactPointerEvent<HTMLSpanElement>) => {
    controller.current?.setPointer(
      pointerGazeOffset(event.currentTarget.getBoundingClientRect(), event.clientX, event.clientY),
    );
  };
  const onPointerLeave = () => controller.current?.setPointer(null);

  const { eye } = parts;
  return (
    <span
      className={className ?? "inline-flex shrink-0"}
      style={{ width: size, height: size }}
      data-owl=""
      onPointerMove={follow ? onPointerMove : undefined}
      onPointerLeave={follow ? onPointerLeave : undefined}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 256 256"
        width={size}
        height={size}
        style={{ overflow: "visible", display: "block" }}
        role={label ? "img" : undefined}
        aria-label={label || undefined}
        aria-hidden={label ? undefined : true}
      >
        <defs>
          <clipPath id={`${uid}-iris`}>
            <circle cx={eye.cx} cy={eye.cy} r={eye.clipR} />
          </clipPath>
        </defs>
        <g ref={rig} data-part="rig" style={{ transform: still.rig }}>
          {/* The far wing: the near wing mirrored, behind the body, shown only while the wings are out. */}
          <g
            ref={farWing}
            data-part="farWing"
            style={{ transform: still.farWing, opacity: still.farWingOpacity }}
          >
            <g transform={FAR_WING_MIRROR}>
              {rim && rimPaths(parts.farWing, rim, rimW)}
              {paths(parts.farWing)}
            </g>
          </g>
          {rim && (
            <>
              {/* The near wing's rim sits behind the body, moving with the wing, so it only shows once the wing is out. */}
              <g ref={nearWingBack} data-part="nearWingRim" style={{ transform: still.nearWing }}>
                {rimPaths(parts.nearWing, rim, rimW)}
              </g>
              <g data-part="rim">{rimPaths([...parts.body, ...parts.feet], rim, rimW)}</g>
            </>
          )}
          <g data-part="body">
            {paths(parts.body)}
            <g data-part="faceMask">{paths(parts.faceMask)}</g>
            {parts.spots && <g data-part="spots">{paths(parts.spots)}</g>}
            <g data-part="feet">{paths(parts.feet)}</g>
            <g data-part="beak">{paths(parts.beak)}</g>
          </g>
          <g ref={nearWing} data-part="nearWing" style={{ transform: still.nearWing }}>
            {paths(parts.nearWing)}
          </g>
          <g data-part="head">
            <g data-part="socket">{paths(parts.socket)}</g>
            <g ref={eyes} data-part="eyes" style={{ transform: still.eyes }}>
              <circle data-part="iris" cx={eye.cx} cy={eye.cy} r={eye.iris.r} fill={eye.iris.fill} />
              <g ref={pupil} data-part="pupil" style={{ transform: still.pupil }}>
                <circle cx={eye.cx} cy={eye.cy} r={eye.pupil.r} fill={eye.pupil.fill} />
                <circle
                  data-part="highlight"
                  cx={eye.highlight.cx}
                  cy={eye.highlight.cy}
                  r={eye.highlight.r}
                  fill={eye.highlight.fill}
                />
              </g>
              <g clipPath={`url(#${uid}-iris)`}>
                <g ref={lids} data-part="lids" style={{ transform: still.lids }}>
                  <path fill={parts.lid.fill} d={parts.lid.d} />
                </g>
              </g>
            </g>
          </g>
        </g>
      </svg>
    </span>
  );
}

export const OwlAvatar = memo(forwardRef(OwlAvatarComponent));
