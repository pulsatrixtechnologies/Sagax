import { describe, expect, it } from "vitest";

import {
  fullAccessConsentedBy,
  orgFullAccessAllowed,
  orgFullAccessGrantRefusal,
  orgFullAccessHolds,
} from "./org-full-access.ts";

const consent = { principalId: "alice", at: 1 };

describe("organization Full access policy", () => {
  it("is allowed by default and off only when an admin turned it off", () => {
    expect(orgFullAccessAllowed(undefined)).toBe(true);
    expect(orgFullAccessAllowed({})).toBe(true);
    expect(orgFullAccessAllowed({ allowFullAccess: true })).toBe(true);
    expect(orgFullAccessAllowed({ allowFullAccess: false })).toBe(false);
  });

  it("refuses a grant while the policy is off, whoever asks", () => {
    expect(orgFullAccessGrantRefusal({ policyAllowed: false, callerPrincipalId: "alice", ownerPrincipalId: "alice", confirmed: true, consent })?.code)
      .toBe("org_full_access_disabled");
  });

  it("lets only the bot's owner, signed in, grant it", () => {
    expect(orgFullAccessGrantRefusal({ policyAllowed: true, callerPrincipalId: null, ownerPrincipalId: "alice", confirmed: true, consent: null })?.code)
      .toBe("full_access_owner_only");
    expect(orgFullAccessGrantRefusal({ policyAllowed: true, callerPrincipalId: "bob", ownerPrincipalId: "alice", confirmed: true, consent: null })?.code)
      .toBe("full_access_owner_only");
  });

  it("asks for the confirmation once per bot", () => {
    expect(orgFullAccessGrantRefusal({ policyAllowed: true, callerPrincipalId: "alice", ownerPrincipalId: "alice", confirmed: false, consent: null })?.code)
      .toBe("full_access_confirm_required");
    expect(orgFullAccessGrantRefusal({ policyAllowed: true, callerPrincipalId: "alice", ownerPrincipalId: "alice", confirmed: true, consent: null })).toBeNull();
    expect(orgFullAccessGrantRefusal({ policyAllowed: true, callerPrincipalId: "Alice", ownerPrincipalId: "alice", confirmed: false, consent })).toBeNull();
    // another person's consent is not the owner's
    expect(orgFullAccessGrantRefusal({ policyAllowed: true, callerPrincipalId: "alice", ownerPrincipalId: "alice", confirmed: false, consent: { principalId: "bob", at: 1 } })?.code)
      .toBe("full_access_confirm_required");
  });

  it("runs a turn Full only while the policy is on and the current owner consented", () => {
    expect(orgFullAccessHolds({ policyAllowed: true, ownerPrincipalId: "alice", consent })).toBe(true);
    expect(orgFullAccessHolds({ policyAllowed: false, ownerPrincipalId: "alice", consent })).toBe(false);
    // ownership moved: the routine's owner never set it on this bot
    expect(orgFullAccessHolds({ policyAllowed: true, ownerPrincipalId: "bob", consent })).toBe(false);
    expect(orgFullAccessHolds({ policyAllowed: true, ownerPrincipalId: "alice", consent: { principalId: "", at: 1 } })).toBe(false);
    expect(fullAccessConsentedBy("junk", "alice")).toBe(false);
  });
});
