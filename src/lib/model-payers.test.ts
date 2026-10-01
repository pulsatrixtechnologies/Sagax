import { describe, expect, it } from "vitest";

import { orgEngineState, payerOrder } from "./model-payers";

const claude = (patch: Partial<Parameters<typeof payerOrder>[0]> = {}): Parameters<typeof payerOrder>[0] => ({
  driver: "claudeAgent", installed: true, subscription: { supported: true, signedIn: false }, myKey: false, orgKey: false, myTurns: "none", ...patch,
});

describe("payerOrder (server/engine-credentials.ts, the speaker pays)", () => {
  it("lists the subscription, the person's key, then the organization key; never the server's own sign-in", () => {
    expect(payerOrder(claude()).rows.map((row) => row.id)).toEqual(["subscription", "key", "org-key"]);
  });

  it("takes the payer used now from the server's answer", () => {
    expect(payerOrder(claude({ subscription: { supported: true, signedIn: true }, myKey: true, myTurns: "subscription" })).current).toBe("subscription");
    expect(payerOrder(claude({ myKey: true, orgKey: true, myTurns: "key" })).current).toBe("key");
    expect(payerOrder(claude({ orgKey: true, myTurns: "org-key" })).current).toBe("org-key");
    expect(payerOrder(claude()).current).toBeNull();
  });

  it("offers no subscription or own key for an engine without them", () => {
    const other = { driver: "openaiCompatible", installed: true, subscription: { supported: false, signedIn: false }, myKey: false, orgKey: false, myTurns: "none" as const };
    expect(payerOrder(other).rows.map((row) => row.id)).toEqual(["org-key"]);
    expect(orgEngineState(other)).toBe("noAccess");
  });

  it("names the provider column state", () => {
    expect(orgEngineState(claude({ installed: false }))).toBe("notInstalled");
    expect(orgEngineState(claude())).toBe("signInRequired");
    expect(orgEngineState(claude({ orgKey: true, myTurns: "org-key" }))).toBe("connected");
  });
});
