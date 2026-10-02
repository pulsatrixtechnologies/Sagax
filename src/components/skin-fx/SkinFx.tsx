// The premium skins' one-shot bursts, drawn over a character in its own
// 0..100 box: the equip animation (a skin just chosen) and the move effects
// (Wave, Dance, Jump, Hop, Cuddle, Hoot), each in the skin's own particles,
// colors and trails. Transform and opacity keyframes only (skin-fx.css); the
// caller leaves them out under reduced motion and at small sizes.
import "./skin-fx.css";
import type { ReactNode } from "react";
import type { FxMove, FxPalette, FxParticle } from "./skin-fx";

const STAR = "M0 -5L1.2 -1.2L5 0L1.2 1.2L0 5L-1.2 1.2L-5 0L-1.2 -1.2Z";
const HEART = "M0 3.6C-4.6 0.4 -6 -2 -4.4 -4C-3 -5.6 -0.9 -5 0 -3.4C0.9 -5 3 -5.6 4.4 -4C6 -2 4.6 0.4 0 3.6Z";
const SPLAT = "M0 -3.2C1.6 -3.6 3.4 -2 3 -0.2C4.4 0.6 3.2 3 1.4 2.6C0.6 4 -1.8 3.6 -2 2C-3.8 1.8 -3.8 -0.6 -2.2 -1.2C-2.6 -2.8 -1.2 -3.4 0 -3.2Z";

/** One particle of a skin, centered on 0,0. */
export function FxParticleShape({ kind, color, scale = 1 }: { kind: FxParticle; color: string; scale?: number }) {
  const s = scale;
  switch (kind) {
    case "spark":
    case "star":
      return <path d={STAR} fill={color} transform={`scale(${(kind === "star" ? 0.8 : 1) * s})`} />;
    case "ember":
      return <circle r={1.7 * s} fill={color} />;
    case "shard":
      return <path d="M0 -4.2L2 0L0 4.2L-2 0Z" fill={color} transform={`scale(${s})`} />;
    case "bit":
      return <rect x={-1.6 * s} y={-1.6 * s} width={3.2 * s} height={3.2 * s} fill={color} />;
    case "splat":
      return <path d={SPLAT} fill={color} transform={`scale(${s})`} />;
    case "streak":
      return <rect x={-0.8 * s} y={-4 * s} width={1.6 * s} height={8 * s} rx={0.8 * s} fill={color} />;
    default:
      return <circle r={1.8 * s} fill={color} />;
  }
}

/** Where a burst's particles fly: angle (deg, 0 up, clockwise) and distance. */
const BURST: [number, number][] = [
  [0, 30], [45, 26], [90, 32], [135, 26], [180, 22], [225, 26], [270, 32], [315, 26],
];

function Burst({ cx, cy, palette, count = 8, className = "fx-burst", spread = 1 }: { cx: number; cy: number; palette: FxPalette; count?: number; className?: string; spread?: number }) {
  return (
    <g transform={`translate(${cx} ${cy})`}>
      {BURST.slice(0, count).map(([angle, dist], index) => {
        const rad = (angle * Math.PI) / 180;
        const dx = Math.sin(rad) * dist * spread;
        const dy = -Math.cos(rad) * dist * spread;
        return (
          <g key={angle} className={className} style={{ ["--fx-dx" as string]: `${dx.toFixed(1)}px`, ["--fx-dy" as string]: `${dy.toFixed(1)}px`, animationDelay: `${(index % 3) * 40}ms` }}>
            <g transform={palette.particle === "streak" ? `rotate(${angle})` : undefined}>
              <FxParticleShape kind={palette.particle} color={index % 2 ? palette.b : palette.a} />
            </g>
          </g>
        );
      })}
    </g>
  );
}

