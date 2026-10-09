import { describe, expect, it } from "vitest";

import { maskSecret, readApnsConfig } from "./config.ts";

const PEM = "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n";

describe("APNs config", () => {
  it("is off and says which variable is missing", () => {
    expect(readApnsConfig({})).toEqual({ configured: false, reason: "SAGAX_APNS_KEY_PATH and SAGAX_APNS_KEY_ID not set" });
  });
  it("reads the key file and defaults team, bundle and environment", () => {
    const result = readApnsConfig({ SAGAX_APNS_KEY_PATH: "/run/secrets/pulsabot/apns_key.p8", SAGAX_APNS_KEY_ID: "abc123defg" }, () => PEM);
    expect(result).toEqual({ configured: true, config: { keyPem: PEM.trim(), keyId: "ABC123DEFG", teamId: "PP546MZVHZ", bundleId: "ca.pulsatrix.sagax", environment: "production" } });
    const sandbox = readApnsConfig({ SAGAX_APNS_KEY_PATH: "/k", SAGAX_APNS_KEY_ID: "ABC123DEFG", SAGAX_APNS_ENVIRONMENT: "sandbox" }, () => PEM);
    expect(sandbox.configured && sandbox.config.environment).toBe("sandbox");
  });
  it("refuses a file that is not a .p8 and never repeats its content", () => {
    const result = readApnsConfig({ SAGAX_APNS_KEY_PATH: "/k", SAGAX_APNS_KEY_ID: "ABC123DEFG" }, () => "secret-ish text");
    expect(result.configured).toBe(false);
    expect(JSON.stringify(result)).not.toContain("secret-ish");
  });
  it("masks", () => {
    expect(maskSecret("0123456789abcdef0123")).toBe("0123****0123");
    expect(maskSecret("short")).toBe("****");
  });
});
