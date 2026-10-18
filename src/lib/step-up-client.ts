// The app's side of security keys (shared/step-up.ts, server/routes/security-keys.ts):
// start a ceremony, ask the browser for the key (WebAuthn), and post its
// answer. In the desktop app the ceremony page opens in the system browser
// instead (electron/security-key-browser.mjs): Electron cannot ask Touch ID,
// a passkey or a key's PIN. That page posts the answer itself; this side
// asks the ceremony's status until it ends. Nothing here decides anything:
// the server verifies.
//
// No import of the store: the store's `api` calls `stepUpForRefusal` when
// a route refuses with `step_up_required`, then sends the request again.

import { t } from "@/lib/i18n";
import { usableRpId, type StepUpTarget } from "../../shared/step-up";

interface CeremonyStart {
  ceremonyId: string;
  kind: "register" | "assert";
  rpId: string;
  options: Record<string, any>;
  expiresAt: number;
  pageUrl: string;
}

/** A ceremony that did not end with a verified key, in the person's words. */
export class StepUpError extends Error {
  readonly code: string;
  constructor(code: string, message?: string) {
    super(message ?? stepUpMessage(code));
    this.name = "StepUpError";
    this.code = code;
  }
}

export function stepUpMessage(code: string): string {
  switch (code) {
    case "cancelled": return t("security.stepUp.cancelled");
    case "expired": return t("security.stepUp.expired");
    case "no_key": return t("security.stepUp.noKey");
    case "no_rp": return t("security.stepUp.noAddress");
    case "unsupported": return t("security.stepUp.unsupported");
    case "busy": return t("security.stepUp.busy");
    case "browser": return t("security.stepUp.browser");
    case "reauth_required": return t("security.stepUp.reauth");
    default: return t("security.stepUp.failed");
  }
}

const b64 = (buffer: ArrayBuffer | ArrayBufferView): string => {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const unb64 = (text: string): Uint8Array<ArrayBuffer> => {
  const normal = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normal + "===".slice((normal.length + 3) % 4));
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index++) out[index] = binary.charCodeAt(index);
  return out;
};

/** Whether this page may run WebAuthn itself (its address can be an RP ID). */
function pageCanAsk(): boolean {
  if (typeof window === "undefined" || !window.PublicKeyCredential || !navigator.credentials) return false;
  return usableRpId(location.hostname, location.protocol) !== null && window.isSecureContext;
}

/** The desktop app's bridge, when this page is the desktop's own UI. */
function desktopKeys(): NonNullable<NonNullable<Window["ogb"]>["securityKey"]> | null {
  return typeof window !== "undefined" && window.ogb?.securityKey?.open ? window.ogb.securityKey : null;
}

/** Which address the server makes the key for: this page's own, or, for
 * the desktop's local page on 127.0.0.1, localhost. */
function via(): "page" | "desktop-window" {
  return !pageCanAsk() && desktopKeys() ? "desktop-window" : "page";
}

/** Whether this app can use a security key here at all. */
export function securityKeysUsable(): boolean {
  return pageCanAsk() || Boolean(desktopKeys());
}

/** Whether the key is asked in the system browser (the desktop app). */
export function securityKeyInBrowser(): boolean {
  return Boolean(desktopKeys());
}

const STATUS_EVERY_MS = 1_000;

/** Ask the server how a ceremony run elsewhere (the system browser) ended,
 * until it does, it expires, or `signal` stops the wait. */
export async function waitForCeremony(ceremonyId: string, expiresAt: number, signal?: AbortSignal, every = STATUS_EVERY_MS): Promise<"done" | "failed" | "expired" | "cancelled"> {
  // a little past the server's own end, so its answer decides
  const until = expiresAt + 5_000;
  for (;;) {
    if (signal?.aborted) return "cancelled";
    try {
      const response = await fetch(`/api/security-keys/ceremony/${encodeURIComponent(ceremonyId)}/status`, { headers: { accept: "application/json" }, cache: "no-store", ...(signal ? { signal } : {}) });
      const body = await response.json().catch(() => ({})) as { status?: string };
      if (body.status === "done" || body.status === "failed" || body.status === "expired") return body.status;
    } catch {
      if (signal?.aborted) return "cancelled";
      // the server did not answer this time: ask again
    }
    if (Date.now() > until) return "expired";
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, every);
      signal?.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
    });
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = typeof json?.code === "string" ? json.code : "failed";
    const known = ["no_key", "no_rp", "reauth_required"].includes(code);
    throw Object.assign(new StepUpError(code, known ? undefined : typeof json?.error === "string" ? json.error : undefined), { body: json, status: response.status });
  }
  return json as T;
}

function credentialJson(credential: PublicKeyCredential, kind: "register" | "assert"): Record<string, unknown> {
  const common = {
    id: credential.id,
    rawId: b64(credential.rawId),
    type: credential.type,
    clientExtensionResults: credential.getClientExtensionResults(),
    ...(credential.authenticatorAttachment ? { authenticatorAttachment: credential.authenticatorAttachment } : {}),
  };
  if (kind === "register") {
    const response = credential.response as AuthenticatorAttestationResponse;
    return {
      ...common,
      response: {
        clientDataJSON: b64(response.clientDataJSON),
        attestationObject: b64(response.attestationObject),
        transports: typeof response.getTransports === "function" ? response.getTransports() : [],
      },
    };
  }
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    ...common,
    response: {
      clientDataJSON: b64(response.clientDataJSON),
      authenticatorData: b64(response.authenticatorData),
      signature: b64(response.signature),
      ...(response.userHandle ? { userHandle: b64(response.userHandle) } : {}),
    },
  };
}

/** Run a started ceremony to its end: the key's answer is verified by the
 * server, or this throws. */
