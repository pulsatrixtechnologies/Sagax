import { describe, expect, it } from "vitest";
import { grokAccountLinked } from "./grok-account";

const grok = (snapshot: { authenticated?: boolean; account?: unknown }) => ({ driverKind: "grokAgent", snapshot });

describe("a linked Grok account", () => {
  it("is a Grok sign-in or the person's own xAI key", () => {
    expect(grokAccountLinked({})).toBe(false);
    expect(grokAccountLinked({ instances: [grok({ authenticated: false })] })).toBe(false);
    expect(grokAccountLinked({ instances: [grok({ authenticated: true })] })).toBe(true);
    expect(grokAccountLinked({ instances: [{ driverKind: "grok", snapshot: { account: { email: "a@b.c" } } }] })).toBe(true);
    expect(grokAccountLinked({ instances: [{ driverKind: "claudeAgent", snapshot: { authenticated: true } }] })).toBe(false);
    expect(grokAccountLinked({ xaiConfigured: true })).toBe(true);
    expect(grokAccountLinked({ engines: [{ driver: "grokAgent", subscription: { signedIn: true } }] })).toBe(true);
    expect(grokAccountLinked({ engines: [{ driver: "grokAgent", myKey: true }] })).toBe(true);
    // the organization's key is not this person's account
    expect(grokAccountLinked({ engines: [{ driver: "grokAgent", subscription: { signedIn: false }, myKey: false }] })).toBe(false);
    expect(grokAccountLinked({ engines: null })).toBe(false);
  });
});
