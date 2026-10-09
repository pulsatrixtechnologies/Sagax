// The HTTP/2 call to APNs (Node's built-in http2, no dependency). One
// session per APNs host, kept open and reused as Apple asks; a session that
// errors or gets GOAWAY is dropped and the next send opens a new one.
//
// This is the only outbound call of the push feature, and it is made by the
// server only (scripts/check-no-phone-home.mjs allows the APNs hosts in
// dist-server/ and nowhere else: never from the desktop app).
import { connect, constants, type ClientHttp2Session } from "node:http2";

import { APNS_HOSTS, maskSecret, type ApnsConfig, type ApnsEnvironment } from "./config.ts";
import { apnsPrivateKey, ProviderTokenCache } from "./jwt.ts";
import type { ApnsRequest } from "./payload.ts";

export interface ApnsResponse {
  status: number;
  /** APNs's `reason` on a failure (BadDeviceToken, Unregistered, ...). */
  reason?: string;
}

export type ApnsTransport = (input: {
  host: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}) => Promise<ApnsResponse>;

const REQUEST_TIMEOUT_MS = 10_000;

/** The real transport. `close()` ends every open session (shutdown, tests). */
export function createHttp2Transport(options: { timeoutMs?: number } = {}): ApnsTransport & { close(): void } {
  const sessions = new Map<string, ClientHttp2Session>();
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;

  const sessionFor = (host: string): ClientHttp2Session => {
    const open = sessions.get(host);
    if (open && !open.closed && !open.destroyed) return open;
    const session = connect(`https://${host}:443`);
    const drop = () => { if (sessions.get(host) === session) sessions.delete(host); };
    session.on("error", drop);
    session.on("goaway", drop);
    session.on("close", drop);
    // an idle session must not keep the process alive
    session.unref();
    sessions.set(host, session);
    return session;
  };

  const transport = ((input) => new Promise<ApnsResponse>((resolve, reject) => {
    let session: ClientHttp2Session;
    try {
      session = sessionFor(input.host);
    } catch (error) {
      reject(error);
      return;
    }
    const request = session.request({
      [constants.HTTP2_HEADER_METHOD]: "POST",
      [constants.HTTP2_HEADER_PATH]: input.path,
      "content-type": "application/json",
      ...input.headers,
    });
    let status = 0;
    const chunks: Buffer[] = [];
    request.setTimeout(timeoutMs, () => request.close(constants.NGHTTP2_CANCEL));
    request.on("response", (headers) => { status = Number(headers[constants.HTTP2_HEADER_STATUS] ?? 0); });
    request.on("data", (chunk: Buffer) => { if (chunks.length < 16) chunks.push(chunk); });
    request.on("error", reject);
    request.on("close", () => {
      if (!status) {
        reject(new Error("APNs closed the request without an answer"));
        return;
      }
      let reason: string | undefined;
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { reason?: unknown };
        if (typeof parsed.reason === "string") reason = parsed.reason;
      } catch {
        /* a 200 has an empty body */
      }
      resolve({ status, ...(reason ? { reason } : {}) });
    });
    request.end(input.body);
  })) as ApnsTransport & { close(): void };
  transport.close = () => {
    for (const session of sessions.values()) session.close();
    sessions.clear();
  };
  return transport;
}

export type SendOutcome =
  | { ok: true }
  | { ok: false; status: number; reason: string; prune: boolean };

/** Reasons that mean this token will never work again for this app. */
const DEAD_TOKEN_REASONS = new Set(["BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic"]);

export interface ApnsLog {
  info(line: string): void;
  warn(line: string): void;
}

/** Sends one prepared request to one device token. */
export class ApnsSender {
  private readonly tokens: ProviderTokenCache;
  private readonly transport: ApnsTransport;
  private readonly log: ApnsLog;
  private providerWarned = false;

  constructor(input: { config: ApnsConfig; transport: ApnsTransport; now?: () => number; log: ApnsLog }) {
    this.transport = input.transport;
    this.log = input.log;
    this.tokens = new ProviderTokenCache({ key: apnsPrivateKey(input.config.keyPem), keyId: input.config.keyId, teamId: input.config.teamId, now: input.now });
  }

  async send(device: { token: string; environment: ApnsEnvironment }, request: ApnsRequest): Promise<SendOutcome> {
    const attempt = () => this.transport({
      host: APNS_HOSTS[device.environment],
      path: `/3/device/${device.token}`,
      headers: { ...request.headers, authorization: `bearer ${this.tokens.current()}` },
      body: request.body,
    });
    let response: ApnsResponse;
    try {
      response = await attempt();
      if (response.status === 403 && response.reason === "ExpiredProviderToken") {
        this.tokens.invalidate();
        response = await attempt();
      }
    } catch (error) {
      this.log.warn(`push: APNs ${device.environment} unreachable for ${maskSecret(device.token)} (${error instanceof Error ? error.message : String(error)})`);
      return { ok: false, status: 0, reason: "unreachable", prune: false };
    }
    if (response.status === 200) return { ok: true };
    const reason = response.reason ?? "unknown";
    const prune = response.status === 410 || (response.status === 400 && DEAD_TOKEN_REASONS.has(reason));
    if (response.status === 403 && reason === "InvalidProviderToken") {
      if (!this.providerWarned) {
        this.providerWarned = true;
        this.log.warn(`push: APNs refused the provider token (403 InvalidProviderToken). Check SAGAX_APNS_KEY_ID and SAGAX_APNS_TEAM_ID, and that the .p8 is an APNs key (Apple Developer, Keys), not an App Store Connect API key.`);
      }
    } else if (!prune) {
      this.log.warn(`push: APNs ${device.environment} answered ${response.status} ${reason} for ${maskSecret(device.token)}`);
    }
    return { ok: false, status: response.status, reason, prune };
  }
}
