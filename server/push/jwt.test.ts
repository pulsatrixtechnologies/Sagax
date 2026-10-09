import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";

import { apnsPrivateKey, buildProviderToken, PROVIDER_TOKEN_REFRESH_MS, ProviderTokenCache } from "./jwt.ts";

// A key made for this test only, never an Apple key.
const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const pem = pair.privateKey.export({ format: "pem", type: "pkcs8" }).toString();

const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));

describe("APNs provider token", () => {
  it("is an ES256 JWT with kid, iss and iat, and verifies with the public key", () => {
    const token = buildProviderToken({ key: apnsPrivateKey(pem), keyId: "ABC123DEFG", teamId: "PP546MZVHZ", nowMs: 1_760_000_000_123 });
    const [header, claims, signature] = token.split(".");
    expect(decode(header!)).toEqual({ alg: "ES256", kid: "ABC123DEFG" });
    expect(decode(claims!)).toEqual({ iss: "PP546MZVHZ", iat: 1_760_000_000 });
    const raw = Buffer.from(signature!, "base64url");
    // JOSE ES256: r||s, 64 bytes, not DER
    expect(raw).toHaveLength(64);
    const ok = verify("sha256", Buffer.from(`${header}.${claims}`), { key: createPublicKey(pem), dsaEncoding: "ieee-p1363" }, raw);
    expect(ok).toBe(true);
  });

  it("refuses a key that is not EC P-256", () => {
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    expect(() => apnsPrivateKey(rsa)).toThrow(/P-256/);
  });

  it("keeps one token and renews it after the refresh time or an expiry", () => {
    let now = 1_000_000;
    const cache = new ProviderTokenCache({ key: apnsPrivateKey(pem), keyId: "ABC123DEFG", teamId: "PP546MZVHZ", now: () => now });
    const first = cache.current();
    now += 60_000;
    expect(cache.current()).toBe(first);
    now += PROVIDER_TOKEN_REFRESH_MS;
    const second = cache.current();
    expect(second).not.toBe(first);
    cache.invalidate();
    now += 1000;
    expect(cache.current()).not.toBe(second);
  });
});
