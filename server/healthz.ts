import { HEALTH_IDENTITY } from "../electron/legacy-names.mjs";

/** `GET /healthz` for deploy probes and `docker exec`. Registered before
 * the SPA fallback: a path with no file is index.html. Loopback has a
 * session, so this must not wait on `!gate.auth` the way the public
 * `/api/health` stranger probe does. */
export function healthzBody(): { ok: true; app: string; product: string } {
  return { ok: true, ...HEALTH_IDENTITY };
}
