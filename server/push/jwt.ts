// The APNs provider token: a JWT signed ES256 with the `.p8` key
// (header { alg: "ES256", kid: <Key ID> }, claims { iss: <Team ID>, iat }).
// APNs refuses a token older than an hour and answers 429
// TooManyProviderTokenUpdates when it is renewed more often than every 20
// minutes, so one token is kept and renewed after REFRESH_AFTER_MS.
import { createPrivateKey, sign, type KeyObject } from "node:crypto";

export const PROVIDER_TOKEN_REFRESH_MS = 40 * 60_000;

const base64url = (input: Buffer | string) => Buffer.from(input).toString("base64url");

export function apnsPrivateKey(pem: string): KeyObject {
  const key = createPrivateKey({ key: pem, format: "pem" });
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    throw new Error("the APNs key must be an EC P-256 key (.p8)");
  }
  return key;
}

/** One signed provider token. `nowMs` is the issue time. */
export function buildProviderToken(input: { key: KeyObject; keyId: string; teamId: string; nowMs: number }): string {
  const header = base64url(JSON.stringify({ alg: "ES256", kid: input.keyId }));
  const claims = base64url(JSON.stringify({ iss: input.teamId, iat: Math.floor(input.nowMs / 1000) }));
  const signingInput = `${header}.${claims}`;
  // JOSE wants the raw r||s (64 bytes), not DER.
  const signature = sign("sha256", Buffer.from(signingInput), { key: input.key, dsaEncoding: "ieee-p1363" });
  return `${signingInput}.${base64url(signature)}`;
}

/** Keeps one token and renews it when it is old or after APNs said it expired. */
export class ProviderTokenCache {
  private token: string | null = null;
  private issuedAt = 0;
  private readonly key: KeyObject;
  private readonly keyId: string;
  private readonly teamId: string;
  private readonly now: () => number;

  constructor(input: { key: KeyObject; keyId: string; teamId: string; now?: () => number }) {
    this.key = input.key;
    this.keyId = input.keyId;
    this.teamId = input.teamId;
    this.now = input.now ?? Date.now;
  }

  current(): string {
    const now = this.now();
    if (!this.token || now - this.issuedAt >= PROVIDER_TOKEN_REFRESH_MS) {
      this.token = buildProviderToken({ key: this.key, keyId: this.keyId, teamId: this.teamId, nowMs: now });
      this.issuedAt = now;
    }
    return this.token;
  }

  /** APNs answered ExpiredProviderToken: the next send signs a new one. */
  invalidate(): void {
    this.token = null;
  }
}
