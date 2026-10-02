// Keeping a test's children honest about Sagax configuration.
//
// A shell that already exports SAGAX_* (or an old OMB_*, OPENMAUSBOT_* name) — a Sagax-hosted
// terminal, or a server running in another window — leaks those values into
// every child a suite spawns and into modules that snapshot process.env at
// import time. The suite then asserts against a "configured" runtime the test
// itself never set up (#1676). Strip the ambient values here; each test sets
// exactly the keys it means to set, on top of a base that carries no
// Sagax configuration at all.

import { ENV_PREFIX, LEGACY_ENV_PREFIXES } from "../../electron/legacy-names.mjs";

const AMBIENT_PREFIXES = [ENV_PREFIX, ...LEGACY_ENV_PREFIXES] as const;

/** True for keys owned by the Sagax runtime (`SAGAX_*` and the old prefixes). */
export function isAmbientOmbKey(key: string): boolean {
  return AMBIENT_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/** Copy `env` without any `SAGAX_*` (or old-prefix) keys. */
export function stripOmbEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (!isAmbientOmbKey(key)) clean[key] = value;
  }
  return clean;
}

/**
 * Environment for a child process spawned by a test: the current environment
 * with ambient Sagax keys stripped, then `overrides` applied on top.
 *
 * The spread sits where `...process.env` used to, so a suite's own keys —
 * harness URL, tokens the stub validates, feature flags under test — are the
 * only Sagax configuration the child ever sees.
 */
export function childEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { ...stripOmbEnv(process.env), ...overrides };
}
