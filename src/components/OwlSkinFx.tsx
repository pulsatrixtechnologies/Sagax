// The effect layers of an owl skin (src/lib/owl/owl-skins.ts), rendered
// inside OwlAvatar's rig so they move with the owl. SVG and CSS only: the
// keyframes in styles.css (owl-fx-*) animate opacity and transform, run only
// under [data-owl-fx="live"], and stop under prefers-reduced-motion. With no
// animation every layer shows its still look.
//
// Below OWL_DETAIL_MIN_SIZE only the aura is drawn (the recolor lives in the
// palette), and it never animates.
import type { CSSProperties, ReactNode } from "react";

import { OWL_GEOM, type OwlPath } from "@/lib/owl/owl-art";
import {
  OWL_LIGHTNING_ARCS,
  OWL_LIGHTNING_CRAWL,
  type OwlSkinId,
  type OwlSkinLook,
} from "@/lib/owl/owl-skins";

export interface OwlSkinFxProps {
  skin: OwlSkinId;
  look: OwlSkinLook;
  /** Unique id prefix for this owl's defs. */
  uid: string;
  /** Full effects (large avatars) or the aura only (small ones). */
  detail: boolean;
  /** The plumage paths: the owl's whole silhouette. */
  silhouette: OwlPath[];
}

const anim = (dur: number, delay = 0): CSSProperties => ({
  animationDuration: `${dur}s`,
  animationDelay: `${delay}s`,
});

/** A four-point sparkle centered on 0,0. */
const SPARKLE = "M0 -9L2 -2L9 0L2 2L0 9L-2 2L-9 0L-2 -2Z";
/** A six-armed snowflake centered on 0,0. */
const FLAKE = "M0 -6V6M-5.2 -3L5.2 3M-5.2 3L5.2 -3";
/** A flame tongue, base at 0,0, rising up. */
const flame = (w: number, h: number) =>
  `M0 0C${-w * 0.62} 0 ${-w * 0.6} ${-h * 0.42} ${-w * 0.12} ${-h * 0.7}` +
  `C${-w * 0.02} ${-h * 0.8} ${w * 0.1} ${-h * 0.9} ${w * 0.02} ${-h}` +
  `C${w * 0.42} ${-h * 0.72} ${w * 0.64} ${-h * 0.34} ${w * 0.46} ${-h * 0.12}C${w * 0.36} 0 ${w * 0.2} 0 0 0Z`;

/** Flame roots around the silhouette: [x, y, height, tilt deg]. */
const FLAMES: [number, number, number, number][] = [
  [58, 236, 58, -18],
  [40, 190, 64, -24],
  [42, 140, 60, -20],
  [62, 86, 56, -14],
  [104, 34, 50, -6],
  [160, 22, 46, 6],
  [206, 70, 50, 16],
  [214, 150, 56, 22],
  [196, 222, 58, 18],
];

const EMBERS: [number, number, number, number][] = [
  [52, 150, 2.6, 0],
  [78, 58, 2.2, 0.8],
  [132, 18, 2.4, 1.6],
  [196, 48, 2, 0.4],
  [220, 130, 2.6, 1.2],
  [36, 210, 2.2, 2],
  [210, 200, 2, 2.6],
];

const FLAKES: [number, number, number, number][] = [
  [30, 60, 0.9, 0],
  [226, 40, 0.75, 1.1],
  [18, 150, 0.7, 2.2],
  [238, 170, 0.95, 0.6],
  [70, 18, 0.65, 1.7],
  [196, 250, 0.8, 2.8],
  [48, 244, 0.7, 3.4],
];

const GLINTS: [number, number, number, number][] = [
  [72, 58, 0.9, 0],
  [196, 36, 0.7, 1.3],
  [58, 196, 0.8, 2.1],
];