function FxSvg({ children, uid, palette, className }: { children: ReactNode; uid: string; palette: FxPalette; className: string }) {
  return (
    <svg className={`skin-fx-overlay ${className}`} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      {palette.glow && (
        <defs>
          <filter id={`${uid}-fxglow`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
      )}
      <g filter={palette.glow ? `url(#${uid}-fxglow)` : undefined}>{children}</g>
    </svg>
  );
}

/** The equip animation: a ring, a burst of the skin's particles and a light sweep. */
export function EquipFx({ palette, uid }: { palette: FxPalette; uid: string }) {
  return (
    <FxSvg uid={uid} palette={palette} className="fx-equip" >
      <circle className="fx-ring" cx={50} cy={56} r={30} fill="none" stroke={palette.a} strokeWidth={2.4} />
      <circle className="fx-ring fx-ring-late" cx={50} cy={56} r={30} fill="none" stroke={palette.b} strokeWidth={1.2} />
      <Burst cx={50} cy={56} palette={palette} />
    </FxSvg>
  );
}

/** Afterimages of the body for skins that leave light trails. */
function Trail({ path, palette, axis }: { path: string; palette: FxPalette; axis: "y" | "x" }) {
  return (
    <g className={`fx-trail fx-trail-${axis}`}>
      {[1, 2, 3].map((n) => (
        <path key={n} className={`fx-ghost fx-ghost-${n}`} d={path} fill="none" stroke={n === 1 ? palette.a : palette.b} strokeWidth={2.2 - n * 0.4} strokeLinejoin="round" />
      ))}
    </g>
  );
}

/**
 * A move's effect: Jump leaves streaks and a landing shockwave, Hop dust and a
 * ring, Wave a swoosh, Dance orbiting motes and a floor glow, Cuddle hearts,
 * Hoot sound rings. `path` (the body outline, shapes only) adds afterimages.
 */
export function MoveFx({ move, palette, uid, path }: { move: FxMove; palette: FxPalette; uid: string; path?: string }) {
  const { a, b } = palette;
  let body: ReactNode = null;
  switch (move) {
    case "jump":
      body = (
        <>
          {[34, 50, 66].map((x, i) => (
            <rect key={x} className="fx-streak" x={x - 0.9} y={78} width={1.8} height={16} rx={0.9} fill={i === 1 ? b : a} style={{ animationDelay: `${i * 60}ms` }} />
          ))}
          <ellipse className="fx-shock" cx={50} cy={96} rx={26} ry={5} fill="none" stroke={a} strokeWidth={2} />
          <ellipse className="fx-shock fx-shock-late" cx={50} cy={96} rx={26} ry={5} fill="none" stroke={b} strokeWidth={1} />
          <Burst cx={50} cy={94} palette={palette} count={6} className="fx-land" spread={0.7} />
        </>
      );
      break;
    case "hop":
      body = (
        <>
          {[0, 1].map((hop) =>
            [-1, 1].map((side) => (
              <g key={`${hop}${side}`} className="fx-dust" style={{ animationDelay: `${hop * 760}ms`, ["--fx-dx" as string]: `${side * 10}px` }} transform={`translate(${50 + side * 18} 95)`}>
                <FxParticleShape kind={palette.particle === "streak" ? "dot" : palette.particle} color={side > 0 ? a : b} scale={1.3} />
              </g>
            )),
          )}
          <ellipse className="fx-shock fx-shock-small" cx={50} cy={96} rx={18} ry={3.6} fill="none" stroke={a} strokeWidth={1.6} />
        </>
      );
      break;
    case "wave":
      body = (
        <>
          <path className="fx-swoosh" d="M80 24A34 34 0 0 1 90 66" pathLength={100} fill="none" stroke={a} strokeWidth={3} strokeLinecap="round" />
          <path className="fx-swoosh fx-swoosh-late" d="M86 18A40 40 0 0 1 97 62" pathLength={100} fill="none" stroke={b} strokeWidth={1.4} strokeLinecap="round" />
          {[[88, 30], [94, 46], [90, 62]].map(([x, y], i) => (
            <g key={y} className="fx-pop" style={{ animationDelay: `${150 + i * 120}ms` }} transform={`translate(${x} ${y})`}>
              <FxParticleShape kind={palette.particle} color={i % 2 ? b : a} scale={0.9} />
            </g>
          ))}
        </>
      );
      break;
    case "dance":
      body = (
        <>
          <ellipse className="fx-floor" cx={50} cy={96} rx={30} ry={5} fill={a} />
          <g className="fx-orbit">
            {[0, 90, 180, 270].map((angle, i) => (
              <g key={angle} transform={`rotate(${angle} 50 56) translate(50 14)`}>
                <FxParticleShape kind={palette.particle} color={i % 2 ? b : a} scale={1.1} />
              </g>
            ))}
          </g>
        </>
      );
      break;
    case "love":
      body = (
        <>
          {[[38, 22, 0], [62, 16, 220], [50, 8, 440]].map(([x, y, delay], i) => (
            <g key={x} className="fx-heart" style={{ animationDelay: `${delay}ms` }} transform={`translate(${x} ${y})`}>
              <path d={HEART} fill={i === 1 ? b : a} transform="scale(1.2)" />
            </g>
          ))}
          <Burst cx={50} cy={50} palette={palette} count={4} className="fx-burst fx-burst-soft" spread={0.9} />
        </>
      );
      break;
    case "hoot":
      body = (
        <>
          {[0, 1, 2].map((n) => (
            <circle key={n} className="fx-sound" cx={50} cy={24} r={12} fill="none" stroke={n === 1 ? b : a} strokeWidth={1.8} style={{ animationDelay: `${n * 260}ms` }} />
          ))}
        </>
      );
      break;
  }
  return (
    <FxSvg uid={uid} palette={palette} className={`fx-move fx-move-${move}`}>
      {palette.trail && path && (move === "jump" || move === "hop") && <Trail path={path} palette={palette} axis="y" />}
      {palette.trail && path && (move === "wave" || move === "dance") && <Trail path={path} palette={palette} axis="x" />}
      {body}
    </FxSvg>
  );
}
