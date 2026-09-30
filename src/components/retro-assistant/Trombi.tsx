// Trombi, the paperclip: the Hibou 98 default assistant. Original art (a gem
// clip standing on a legal pad, eyes stuck on the wire), drawn as one inline
// SVG so every pose shares the same geometry and animates in CSS
// (trombi.css): the pupils, brows and wire move per state, and the extras
// (thought dots, Zzz, sparks, the flying envelope) appear only in theirs.
import "./trombi.css";
import { useId } from "react";
import { cn } from "@/lib/cn";
import { EYE_L, EYE_R, EYE_RADIUS, MARGIN, POSE_SHAPES, RULED, SHEET, WIRE, type TrombiPose } from "./trombi-art";

export type { TrombiPose };

/** Width over height of the drawing (viewBox -50 0 310 380). */
export const TROMBI_ASPECT = 310 / 380;

export interface TrombiProps {
  pose: TrombiPose;
  /** Rendered width in CSS px; the height follows the drawing. */
  size?: number;
  /** Freeze on the pose's still frame (reduced motion, thumbnails). */
  still?: boolean;
  /** Accessible name; null hides the drawing from assistive tech. */
  label?: string | null;
  className?: string;
}

function Eye({ side, center, pupil, clipId, fillId }: { side: "L" | "R"; center: readonly [number, number]; pupil: readonly [number, number]; clipId: string; fillId: string }) {
  const [cx, cy] = center;
  const inner = side === "L" ? 4 : -4;
  return (
    <g className="r98t-eye" data-part={`eye-${side}`}>
      <ellipse cx={cx} cy={cy} rx={EYE_RADIUS} ry={EYE_RADIUS} fill={`url(#${fillId})`} />
      <g clipPath={`url(#${clipId})`}>
        <g className="r98t-pupil" transform={`translate(${pupil[0]} ${pupil[1]})`}>
          <circle cx={cx + inner} cy={cy + 4} r={13.4} fill="#000" />
        </g>
      </g>
      <ellipse cx={cx} cy={cy} rx={EYE_RADIUS} ry={EYE_RADIUS} fill="none" stroke="#1b1f27" strokeWidth={1.7} />
    </g>
  );
}

function Spark({ x, y, scale, color, n }: { x: number; y: number; scale: number; color: string; n: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <path className={`r98t-spark r98t-s${n}`} d="M0 -10 L2.6 -2.6 L10 0 L2.6 2.6 L0 10 L-2.6 2.6 L-10 0 L-2.6 -2.6 Z" fill={color} stroke="#1b1f27" strokeWidth={1.2} />
    </g>
  );
}

function Extras({ pose }: { pose: TrombiPose }) {
  if (pose === "think") {
    return (
      <g data-part="fx">
        <circle className="r98t-dot" cx={184} cy={72} r={4} fill="#fff" stroke="#1b1f27" strokeWidth={1.6} />
        <circle className="r98t-dot r98t-d2" cx={197} cy={52} r={5.5} fill="#fff" stroke="#1b1f27" strokeWidth={1.6} />
        <circle className="r98t-dot r98t-d3" cx={210} cy={26} r={7.5} fill="#fff" stroke="#1b1f27" strokeWidth={1.6} />
      </g>
    );
  }
  if (pose === "sleep") {
    return (
      <g data-part="fx" fontFamily="Tahoma, Verdana, sans-serif" fontWeight="bold" fill="#1d2f8f" stroke="#fff" strokeWidth={3} paintOrder="stroke">
        <text className="r98t-z" x={180} y={74} fontSize={16}>z</text>
        <text className="r98t-z r98t-z2" x={192} y={52} fontSize={22}>Z</text>
        <text className="r98t-z r98t-z3" x={204} y={28} fontSize={28}>Z</text>
      </g>
    );
  }
  if (pose === "celebrate") {
    return (
      <g data-part="fx">
        <Spark x={2} y={92} scale={1.1} color="#ffd23f" n={1} />
        <Spark x={188} y={66} scale={1.3} color="#5fd4ff" n={2} />
        <Spark x={176} y={162} scale={0.8} color="#ff7ab8" n={3} />
        <Spark x={30} y={170} scale={0.9} color="#8cf07a" n={4} />
        <Spark x={196} y={120} scale={0.8} color="#ffd23f" n={5} />
      </g>
    );
  }
  if (pose === "send") {
    return (
      <g data-part="fx">
        <g className="r98t-sheet" opacity={0}>
          <path d="M150 248 h32 v44 h-32 Z" fill="#fffef0" stroke="#1b1f27" strokeWidth={1.6} />
          <path d="M155 260 h22 M155 267 h22 M155 274 h15" stroke="#7fb2d9" strokeWidth={1.2} />
        </g>
        <g className="r98t-envelope" transform="translate(8 -100) rotate(-14 167 276)">
          <path d="M146 262 h42 v28 h-42 Z" fill="#fffef0" stroke="#1b1f27" strokeWidth={1.8} strokeLinejoin="round" />
          <path d="M146 262 L167 278 L188 262" fill="#f2efd8" stroke="#1b1f27" strokeWidth={1.6} strokeLinejoin="round" />
          <circle cx={167} cy={278} r={3.4} fill="#c83a3a" stroke="#1b1f27" strokeWidth={1} />
          <path className="r98t-speed" d="M140 282 l-12 8 M142 292 l-16 10 M150 296 l-10 7" stroke="#1b1f27" strokeWidth={1.6} strokeLinecap="round" />
        </g>
      </g>
    );
  }
  return null;
}