/** Defs: the aura gradient, the silhouette clip, and per-skin paints. */
export function OwlSkinDefs({ skin, look, uid, detail, silhouette }: OwlSkinFxProps) {
  const out: ReactNode[] = [];
  if (look.aura) {
    out.push(
      <radialGradient key="aura" id={`${uid}-aura`} cx="0.5" cy="0.52" r="0.5">
        <stop offset="0" stopColor={look.aura.color} stopOpacity={look.aura.strength} />
        <stop offset="0.55" stopColor={look.aura.color} stopOpacity={look.aura.strength * 0.4} />
        <stop offset="1" stopColor={look.aura.color} stopOpacity={0} />
      </radialGradient>,
    );
  }
  if (!detail) return <>{out}</>;
  out.push(
    <clipPath key="sil" id={`${uid}-sil`}>
      {silhouette.map((p, i) => (
        <path key={i} d={p.d} />
      ))}
    </clipPath>,
  );
  if (look.eyeGlow) {
    out.push(
      <radialGradient key="eye" id={`${uid}-eyeglow`} cx="0.5" cy="0.5" r="0.5">
        <stop offset="0.35" stopColor={look.eyeGlow} stopOpacity={0.95} />
        <stop offset="0.7" stopColor={look.eyeGlow} stopOpacity={0.35} />
        <stop offset="1" stopColor={look.eyeGlow} stopOpacity={0} />
      </radialGradient>,
    );
  }
  if (skin === "gold") {
    out.push(
      <linearGradient key="metal" id={`${uid}-metal`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#FFF8D6" stopOpacity={0.9} />
        <stop offset="0.22" stopColor="#FFE38A" stopOpacity={0.35} />
        <stop offset="0.46" stopColor="#FFD24D" stopOpacity={0} />
        <stop offset="0.62" stopColor="#FFF1B0" stopOpacity={0.35} />
        <stop offset="0.8" stopColor="#8A5600" stopOpacity={0.3} />
        <stop offset="1" stopColor="#3A2200" stopOpacity={0.6} />
      </linearGradient>,
    );
  }
  if (skin === "gold" || skin === "carbon" || skin === "frost") {
    out.push(
      <linearGradient key="band" id={`${uid}-band`} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#FFFFFF" stopOpacity={0} />
        <stop offset="0.5" stopColor="#FFFFFF" stopOpacity={skin === "gold" ? 0.75 : 0.35} />
        <stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
      </linearGradient>,
    );
  }
  if (skin === "frost") {
    out.push(
      <linearGradient key="ice" id={`${uid}-ice`} x1="0.1" y1="0" x2="0.7" y2="1">
        <stop offset="0" stopColor="#FFFFFF" stopOpacity={0.6} />
        <stop offset="0.45" stopColor="#E0F7FF" stopOpacity={0.08} />
        <stop offset="1" stopColor="#1E5A86" stopOpacity={0.3} />
      </linearGradient>,
    );
  }
  if (skin === "inferno") {
    out.push(
      <linearGradient key="heat" id={`${uid}-heat`} x1="0" y1="1" x2="0" y2="0">
        <stop offset="0" stopColor="#FF6A1A" stopOpacity={0.85} />
        <stop offset="0.45" stopColor="#E23A0B" stopOpacity={0.35} />
        <stop offset="1" stopColor="#E23A0B" stopOpacity={0} />
      </linearGradient>,
    );
  }
  if (skin === "carbon") {
    // a 2x2 twill: each cell a tow of fibres, alternating direction
    out.push(
      <linearGradient key="cfh" id={`${uid}-cfh`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#24262B" />
        <stop offset="0.5" stopColor="#4B4F58" />
        <stop offset="1" stopColor="#24262B" />
      </linearGradient>,
      <linearGradient key="cfv" id={`${uid}-cfv`} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#17181C" />
        <stop offset="0.5" stopColor="#2F3238" />
        <stop offset="1" stopColor="#17181C" />
      </linearGradient>,
      <pattern key="weave" id={`${uid}-weave`} width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="4.5" height="4.5" fill={`url(#${uid}-cfh)`} />
        <rect x="4.5" y="4.5" width="4.5" height="4.5" fill={`url(#${uid}-cfh)`} />
        <rect x="4.5" width="4.5" height="4.5" fill={`url(#${uid}-cfv)`} />
        <rect y="4.5" width="4.5" height="4.5" fill={`url(#${uid}-cfv)`} />
      </pattern>,
      <linearGradient key="coat" id={`${uid}-coat`} x1="0" y1="0" x2="0.4" y2="1">
        <stop offset="0" stopColor="#FFFFFF" stopOpacity={0.28} />
        <stop offset="0.4" stopColor="#FFFFFF" stopOpacity={0} />
        <stop offset="1" stopColor="#000000" stopOpacity={0.35} />
      </linearGradient>,
    );
  }
  return <>{out}</>;
}

/** Behind the whole owl: the aura, and the inferno's flames. */
export function OwlSkinBack({ skin, look, uid, detail, silhouette }: OwlSkinFxProps) {
  if (skin === "none") return null;
  const glow = detail && look.rim && (skin === "neon" || skin === "lightning" || skin === "inferno");
  return (
    <g data-part="skinBack" pointerEvents="none">
      {glow && (
        <g className={`owl-fx-glow owl-fx-glow-${skin}`} fill="none" stroke={look.rim ?? undefined} strokeLinejoin="round">
          {silhouette.map((p, i) => (
            <g key={i}>
              <path d={p.d} strokeOpacity={0.1} strokeWidth={26} />
              <path d={p.d} strokeOpacity={0.18} strokeWidth={15} />
            </g>
          ))}
        </g>
      )}
      {look.aura && (
        <ellipse
          className={detail ? `owl-fx-aura owl-fx-aura-${skin}` : undefined}
          cx={128}
          cy={136}
          rx={detail ? 134 : 150}
          ry={detail ? 138 : 150}
          fill={`url(#${uid}-aura)`}
        />
      )}
      {detail &&
        skin === "inferno" &&
        FLAMES.map(([x, y, h, tilt], i) => (
          <g key={i} transform={`translate(${x} ${y}) rotate(${tilt})`}>
            <path className="owl-fx-flame" style={anim(0.55 + (i % 4) * 0.12, i * 0.09)} d={flame(h * 0.62, h)} fill="#F4511E" />
            <path className="owl-fx-flame" style={anim(0.42 + (i % 3) * 0.1, i * 0.13)} d={flame(h * 0.36, h * 0.66)} fill="#FFB02E" />
          </g>
        ))}
    </g>
  );
}

/** On the plumage, under the face mask: the skin's paint. */
export function OwlSkinPlumage({ skin, uid, detail }: OwlSkinFxProps) {
  if (!detail || skin === "none") return null;
  const clip = `url(#${uid}-sil)`;
  let inner: ReactNode = null;
  switch (skin) {
    case "gold":
      inner = <rect width={256} height={256} fill={`url(#${uid}-metal)`} />;
      break;
    case "carbon":
      inner = (
        <>
          <rect width={256} height={256} fill={`url(#${uid}-weave)`} opacity={0.9} />
          <rect width={256} height={256} fill={`url(#${uid}-coat)`} />
        </>
      );
      break;
    case "inferno":
      inner = <rect width={256} height={256} fill={`url(#${uid}-heat)`} className="owl-fx-pulse" style={anim(1.8)} />;
      break;
    case "frost":
      inner = (
        <>
          <rect width={256} height={256} fill={`url(#${uid}-ice)`} />
          {/* a few facets catching the light */}
          <path d="M62 64L96 40L104 70Z M44 150L70 128L66 170Z M176 30L204 50L184 60Z" fill="#FFFFFF" opacity={0.3} />
        </>
      );
      break;
    case "lightning":
      inner = OWL_LIGHTNING_CRAWL.map((arc, i) => (
        <g key={i} className="owl-fx-crackle" style={anim(arc.dur, arc.delay)} opacity={i === 0 ? 0.9 : 0}>
          <path d={arc.d} fill="none" stroke="#38BDF8" strokeOpacity={0.55} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" />
          <path d={arc.d} fill="none" stroke="#FFFFFF" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
        </g>
      ));
      break;
    default:
      return null;
  }
  return (
    <g data-part="skinPlumage" clipPath={clip} pointerEvents="none">
      {inner}
    </g>
  );
}

/** On the near wing, over its flat fill (so the paint follows the wing when it opens). */
export function OwlSkinWing({ skin, uid, detail, wing }: OwlSkinFxProps & { wing: OwlPath[] }) {
  if (!detail || (skin !== "gold" && skin !== "carbon")) return null;
  const fill = skin === "gold" ? `url(#${uid}-metal)` : `url(#${uid}-weave)`;
  return (
    <g data-part="skinWing" pointerEvents="none" opacity={skin === "carbon" ? 0.8 : 0.7}>
      {wing.map((p, i) => (
        <path key={i} d={p.d} fill={fill} />
      ))}
    </g>
  );
}

/** Around the eye, above the socket and under the iris. */
export function OwlSkinEyeGlow({ look, uid, detail }: OwlSkinFxProps) {
  if (!detail || !look.eyeGlow) return null;
  const { eye } = OWL_GEOM;
  return (
    <circle
      data-part="eyeGlow"
      className="owl-fx-pulse"
      style={anim(1.6)}
      cx={eye.x}
      cy={eye.y}
      r={eye.iris * 1.75}
      fill={`url(#${uid}-eyeglow)`}
      pointerEvents="none"
    />
  );
}

/** In front of the owl: arcs, sparks, glints, embers, snow, and the flash. */
export function OwlSkinFront({ skin, uid, detail }: OwlSkinFxProps) {
  if (!detail || skin === "none") return null;
  const clip = `url(#${uid}-sil)`;
  switch (skin) {
    case "lightning":
      return (
        <g data-part="skinFront" pointerEvents="none">
          {OWL_LIGHTNING_ARCS.map((arc, i) => (
            <g key={i} className="owl-fx-crackle" style={anim(arc.dur, arc.delay)} opacity={i === 0 || i === 3 ? 1 : 0}>
              <path d={arc.d} fill="none" stroke="#38BDF8" strokeOpacity={0.35} strokeWidth={12} strokeLinecap="round" strokeLinejoin="round" />
              <path d={arc.d} fill="none" stroke="#7DD3FC" strokeOpacity={0.9} strokeWidth={4.4} strokeLinecap="round" strokeLinejoin="round" />
              <path d={arc.d} fill="none" stroke="#FFFFFF" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            </g>
          ))}
          {/* the periodic flash lights the whole owl for a beat */}
          <g clipPath={clip}>
            <rect className="owl-fx-flash" style={anim(3.4, 1.9)} width={256} height={256} fill="#E0F7FF" opacity={0} />
          </g>
        </g>
      );
    case "gold":
    case "carbon":
    case "frost":
      return (
        <g data-part="skinFront" pointerEvents="none">
          <g clipPath={clip}>
            <g transform="rotate(22 128 128)">
              <rect
                className="owl-fx-sweep"
                style={anim(skin === "gold" ? 3.2 : 4.6, skin === "gold" ? 0.4 : 1.2)}
                x={70}
                y={-80}
                width={skin === "gold" ? 46 : 60}
                height={420}
                fill={`url(#${uid}-band)`}
              />
            </g>
          </g>
          {skin === "gold" &&
            GLINTS.map(([x, y, s, delay], i) => (
              <g key={i} transform={`translate(${x} ${y}) scale(${s})`}>
                <path className="owl-fx-twinkle" style={anim(2.4, delay)} d={SPARKLE} fill="#FFF8DC" />
              </g>
            ))}
          {skin === "frost" &&
            FLAKES.map(([x, y, s, delay], i) => (
              <g key={i} transform={`translate(${x} ${y}) scale(${s})`}>
                <path
                  className="owl-fx-fall"
                  style={anim(4.2 + (i % 3) * 0.6, delay)}
                  d={FLAKE}
                  stroke="#FFFFFF"
                  strokeWidth={2}
                  strokeLinecap="round"
                />
              </g>
            ))}
        </g>
      );
    case "inferno":
      return (
        <g data-part="skinFront" pointerEvents="none">
          {EMBERS.map(([x, y, r, delay], i) => (
            <g key={i} transform={`translate(${x} ${y})`}>
              <circle className="owl-fx-rise" style={anim(2.2 + (i % 3) * 0.5, delay)} r={r} fill={i % 2 ? "#FFD166" : "#FF8A3D"} />
            </g>
          ))}
        </g>
      );
    case "neon":
      return null;
    default:
      return null;
  }
}
