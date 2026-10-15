import { describe, expect, it } from "vitest";

import { EMPTY_ONBOARDING } from "./onboarding";
import { DEFAULT_SERVER_ADDRESS, launchBridges, launchDue, launchErrorKey, launchModePatch, rememberedServerAddress, serverModeBridge } from "./launch";

const environments = { state: async () => ({ environments: [] }) };
const orgJoin = { probe: async () => ({ origin: "", issuer: "" }), join: async () => ({ ok: true }) };

describe("launch screen", () => {
  it("leaves the address empty: only a server this computer saved is proposed", () => {
    expect(DEFAULT_SERVER_ADDRESS).toBe("");
    expect(rememberedServerAddress(null)).toBe("");
    expect(rememberedServerAddress({ environments: [] })).toBe("");
    // a computer (not an organization) and a local environment are never proposed
    expect(rememberedServerAddress({ environments: [
      { id: "local", kind: "local" },
      { id: "pc", kind: "remote", origin: "https://computer.example.test" },
    ] })).toBe("");
    const saved = [
      { id: "a", kind: "remote" as const, origin: "https://a.example.test", org: true },
      { id: "b", kind: "remote" as const, origin: " https://b.example.test ", org: true },
    ];
    expect(rememberedServerAddress({ activeId: "local", environments: saved })).toBe("https://b.example.test");
    expect(rememberedServerAddress({ activeId: "a", environments: saved })).toBe("https://a.example.test");
  });

  it("is offered only by the desktop app's own window, which can add and sign in to a server", () => {
    expect(launchBridges(undefined)).toBeNull();
    expect(launchBridges({ environments })).toBeNull();
    expect(launchBridges({ environments, orgJoin, remoteClient: { active: true } })).toBeNull();
    // a hosted page the desktop opened has no remoteClient and is not the owner
    expect(launchBridges({ environments, orgJoin })).toBeNull();
    expect(launchBridges({ environments, orgJoin, remoteClient: { active: false } })).toEqual({ environments, orgJoin });
  });

  it("shows on first launch and waits for the config", () => {
    expect(launchDue(null, { welcomeDue: true, serverMode: null })).toBe(false);
    expect(launchDue({ onboarding: EMPTY_ONBOARDING }, { welcomeDue: true, serverMode: null })).toBe(true);
    expect(launchDue({}, { welcomeDue: true, serverMode: false })).toBe(true);
  });

  it("does not interrupt someone who already finished the welcome tour", () => {
    expect(launchDue({ onboarding: EMPTY_ONBOARDING }, { welcomeDue: false, serverMode: false })).toBe(false);
  });

  it("remembers no server for good", () => {
    const solo = { onboarding: { ...EMPTY_ONBOARDING, launchMode: "solo" as const } };
    expect(launchDue(solo, { welcomeDue: true, serverMode: false })).toBe(false);
  });

  it("comes back on this computer's page whenever server mode was left (signed out), never while it is on", () => {
    const server = { onboarding: { ...EMPTY_ONBOARDING, launchMode: "server" as const } };
    expect(launchDue(server, { welcomeDue: true, serverMode: true })).toBe(false);
    expect(launchDue(server, { welcomeDue: false, serverMode: null })).toBe(false);
    expect(launchDue(server, { welcomeDue: false, serverMode: false })).toBe(true);
  });

  it("finds server mode's bridge on this app's own UI only", () => {
    const serverMode = { state: async () => ({ active: false as const }), leave: async () => ({ left: false }) };
    expect(serverModeBridge(undefined)).toBeNull();
    expect(serverModeBridge({})).toBeNull();
    expect(serverModeBridge({ serverMode })).toBe(serverMode);
  });

  it("saves the choice in the onboarding record", () => {
    expect(launchModePatch("solo")).toEqual({ onboarding: { launchMode: "solo" } });
    expect(launchModePatch("server")).toEqual({ onboarding: { launchMode: "server" } });
  });

  it("names each sign-in failure in product words, never the IPC text", () => {
    expect(launchErrorKey(new Error("Error invoking remote method 'org-join:probe': Error: That server could not be reached."))).toBe("launch.error.unreachable");
    expect(launchErrorKey(new Error("That server does not sign people in with Pulsatrix."))).toBe("launch.error.notPerspicax");
    expect(launchErrorKey(new Error("Enter an https server address, or http://localhost on this computer."))).toBe("launch.error.address");
    expect(launchErrorKey(new Error("/private/path secret"))).toBe("launch.error.failed");
    expect(launchErrorKey("nope")).toBe("launch.error.failed");
  });
});
