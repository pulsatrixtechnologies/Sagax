// APNs settings of this server, read once from the environment
// (docs/ios-push.md). Token-based authentication: one `.p8` key of the
// Apple Developer account, its Key ID and the Team ID sign a short JWT
// (./jwt.ts). An App Store Connect API key is also a `.p8` but it is NOT an
// APNs key: APNs refuses it with 403 InvalidProviderToken.
//
//   SAGAX_APNS_KEY_PATH      the .p8 file (PEM, PKCS#8 P-256), read-only mount
//   SAGAX_APNS_KEY_ID        10 characters, shown next to the key in the portal
//   SAGAX_APNS_TEAM_ID       10 characters (Pulsatrix: PP546MZVHZ)
//   SAGAX_APNS_BUNDLE_ID     the app's bundle id, the `apns-topic` (ca.pulsatrix.sagax)
//   SAGAX_APNS_ENVIRONMENT   sandbox | production (default production). A device
//                            registers with its own environment, which wins.
//
// Nothing here is logged except which variable is missing.
import { readFileSync } from "node:fs";

export type ApnsEnvironment = "sandbox" | "production";

export const APNS_HOSTS: Readonly<Record<ApnsEnvironment, string>> = Object.freeze({
  production: "api.push.apple.com",
  sandbox: "api.sandbox.push.apple.com",
});

export const DEFAULT_APNS_TEAM_ID = "PP546MZVHZ";
export const DEFAULT_APNS_BUNDLE_ID = "ca.pulsatrix.sagax";

export interface ApnsConfig {
  keyPem: string;
  keyId: string;
  teamId: string;
  bundleId: string;
  environment: ApnsEnvironment;
}

export type ApnsConfigResult =
  | { configured: true; config: ApnsConfig }
  | { configured: false; reason: string };

const APPLE_ID = /^[A-Z0-9]{10}$/;
const BUNDLE_ID = /^[A-Za-z0-9.-]{1,155}$/;

export function apnsEnvironment(value: string | undefined, fallback: ApnsEnvironment = "production"): ApnsEnvironment {
  const raw = value?.trim().toLowerCase();
  if (raw === "sandbox" || raw === "development") return "sandbox";
  if (raw === "production") return "production";
  return fallback;
}

/** Read the APNs settings. `readFile` is injected so tests never touch disk. */
export function readApnsConfig(
  env: NodeJS.ProcessEnv = process.env,
  readFile: (path: string) => string = (path) => readFileSync(path, "utf8"),
): ApnsConfigResult {
  const keyPath = env.SAGAX_APNS_KEY_PATH?.trim() ?? "";
  const keyId = env.SAGAX_APNS_KEY_ID?.trim().toUpperCase() ?? "";
  const teamId = (env.SAGAX_APNS_TEAM_ID?.trim() || DEFAULT_APNS_TEAM_ID).toUpperCase();
  const bundleId = env.SAGAX_APNS_BUNDLE_ID?.trim() || DEFAULT_APNS_BUNDLE_ID;
  const environment = apnsEnvironment(env.SAGAX_APNS_ENVIRONMENT);
  const missing: string[] = [];
  if (!keyPath) missing.push("SAGAX_APNS_KEY_PATH");
  if (!keyId) missing.push("SAGAX_APNS_KEY_ID");
  if (missing.length) return { configured: false, reason: `${missing.join(" and ")} not set` };
  if (!APPLE_ID.test(keyId)) return { configured: false, reason: "SAGAX_APNS_KEY_ID is not a 10 character Key ID" };
  if (!APPLE_ID.test(teamId)) return { configured: false, reason: "SAGAX_APNS_TEAM_ID is not a 10 character Team ID" };
  if (!BUNDLE_ID.test(bundleId)) return { configured: false, reason: "SAGAX_APNS_BUNDLE_ID is not a bundle id" };
  let keyPem: string;
  try {
    keyPem = readFile(keyPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "unreadable";
    return { configured: false, reason: `SAGAX_APNS_KEY_PATH could not be read (${code})` };
  }
  if (!/-----BEGIN PRIVATE KEY-----[\s\S]+-----END PRIVATE KEY-----/.test(keyPem)) {
    return { configured: false, reason: "SAGAX_APNS_KEY_PATH is not a .p8 private key (PEM, BEGIN PRIVATE KEY)" };
  }
  return { configured: true, config: { keyPem: keyPem.trim(), keyId, teamId, bundleId, environment } };
}

/** A device token or any secret, for a log line: its first and last 4
 * characters only. */
export function maskSecret(value: string): string {
  const clean = value.trim();
  if (clean.length <= 12) return "****";
  return `${clean.slice(0, 4)}****${clean.slice(-4)}`;
}
