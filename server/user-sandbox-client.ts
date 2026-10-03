// The Sagax server's side of the sandbox provisioner API (server/sandboxd.ts):
// signed requests on the internal control network. Holds no Docker access.
import { createHash } from "node:crypto";
import { request } from "node:http";
import type { Duplex } from "node:stream";

import { signSandboxdRequest, SANDBOXD_AUTH_HEADER } from "./sandboxd-auth.ts";
import type { SandboxExecInput, SandboxExecOutput, SandboxStats, SandboxStatus, SandboxStdioSpec } from "./sandboxd-core.ts";
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
  pause(key: string): Promise<SandboxStatus>;
  resume(key: string): Promise<SandboxStatus>;
  stats(key: string): Promise<SandboxStats>;
  remove(key: string, options?: { keepWorkspace?: boolean }): Promise<SandboxStatus>;
  exec(key: string, input: SandboxExecInput): Promise<SandboxExecOutput>;
  /** A byte stream to the VNC port of this sandbox's desktop (the live
   * view). Refused when the sandbox is not running. */
  desktopStream(key: string, options: { control: boolean }): Promise<Duplex>;
  /** The stdin and stdout of a person's MCP server command in this sandbox
   * (server/sandbox-stdio-mcp.ts). The command rides the stream's first
   * line; the signed path names its SHA-256. */
  stdioStream(key: string, spec: SandboxStdioSpec): Promise<Duplex>;
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
  /** A signed upgrade on `path`: the socket once the provisioner switched. */
  const upgrade = (path: string, protocol: string) => new Promise<Duplex>((resolve, reject) => {
    const req = request({
      hostname: base.hostname, port: base.port || 80, method: "POST", path, timeout: 15_000,
      headers: { connection: "Upgrade", upgrade: protocol, [SANDBOXD_AUTH_HEADER]: signSandboxdRequest(key(), "POST", path, "") },
    });
    req.on("upgrade", (_res, socket, head) => {
      socket.setTimeout(0);
      if (head.length) socket.unshift(head);
      resolve(socket);
    });
    req.on("response", (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => { if (chunks.length < 16) chunks.push(chunk); });
      res.on("end", () => {
        let code = "error";
        try { code = (JSON.parse(Buffer.concat(chunks).toString("utf8")) as { code?: string }).code ?? code; } catch { /* plain */ }
        reject(new SandboxdRequestError(res.statusCode ?? 502, code, `the provisioner answered ${res.statusCode}`));
      });
    });
    req.on("timeout", () => req.destroy(new Error("the provisioner did not answer")));
    req.on("error", reject);
    req.end();
  });
  return {
    stdioStream: async (sandboxKey, spec) => {
      const line = Buffer.from(JSON.stringify({ argv: spec.argv, env: spec.env ?? {} }));
      const digest = createHash("sha256").update(line).digest("hex");
      const socket = await upgrade(keyPath(sandboxKey, `/stdio?digest=${digest}`), "sagax-stdio");
      socket.write(Buffer.concat([line, Buffer.from("\n")]));
      return socket;
    },
    info: () => call<SandboxdInfo>("GET", "/v1/status"),
    status: (sandboxKey) => call<SandboxStatus>("GET", keyPath(sandboxKey)),
    ensure: (sandboxKey) => call<SandboxStatus>("POST", keyPath(sandboxKey, "/ensure"), {}, 180_000),
    stop: (sandboxKey) => call<SandboxStatus>("POST", keyPath(sandboxKey, "/stop"), {}),
    pause: (sandboxKey) => call<SandboxStatus>("POST", keyPath(sandboxKey, "/pause"), {}),
    resume: (sandboxKey) => call<SandboxStatus>("POST", keyPath(sandboxKey, "/resume"), {}),
    stats: (sandboxKey) => call<SandboxStats>("GET", keyPath(sandboxKey, "/stats"), undefined, 30_000),
    remove: (sandboxKey, options = {}) => call<SandboxStatus>("DELETE", keyPath(sandboxKey, options.keepWorkspace ? "?keepWorkspace=1" : "")),
    exec: (sandboxKey, input) => call<SandboxExecOutput>("POST", keyPath(sandboxKey, "/exec"), input, ((input.timeoutSec ?? 120) + 60) * 1000),
    desktopStream: (sandboxKey, options) => new Promise<Duplex>((resolve, reject) => {
      const path = keyPath(sandboxKey, `/desktop${options.control ? "?control=1" : ""}`);
      const req = request({
        hostname: base.hostname, port: base.port || 80, method: "POST", path, timeout: 15_000,
        headers: { connection: "Upgrade", upgrade: "sagax-rfb", [SANDBOXD_AUTH_HEADER]: signSandboxdRequest(key(), "POST", path, "") },
      });
      req.on("upgrade", (_res, socket, head) => {
        socket.setTimeout(0);
        if (head.length) socket.unshift(head);
        resolve(socket);
      });
      req.on("response", (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => { if (chunks.length < 16) chunks.push(chunk); });
        res.on("end", () => {
          let code = "error";
          try { code = (JSON.parse(Buffer.concat(chunks).toString("utf8")) as { code?: string }).code ?? code; } catch { /* plain */ }
          reject(new SandboxdRequestError(res.statusCode ?? 502, code, `the provisioner answered ${res.statusCode}`));
        });
      });
      req.on("timeout", () => req.destroy(new Error("the provisioner did not answer")));
      req.on("error", reject);
      req.end();
    }),
  };
}
