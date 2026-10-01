// The desktop mascot as THE Sagax owl: the very same art as the in-app avatar
// (src/lib/owl/owl-art.ts, the bot's palette and skin colors), animated in
// 2.5D by the mascot's behavior (behavior.ts). Each frame writes transforms
// straight onto the SVG groups (no React render): owl-art's own rig, wing,
// eye, pupil and lid transforms, plus a perspective turn around the vertical
// axis for spins and for facing left or right (past a quarter turn the owl
// shows its mirrored side, so a half turn is the owl facing the other way).
import { useEffect, useId, useMemo, useRef } from "react";
import { MAUS_COLORS } from "@/lib/mascot";
import {
  eyesTransform,
  FAR_WING_MIRROR,
  farWingOpacity,
  farWingTransform,
  gazeToOffset,
  lidTransform,
  owlPalette,
  owlRim,
  owlSvgParts,
  pupilTransform,
  rigTransform,
  wingTransform,
  type OwlPath,
} from "@/lib/owl/owl-art";
import { owlSkinId, owlSkinPalette } from "@/lib/owl/owl-skins";
import type { MascotFrame } from "./behavior";

export interface Owl25DProps {
  color: string;
  skin: string;
  /** The owl's box, px. */
  size: number;
  frame: (now: number) => MascotFrame;
  fps: () => number;
  /** Receives a hit test on the owl's painted pixels once drawn, null when gone. */
  onHitTest: (test: ((clientX: number, clientY: number) => boolean) | null) => void;
}

/** Owl units (the 3D scale, about 2.3 tall) to owl-art viewBox units (the owl is about 200 tall). */
const UNIT = 80;
const DEG = 180 / Math.PI;

/** The transforms of one frame, as CSS strings: pure, so it can be tested. */
export function owl25dTransforms(frame: MascotFrame) {
  const lift = frame.y * UNIT;
  const squash = frame.squash;
  const pose = {
    x: frame.sway * UNIT * 0.6 + frame.headYaw * 4,
    y: -lift,
    tilt: (frame.headTilt * 0.6 + frame.lean * 0.5) * DEG,
    sx: 1 / Math.sqrt(squash),
    sy: squash,
  };
  const open = Math.min(1, Math.max(0, frame.wing));
  // gentle flutter on top of the spread, so a beating wing never looks frozen
  const flutter = open > 0.05 ? Math.sin(open * Math.PI * 3) * 4 : 0;
  const pupil = frame.pupilX === 0 && frame.pupilY === 0 ? gazeToOffset(null) : gazeToOffset({ x: frame.pupilX, y: -frame.pupilY });
  return {
    turn: `perspective(520px) rotateY(${(frame.spin * DEG).toFixed(2)}deg) rotateX(${(frame.headPitch * 0.25 * DEG).toFixed(2)}deg) scale(${frame.scale.toFixed(4)})`,
    rig: rigTransform(pose),
    nearWing: wingTransform(flutter, open),
    farWing: farWingTransform(flutter, open),
    farWingOpacity: farWingOpacity(open),
    eyes: eyesTransform(1),
    pupil: pupilTransform(pupil),
    lids: lidTransform(frame.lid),
  };
}

const paths = (list: OwlPath[]) => list.map((p, i) => <path key={i} fill={p.fill} d={p.d} />);
const rims = (list: OwlPath[], stroke: string) =>
  list.map((p, i) => <path key={`r${i}`} d={p.d} fill="none" stroke={stroke} strokeWidth={5} strokeLinejoin="round" />);

export default function Owl25D({ color, skin, size, frame, fps, onHitTest }: Owl25DProps) {
  const hex = (MAUS_COLORS as Record<string, string>)[color] ?? color;
  const skinId = owlSkinId(skin);
  const parts = useMemo(() => owlSvgParts(owlSkinPalette(skinId, owlPalette(hex), hex), { size }), [skinId, hex, size]);
  const rim = owlRim(hex);
  const uid = `fbowl-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const svg = useRef<SVGSVGElement>(null);
  const turn = useRef<HTMLSpanElement>(null);
  const rig = useRef<SVGGElement>(null);
  const nearWing = useRef<SVGGElement>(null);
  const nearWingBack = useRef<SVGGElement>(null);
  const farWing = useRef<SVGGElement>(null);
  const eyes = useRef<SVGGElement>(null);
  const pupil = useRef<SVGGElement>(null);
  const lids = useRef<SVGGElement>(null);
  const live = useRef({ frame, fps });
  live.current = { frame, fps };

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const draw = (now: number) => {
      const t = owl25dTransforms(live.current.frame(now));
      if (turn.current) turn.current.style.transform = t.turn;
      rig.current?.style.setProperty("transform", t.rig);
      nearWing.current?.style.setProperty("transform", t.nearWing);
      nearWingBack.current?.style.setProperty("transform", t.nearWing);
      if (farWing.current) {
        farWing.current.style.transform = t.farWing;
        farWing.current.style.opacity = String(t.farWingOpacity);
      }
      eyes.current?.style.setProperty("transform", t.eyes);
      pupil.current?.style.setProperty("transform", t.pupil);
      lids.current?.style.setProperty("transform", t.lids);
    };
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (document.hidden) return;
      const interval = 1000 / Math.max(1, Math.min(60, live.current.fps()));
      if (now - last < interval - 3) return;
      last = now;
      draw(now);
    };
    draw(performance.now());
    raf = requestAnimationFrame(tick);
    onHitTest((x, y) => {
      const hit = document.elementFromPoint(x, y);
      return Boolean(hit && hit !== svg.current && svg.current?.contains(hit));
    });
    return () => {
      cancelAnimationFrame(raf);
      onHitTest(null);
    };
    // the loop reads the latest callbacks through `live`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { eye } = parts;
  return (
    <span ref={turn} className="fb-owl25" style={{ display: "block", width: size, height: size, transformOrigin: "50% 80%" }}>
      <svg ref={svg} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width={size} height={size} style={{ overflow: "visible", display: "block" }} aria-hidden="true">
        <defs>
          <clipPath id={`${uid}-iris`}>
            <circle cx={eye.cx} cy={eye.cy} r={eye.clipR} />
          </clipPath>
        </defs>
        <g ref={rig}>
          <g ref={farWing} style={{ opacity: 0 }}>
            <g transform={FAR_WING_MIRROR}>
              {rim && rims(parts.farWing, rim)}
              {paths(parts.farWing)}
            </g>
          </g>
          {rim && (
            <>
              <g ref={nearWingBack}>{rims(parts.nearWing, rim)}</g>
              <g>{rims([...parts.body, ...parts.feet], rim)}</g>
            </>
          )}
          <g>
            {paths(parts.body)}
            <g>{paths(parts.faceMask)}</g>
            {parts.spots && <g>{paths(parts.spots)}</g>}
            <g>{paths(parts.feet)}</g>
            <g>{paths(parts.beak)}</g>
          </g>
          <g ref={nearWing}>{paths(parts.nearWing)}</g>
          <g>
            <g>{paths(parts.socket)}</g>
            <g ref={eyes}>
              <circle cx={eye.cx} cy={eye.cy} r={eye.iris.r} fill={eye.iris.fill} />
              <g ref={pupil}>
                <circle cx={eye.cx} cy={eye.cy} r={eye.pupil.r} fill={eye.pupil.fill} />
                <circle cx={eye.highlight.cx} cy={eye.highlight.cy} r={eye.highlight.r} fill={eye.highlight.fill} />
              </g>
              <g clipPath={`url(#${uid}-iris)`}>
                <g ref={lids}>
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