async function runCeremony(start: CeremonyStart, signal?: AbortSignal): Promise<void> {
  const desktop = desktopKeys();
  if (desktop) {
    const opened = await desktop.open(start.pageUrl);
    if (!opened.ok) throw new StepUpError(opened.error ?? "failed");
    const status = await waitForCeremony(start.ceremonyId, start.expiresAt, signal);
    void desktop.returned().catch(() => {});
    if (status !== "done") throw new StepUpError(status);
    return;
  }
  const options = start.options;
  let credential: Credential | null;
  try {
    credential = start.kind === "register"
      ? await navigator.credentials.create({
        publicKey: {
          ...options,
          challenge: unb64(options.challenge),
          user: { ...options.user, id: unb64(options.user.id) },
          excludeCredentials: (options.excludeCredentials ?? []).map((entry: { id: string }) => ({ ...entry, id: unb64(entry.id) })),
        } as unknown as PublicKeyCredentialCreationOptions,
      })
      : await navigator.credentials.get({
        publicKey: {
          ...options,
          challenge: unb64(options.challenge),
          allowCredentials: (options.allowCredentials ?? []).map((entry: { id: string }) => ({ ...entry, id: unb64(entry.id) })),
        } as unknown as PublicKeyCredentialRequestOptions,
      });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    throw new StepUpError(name === "NotAllowedError" ? "cancelled" : "failed");
  }
  if (!credential) throw new StepUpError("cancelled");
  await post(`/api/security-keys/ceremony/${start.ceremonyId}`, { response: credentialJson(credential as PublicKeyCredential, start.kind) });
}

/** Add a key. A person who already has one confirms with it first (the
 * server says so; the store's `api` is not used here, so it is handled in
 * place). */
export async function registerSecurityKey(name: string, signal?: AbortSignal): Promise<void> {
  let start: CeremonyStart;
  try {
    start = await post<CeremonyStart>("/api/security-keys/register", { name, via: via() });
  } catch (error) {
    const body = (error as { body?: { code?: string; target?: StepUpTarget } }).body;
    if (body?.code !== "step_up_required" || !body.target) throw error;
    const confirmed = await stepUp(body.target, signal);
    start = await post<CeremonyStart>("/api/security-keys/register", { name, via: via(), stepUp: confirmed });
  }
  await runCeremony(start, signal);
}

/** Recent step-ups by target: one ceremony may authorize two requests
 * (a card's Always allow, then its Allow). */
const recent = new Map<string, { id: string; at: number }>();
const RECENT_MS = 55_000;

function targetKey(target: StepUpTarget): string | null {
  return target.kind === "approval" ? `${target.threadId}\n${target.requestId}` : null;
}

/** Ask the person's key for this target; the ceremony id to send as
 * `stepUp`. */
export async function stepUp(target: StepUpTarget, signal?: AbortSignal): Promise<string> {
  if (!securityKeysUsable()) throw new StepUpError("unsupported");
  const start = await post<CeremonyStart>("/api/security-keys/begin", { target, via: via() });
  await runCeremony(start, signal);
  const key = targetKey(target);
  if (key) recent.set(key, { id: start.ceremonyId, at: Date.now() });
  return start.ceremonyId;
}

/** A step-up that may already cover this target (made a moment ago for the
 * same card), without asking the key again. */
export function recentStepUp(target: StepUpTarget): string | undefined {
  const key = targetKey(target);
  if (!key) return undefined;
  const found = recent.get(key);
  if (!found || Date.now() - found.at > RECENT_MS) {
    recent.delete(key);
    return undefined;
  }
  return found.id;
}

export function forgetStepUp(target: StepUpTarget): void {
  const key = targetKey(target);
  if (key) recent.delete(key);
}

/** A looser approval level the desktop's trusted channel will apply: ask
 * the server first, which asks the person's key when they chose
 * "rule-change" and returns a one-time allowance for that exact operation,
 * which the channel's request then carries. */
export async function authorizeApprovalMode(botId: string, op: string, thread: string, mode: string): Promise<string | undefined> {
  const body = { botId, op, thread, mode };
  let answer: { allowance?: string };
  try {
    answer = await post<{ allowance?: string }>("/api/security-keys/approval-mode", body);
  } catch (error) {
    const refusal = (error as { body?: { code?: string; target?: StepUpTarget } }).body;
    if (refusal?.code !== "step_up_required" || !refusal.target) throw error;
    const confirmed = await stepUp(refusal.target);
    answer = await post<{ allowance?: string }>("/api/security-keys/approval-mode", { ...body, stepUp: confirmed });
  }
  return answer.allowance;
}

type ApprovalBridgeLike = { setMode: (botId: string, mode: any, options?: any) => Promise<any> };
type ModeOptions = { threadId?: string; threadOnly?: boolean; allThreads?: boolean; refreshPermissions?: boolean; [key: string]: unknown };

/** The desktop's approval bridge, asking the key first for a looser level. */
export function stepUpApprovals<T extends ApprovalBridgeLike>(bridge: T | undefined): T | undefined {
  if (!bridge) return bridge;
  return {
    ...bridge,
    setMode: async (botId: string, mode: string, options?: ModeOptions) => {
      if (mode === "ask" && !options?.refreshPermissions) return bridge.setMode(botId, mode, options);
      const scoped = Boolean(options?.threadOnly && options.threadId);
      const op = options?.allThreads ? "all-threads" : options?.refreshPermissions ? "refresh" : scoped ? "thread" : "bot";
      const allowance = await authorizeApprovalMode(botId, op, scoped ? options!.threadId! : "*", mode);
      return bridge.setMode(botId, mode, allowance ? { ...options, stepUpAllowance: allowance } : options);
    },
  } as T;
}
