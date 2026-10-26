// Azure Trusted Signing (Artifact Signing) for the Windows packages, used by
// package-fork.mjs (preflight) and scripts/win-sign-trusted.cjs (the
// electron-builder sign hook). jsign does the signing from macOS.
//
// Nothing about the signing account lives in this repository: the build reads
// it from the environment.
//
//   SAGAX_WIN_SIGN_ENDPOINT   regional endpoint host, e.g. eus.codesigning.azure.net
//   SAGAX_WIN_SIGN_ACCOUNT    Trusted Signing account name
//   SAGAX_WIN_SIGN_PROFILE    certificate profile name in that account
//   SAGAX_WIN_SIGN_TENANT     Entra tenant the az login must be in
//   SAGAX_WIN_SIGN_PUBLISHER  expected signer CN (checked by verify-win-signatures.mjs)
//   AZURE_CONFIG_DIR          optional, the az profile that holds the login
//
// The access token is requested once per build, kept in memory only and
// handed to jsign through its environment (--storepass env:...), never on a
// command line, in a file or in a log.
import { spawnSync } from "node:child_process";
import { basename, sep } from "node:path";

export const TIMESTAMP_URL = "http://timestamp.acs.microsoft.com";
const RESOURCE = "https://codesigning.azure.net";
const TOKEN_ENV = "SAGAX_WIN_SIGN_JSIGN_STOREPASS";
const REQUIRED = ["SAGAX_WIN_SIGN_ENDPOINT", "SAGAX_WIN_SIGN_ACCOUNT", "SAGAX_WIN_SIGN_PROFILE", "SAGAX_WIN_SIGN_TENANT", "SAGAX_WIN_SIGN_PUBLISHER"];

// Third-party executables shipped as their vendor built them: the browser
// engine, cloudflared and tailcat (after-pack checks their bytes against a
// pinned digest, so signing would fail the package) and the Android platform
// tools (signed by their vendor). They keep their vendor signature, if any.
const VENDOR_DIRS = ["browser-engine", "cloudflared", "tailcat", "android-platform-tools"].map((name) => `${sep}resources${sep}${name}${sep}`);
export const isVendorExecutable = (file) => VENDOR_DIRS.some((dir) => file.includes(dir));

export class SigningSetupError extends Error {}

/** The signing settings from the environment, or a clear error naming what is missing. */
export function signingConfig(env = process.env) {
  const missing = REQUIRED.filter((name) => !env[name]?.trim());
  if (missing.length) {
    throw new SigningSetupError(
      `Windows signing is required for this build and is not configured: set ${missing.join(", ")} (docs/releasing.md, Windows signing).`,
    );
  }
  const endpoint = env.SAGAX_WIN_SIGN_ENDPOINT.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return {
    endpoint,
    account: env.SAGAX_WIN_SIGN_ACCOUNT.trim(),
    profile: env.SAGAX_WIN_SIGN_PROFILE.trim(),
    tenant: env.SAGAX_WIN_SIGN_TENANT.trim(),
    publisher: env.SAGAX_WIN_SIGN_PUBLISHER.trim(),
  };
}

function az(args) {
  const result = spawnSync("az", [...args, "--only-show-errors"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: process.env });
  if (result.error?.code === "ENOENT") throw new SigningSetupError("Windows signing needs the Azure CLI (az), which is not installed.");
  return result;
}

/** Fail before packaging when jsign or the az login is not usable. Prints no token. */
export function preflight(config = signingConfig()) {
  const jsign = spawnSync("jsign", ["--help"], { stdio: "ignore" });
  if (jsign.error) throw new SigningSetupError("Windows signing needs jsign (brew install jsign), which is not installed.");
  const account = az(["account", "show", "--query", "tenantId", "-o", "tsv"]);
  if (account.status !== 0) {
    throw new SigningSetupError(`Windows signing: az is not signed in${process.env.AZURE_CONFIG_DIR ? " in AZURE_CONFIG_DIR" : ""}. Run az login --tenant "$SAGAX_WIN_SIGN_TENANT", then build again.`);
  }
  if (account.stdout.trim() !== config.tenant) {
    throw new SigningSetupError("Windows signing: the az login is in another tenant than SAGAX_WIN_SIGN_TENANT. Switch the az profile (AZURE_CONFIG_DIR) or log in to that tenant.");
  }
  // Proves the login can still mint a code signing token; only the expiry is read.
  const probe = az(["account", "get-access-token", "--resource", RESOURCE, "--tenant", config.tenant, "--query", "expires_on", "-o", "tsv"]);
  if (probe.status !== 0) {
    throw new SigningSetupError(`Windows signing: az could not get a code signing token (${probe.stderr.trim().split("\n")[0] || "no detail"}). Run az login --tenant "$SAGAX_WIN_SIGN_TENANT", then build again.`);
  }
  return config;
}

let cached = null;

/** One token per build process; refused when it is about to expire. */
function accessToken(config) {
  if (!cached) {
    const result = az(["account", "get-access-token", "--resource", RESOURCE, "--tenant", config.tenant, "--query", "{token:accessToken,expires:expires_on}", "-o", "json"]);
    if (result.status !== 0) throw new SigningSetupError("Windows signing: az could not get a code signing token. Run az login, then build again.");
    const parsed = JSON.parse(result.stdout);
    if (!parsed.token) throw new SigningSetupError("Windows signing: az returned no code signing token.");
    cached = { token: parsed.token, expires: Number(parsed.expires) * 1000 };
  }
  if (Number.isFinite(cached.expires) && cached.expires - Date.now() < 120_000) {
    throw new SigningSetupError("Windows signing: the code signing token expired during the build. Build again.");
  }
  return cached.token;
}

/** Sign one PE file in place with the Trusted Signing profile (SHA-256, RFC 3161 timestamp). */
export function signFile(file, config = signingConfig()) {
  const token = accessToken(config);
  const args = [
    "--storetype", "TRUSTEDSIGNING",
    "--keystore", config.endpoint,
    "--storepass", `env:${TOKEN_ENV}`,
    "--alias", `${config.account}/${config.profile}`,
    "--alg", "SHA-256",
    "--tsaurl", TIMESTAMP_URL,
    "--tsmode", "RFC3161",
    "--replace",
    file,
  ];
  let last = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = spawnSync("jsign", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, [TOKEN_ENV]: token },
    });
    if (result.status === 0) return;
    // jsign never echoes the store password; keep only its first error line.
    last = (result.stderr || result.stdout || "").trim().split("\n")[0] ?? "";
    if (attempt < 3) spawnSync("sleep", [String(attempt * 5)]);
  }
  throw new Error(`Windows signing failed for ${basename(file)}: ${last || "jsign exited with an error"}`);
}
