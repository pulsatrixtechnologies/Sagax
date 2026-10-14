// Pinned CPython series for the server image and Hermes (lock source
// v2026.9.24: requires-python >=3.11,<3.14). 3.14 is outside that range.
export const HERMES_REQUIRES_PYTHON = ">=3.11,<3.14";
export const PINNED_PYTHON_SERIES = [3, 13];
export const PINNED_PYTHON_VERSION = "3.13.5";
export const PINNED_PYTHON_BIN = "python3.13";
export const PINNED_PYTHON_APT = [
  "python3.13=3.13.5-2+deb13u5",
  "python3.13-venv=3.13.5-2+deb13u5",
];

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?$/.exec(String(value ?? "").trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

function cmp(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/**
 * Accepts a comma-separated PEP 440 lower/upper bound pair
 * (`>=3.11,<3.14`). Enough to prove the pinned series can install Hermes.
 */
export function versionSatisfies(version, spec) {
  const parsed = parseVersion(version);
  if (!parsed) return false;
  const parts = String(spec ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return false;
  for (const part of parts) {
    const match = /^(>=|>|<=|<|==)\s*(\d+\.\d+(?:\.\d+)?)$/.exec(part);
    if (!match) return false;
    const bound = parseVersion(match[2]);
    if (!bound) return false;
    const order = cmp(parsed, bound);
    if (match[1] === ">=" && order < 0) return false;
    if (match[1] === ">" && order <= 0) return false;
    if (match[1] === "<=" && order > 0) return false;
    if (match[1] === "<" && order >= 0) return false;
    if (match[1] === "==" && order !== 0) return false;
  }
  return true;
}

export function pinnedSeriesSatisfiesHermes() {
  return versionSatisfies(PINNED_PYTHON_VERSION, HERMES_REQUIRES_PYTHON);
}
