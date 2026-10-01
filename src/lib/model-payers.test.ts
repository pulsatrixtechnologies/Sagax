import { describe, expect, it } from "vitest";

import { orgEngineState, payerOrder } from "./model-payers";

const claude = (patch: Partial<Parameters<typeof payerOrder>[0]> = {}) => ({
  driver: "claudeAgent", installed: true, subscription: { supported: true, signedIn: false }, ownerKey: false, orgKey: false, ...patch,
});

describe("payerOrder (server/engine-credentials.ts order)", () => {
  it("lists subscription, own key, the server for admins, then the organization key", () => {
    expect(payerOrder(claude(), { admin: true, serverSignedIn: true }).rows.map((row) => row.id)).toEqual(["subscription", "ownerKey", "server", "orgKey"]);
    expect(payerOrder(claude(), { admin: false, serverSignedIn: true }).rows.map((row) => row.id)).toEqual(["subscription", "ownerKey", "orgKey"]);
  });

  it("uses the first ready payer", () => {
    expect(payerOrder(claude({ subscription: { supported: true, signedIn: true }, ownerKey: true, orgKey: true }), { admin: false, serverSignedIn: true }).current).toBe("subscription");
    expect(payerOrder(claude({ ownerKey: true, orgKey: true }), { admin: true, serverSignedIn: true }).current).toBe("ownerKey");
    expect(payerOrder(claude({ orgKey: true }), { admin: true, serverSignedIn: true }).current).toBe("server");
    expect(payerOrder(claude({ orgKey: true }), { admin: true, serverSignedIn: false }).current).toBe("orgKey");
    expect(payerOrder(claude(), { admin: false, serverSignedIn: true }).current).toBeNull();
  });

  it("has no payer for an engine the server has not installed", () => {
    expect(payerOrder(claude({ installed: false, orgKey: true }), { admin: false, serverSignedIn: true }).current).toBeNull();
    expect(orgEngineState(claude({ installed: false }), { admin: false, serverSignedIn: true })).toBe("notInstalled");
  });

  it("offers no subscription or own key for an engine without them", () => {
    const other = { driver: "openaiCompatible", installed: true, subscription: { supported: false, signedIn: false }, ownerKey: false, orgKey: false };
    expect(payerOrder(other, { admin: false, serverSignedIn: true }).rows.map((row) => row.id)).toEqual(["orgKey"]);
    expect(orgEngineState(other, { admin: false, serverSignedIn: true })).toBe("noAccess");
    expect(orgEngineState(claude(), { admin: false, serverSignedIn: true })).toBe("signInRequired");
    expect(orgEngineState(claude({ orgKey: true }), { admin: false, serverSignedIn: true })).toBe("connected");
  });
});