export function Trombi({ pose, size = 110, still = false, label = "Trombi", className }: TrombiProps) {
  const raw = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const id = (name: string) => `r98t${raw}${name}`;
  const shape = POSE_SHAPES[pose] ?? POSE_SHAPES.idle;
  return (
    <svg
      className={cn("r98-trombi", `r98t-pose-${pose}`, still && "r98t-still", className)}
      viewBox="-50 0 310 380"
      width={size}
      height={Math.round(size / TROMBI_ASPECT)}
      data-pose={pose}
      role={label ? "img" : undefined}
      aria-label={label ?? undefined}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <defs>
        <radialGradient id={id("eye")} cx="0.45" cy="0.36" r="0.7">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.62" stopColor="#ffffff" />
          <stop offset="0.9" stopColor="#e3e7ec" />
          <stop offset="1" stopColor="#c9cfd7" />
        </radialGradient>
        <linearGradient id={id("paper")} x1="1" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff8c4" />
          <stop offset="0.6" stopColor="#fdf1a6" />
          <stop offset="1" stopColor="#f6e48a" />
        </linearGradient>
        <linearGradient id={id("curl")} gradientUnits="userSpaceOnUse" x1="150" y1="250" x2="250" y2="150">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.55" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.8" stopColor="#fffef2" stopOpacity="0.75" />
          <stop offset="0.93" stopColor="#e9d77a" stopOpacity="0.55" />
          <stop offset="1" stopColor="#c9b457" stopOpacity="0.7" />
        </linearGradient>
        <filter id={id("soft")} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3.2" />
        </filter>
        <radialGradient id={id("shadow")} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#000" stopOpacity="0.32" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
        <clipPath id={id("sheet")}>
          <path d={SHEET} />
        </clipPath>
        <clipPath id={id("clipL")}>
          <ellipse cx={EYE_L[0]} cy={EYE_L[1]} rx={EYE_RADIUS} ry={EYE_RADIUS} />
        </clipPath>
        <clipPath id={id("clipR")}>
          <ellipse cx={EYE_R[0]} cy={EYE_R[1]} rx={EYE_RADIUS} ry={EYE_RADIUS} />
        </clipPath>
      </defs>

      <g data-part="paper">
        <path d={SHEET} fill="#000" opacity={0.18} filter={`url(#${id("soft")})`} transform="translate(3 6)" />
        <path d={SHEET} fill={`url(#${id("paper")})`} />
        <g clipPath={`url(#${id("sheet")})`}>
          <path d={SHEET} fill={`url(#${id("curl")})`} />
          <g fill="none" stroke="#9fb8a4" strokeWidth={1}>
            {RULED.map((line) => (
              <path key={line} d={line} />
            ))}
          </g>
          <path d={MARGIN} stroke="#e08a8a" strokeWidth={0.9} fill="none" />
          <g transform="translate(94 317) matrix(1 0 -0.45 0.24 0 0) translate(-94 -317)">
            <path d={WIRE} fill="none" stroke="#3a3520" strokeWidth={15} strokeLinecap="round" opacity={0.28} filter={`url(#${id("soft")})`} />
          </g>
          <ellipse cx={96} cy={318} rx={50} ry={6} fill={`url(#${id("shadow")})`} />
        </g>
        <path d={SHEET} fill="none" stroke="#c7b25a" strokeWidth={1.1} strokeLinejoin="round" />
        <path d="M222 170 Q240 166 248 156 Q242 172 234 182 Z" fill="#fffbe0" stroke="#c7b25a" strokeWidth={1} strokeLinejoin="round" />
      </g>

      <g className="r98t-body" data-part="body">
        <g className="r98t-wire" data-part="wire" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d={WIRE} stroke="#39414c" strokeWidth={14} />
          <path d={WIRE} stroke="#aab4bf" strokeWidth={11} />
          <path d={WIRE} stroke="#77828f" strokeWidth={3.4} transform="translate(1.9 1.9)" />
          <path d={WIRE} stroke="#f4f7fa" strokeWidth={2.6} transform="translate(-1.7 -1.7)" />
          <path d={WIRE} stroke="#ffffff" strokeWidth={1.1} strokeDasharray="18 60 9 90" transform="translate(-1.8 -1.8)" />
          <circle cx={73} cy={65} r={2} fill="#fff" />
          <circle cx={137} cy={80} r={1.3} fill="#fff" opacity={0.8} />
          <circle cx={60} cy={297} r={1.7} fill="#fff" />
        </g>
        <g className="r98t-face" data-part="face" transform={`rotate(${shape.tilt} 99 118)`}>
          <g className="r98t-eyes" data-part="eyes">
            <Eye side="L" center={EYE_L} pupil={shape.pupil} clipId={id("clipL")} fillId={id("eye")} />
            <Eye side="R" center={EYE_R} pupil={shape.pupil} clipId={id("clipR")} fillId={id("eye")} />
          </g>
          <g className="r98t-brows" data-part="brows">
            <path className="r98t-brow" data-part="brow-L" d={shape.browL} fill="#1b1f27" stroke="#1b1f27" strokeWidth={1.6} strokeLinejoin="round" />
            <path className="r98t-brow" data-part="brow-R" d={shape.browR} fill="#1b1f27" stroke="#1b1f27" strokeWidth={1.6} strokeLinejoin="round" />
          </g>
        </g>
      </g>
      <Extras pose={pose} />
    </svg>
  );
}
