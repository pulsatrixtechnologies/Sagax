// The Sagax server's side of the sandbox provisioner API (server/sandboxd.ts):
// signed requests on the internal control network. Holds no Docker access.
import { signSandboxdRequest, SANDBOXD_AUTH_HEADER } from "./sandboxd-auth.ts";
import type { SandboxExecInput, SandboxExecOutput, SandboxStatus } from "./sandboxd-core.ts";
import { SANDBOX_KEY_RE } from "./user-sandbox-spec.ts";

export interface SandboxdInfo {
  instance: string;
  egress: "enforced" | "missing" | "not-required";
  maxRunning: number;
  idleMinutes: number;
}

export class SandboxdRequestError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface SandboxdClient {
  info(): Promise<SandboxdInfo>;
  status(key: string): Promise<SandboxStatus>;
  ensure(key: string): Promise<SandboxStatus>;
  stop(key: string): Promise<SandboxStatus>;
  remove(key: string, options?: { keepWorkspace?: boolean }): Promise<SandboxStatus>;
  exec(key: string, input: SandboxExecInput): Promise<SandboxExecOutput>;
}

/** Only plain http to a host on the internal network: no credentials in the
 * URL, no path, no query. */
export function validSandboxdUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "http:" || url.username || url.password || (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) {
    throw new Error("SAGAX_SANDBOXD_URL must be http://<host>:<port> on the internal network");
  }
  return url;
}

export function sandboxdClient(baseUrl: string, key: () => string, fetchImpl: typeof fetch = fetch): SandboxdClient {
  const base = validSandboxdUrl(baseUrl);
  const call = async <T>(method: string, path: string, body?: unknown, timeoutMs = 120_000): Promise<T> => {
    const text = body === undefined ? "" : JSON.stringify(body);
    const response = await fetchImpl(new URL(path, base), {
      method,
      redirect: "error",
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        [SANDBOXD_AUTH_HEADER]: signSandboxdRequest(key(), method, path, text),
      },
      ...(body === undefined ? {} : { body: text }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const payload = await response.json().catch(() => ({})) as { error?: string; code?: string };
    if (!response.ok) throw new SandboxdRequestError(response.status, payload.code ?? "error", payload.error ?? `the provisioner answered ${response.status}`);
    return payload as T;
  };
  const keyPath = (sandboxKey: string, suffix = "") => {
    if (!SANDBOX_KEY_RE.test(sandboxKey)) throw new Error("invalid sandbox key");
    return `/v1/sandboxes/${sandboxKey}${suffix}`;
  };
  return {
    info: () => call<SandboxdInfo>("GET", "/v1/status"),
    status: (sandboxKey) => call<SandboxStatus>("GET", keyPath(sandboxKey)),
    ensure: (sandboxKey) => call<SandboxStatus>("POST", keyPath(sandboxKey, "/ensure"), {}, 180_000),
    stop: (sandboxKey) => call<SandboxStatus>("POST", keyPath(sandboxKey, "/stop"), {}),
    remove: (sandboxKey, options = {}) => call<SandboxStatus>("DELETE", keyPath(sandboxKey, options.keepWorkspace ? "?keepWorkspace=1" : "")),
    exec: (sandboxKey, input) => call<SandboxExecOutput>("POST", keyPath(sandboxKey, "/exec"), input, ((input.timeoutSec ?? 120) + 60) * 1000),
  };
}
