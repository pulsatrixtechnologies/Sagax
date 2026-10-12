// Which provisioner serves a person's server environment.
//
// `docker` is the GOX path: sagax-sandboxd talks to the local Docker socket
// (deploy/docker-compose.sandbox.yml). `kubernetes` is the portable pool in
// deploy/k8s/sandboxes/. This build's provisioner only implements docker, so
// selecting kubernetes fails closed instead of pretending the cutover worked.
// Rollback is SANDBOX_BACKEND=docker (docs/ops/sandboxes/cutover-rollback.md).

export const SANDBOX_BACKENDS = ["docker", "kubernetes"] as const;
export type SandboxBackend = (typeof SANDBOX_BACKENDS)[number];

const BOT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_CANARY_BOTS = 32;

export function sandboxBackendFromEnv(env: NodeJS.ProcessEnv = process.env): SandboxBackend {
  const raw = env.SANDBOX_BACKEND?.trim() || "docker";
  if (raw !== "docker" && raw !== "kubernetes") {
    throw new Error("SANDBOX_BACKEND must be docker or kubernetes");
  }
  return raw;
}

/** Bot ids whose environments use the Kubernetes pool while the process
 * default is still docker. Empty means no canary. A person's environment is
 * one backend, so the list must include every bot of that person. */
export function sandboxCanaryBotIds(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.SAGAX_SANDBOX_CANARY_BOTS?.trim() ?? "";
  if (!raw) return [];
  const ids = raw.split(",").map((id) => id.trim()).filter(Boolean);
  if (ids.length > MAX_CANARY_BOTS) throw new Error("SAGAX_SANDBOX_CANARY_BOTS lists more than 32 bots");
  for (const id of ids) {
    if (!BOT_ID_RE.test(id)) throw new Error("SAGAX_SANDBOX_CANARY_BOTS has an invalid bot id");
  }
  return [...new Set(ids)];
}

/** The process default wins. A canary bot uses kubernetes only while the
 * process is still on docker. SANDBOX_BACKEND=kubernetes sends every bot. */
export function sandboxBackendForBot(processBackend: SandboxBackend, canaryBotIds: readonly string[], botId: string): SandboxBackend {
  if (processBackend === "kubernetes") return "kubernetes";
  return canaryBotIds.includes(botId) ? "kubernetes" : "docker";
}

/** This image can only drive Docker. Call before opening the socket so a
 * kubernetes selection cannot look like a successful cutover. */
export function assertSandboxBackendSupported(backend: SandboxBackend): void {
  if (backend !== "docker") {
    throw new Error("sandboxd: SANDBOX_BACKEND=kubernetes but this build only drives Docker; set SANDBOX_BACKEND=docker to roll back");
  }
}
