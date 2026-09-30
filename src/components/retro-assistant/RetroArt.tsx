// Small props the owl plays with, all drawn here in chunky pixel SVG: a light
// bulb for a waiting tip, a notebook and pencil for busy moments, a letter
// that flies off on send, floating Z's, tap marks and a farewell puff.

const crisp = { shapeRendering: "crispEdges" as const };

export function BulbIcon({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 20" width={size} height={(size * 20) / 16} style={crisp} aria-hidden="true">
      {/* rays */}
      <path d="M1 3h2v1H1zM13 3h2v1h-2zM7 0h2v1H7zM0 8h2v1H0zM14 8h2v1h-2z" fill="#806000" />
      {/* glass */}
      <path d="M5 2h6v1h1v1h1v5h-1v1h-1v2H5v-2H4V9H3V4h1V3h1z" fill="#000" />
      <path d="M5 3h6v1h1v5h-1v1h-1v1H6v-1H5V9H4V4h1z" fill="#ffff66" />
      <path d="M5 4h2v1H6v2H5z" fill="#ffffff" />
      <path d="M10 8h1v1h-1v1H9V9h1z" fill="#e0c000" />
      {/* base */}
      <path d="M5 12h6v1H5zM5 14h6v1H5zM6 16h4v1H6z" fill="#000" />
      <path d="M5 13h6v1H5zM6 15h4v1H6z" fill="#a0a0a0" />
      <path d="M7 17h2v1H7z" fill="#000" />
    </svg>
  );
}

/** The busy notebook: lined page, a scribble that writes itself, a pencil. */
export function Notebook() {
  return (
    <svg className="r98-notebook" viewBox="0 0 34 26" width="44" height="34" aria-hidden="true">
      <g style={crisp}>
        <rect x="1" y="3" width="28" height="22" fill="#000" />
        <rect x="2" y="4" width="26" height="20" fill="#ffffff" />
        <path d="M2 9h26v1H2zM2 13h26v1H2zM2 17h26v1H2zM2 21h26v1H2z" fill="#9ec5ff" />
        <path d="M6 4h1v20H6z" fill="#ff8080" />
        <path d="M4 2h2v3H4zM10 2h2v3h-2zM16 2h2v3h-2zM22 2h2v3h-2z" fill="#606060" />
      </g>
      <path className="r98-scribble" d="M9 12c2-2 3 1 5-1s3 1 5-1 3 1 5-1M9 16c2-2 3 1 5-1s3 1 4-1" fill="none" stroke="#000080" strokeWidth="1.2" strokeLinecap="round" />
      <g className="r98-pencil" style={crisp}>
        <path d="M26 6l6-6h2v2l-6 6z" fill="#e8b020" />
        <path d="M26 6l2 2-3 1z" fill="#f0d8a8" />
        <path d="M32 0h2v2z" fill="#ff8080" />
      </g>
    </svg>
  );
}

export function Envelope() {
  return (
    <svg viewBox="0 0 20 14" width="30" height="21" style={crisp} aria-hidden="true">
      <rect x="0" y="0" width="20" height="14" fill="#000" />
      <rect x="1" y="1" width="18" height="12" fill="#ffffe1" />
      <path d="M1 1h2v1h2v1h2v1h2v1h2V4h2V3h2V2h2V1h2v1h-1v1h-2v1h-2v1h-2v1H9V5H7V4H5V3H3V2H1z" fill="#000" />
      <rect x="9" y="7" width="2" height="2" fill="#c00000" />
    </svg>
  );
}

export function Zzz() {
  return (
    <span className="r98-zzz" aria-hidden="true">
      <span>z</span>
      <span>z</span>
      <span>Z</span>
    </span>
  );
}

export function TapMarks() {
  return (
    <span className="r98-tap" aria-hidden="true">
      <span />
      <span />
    </span>
  );
}

export function Puff() {
  return (
    <span className="r98-puff" aria-hidden="true">
      {Array.from({ length: 8 }, (_, i) => (
        <span key={i} style={{ ["--i" as string]: i }}>
          <svg viewBox="0 0 5 5" width="10" height="10" style={crisp}>
            <path d="M2 0h1v2h2v1H3v2H2V3H0V2h2z" fill={i % 2 ? "#ffff66" : "#ffffff"} stroke="#000" strokeWidth="0.3" />
          </svg>
        </span>
      ))}
    </span>
  );
}

/** The window icon in our dialogs: a tiny owl face, not a product mark. */
export function OwlFaceIcon() {
  return (
    <svg viewBox="0 0 8 8" width="14" height="14" style={crisp} aria-hidden="true">
      <path d="M1 0h1v1h4V0h1v2h1v5H7v1H1V7H0V2h1z" fill="#6b4a2b" />
      <path d="M1 2h3v3H1zM4 2h3v3H4z" fill="#ffffff" />
      <path d="M2 3h1v1H2zM5 3h1v1H5z" fill="#000" />
      <path d="M3 5h2v1H3z" fill="#e8b020" />
    </svg>
  );
}
