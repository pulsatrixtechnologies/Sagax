import { describe, expect, it } from "vitest";

import { EMPTY_ONBOARDING } from "./onboarding";
import { DEFAULT_SERVER_ADDRESS, defaultServerAddress, launchBridges, launchDue, launchErrorKey, launchModePatch } from "./launch";

const environments = { state: async () => ({ environments: [] }) };
const orgJoin = { probe: async () => ({ origin: "", issuer: "" }), join: async () => ({ ok: true }) };

describe("launch screen", () => {
  it("prefills the GOX Sagax server unless the build names another", () => {
    expect(DEFAULT_SERVER_ADDRESS).toBe("https://bot.pulsatrix.mcp.goxcloud.ca");
    expect(defaultServerAddress()).toBe(DEFAULT_SERVER_ADDRESS);
    expect(defaultServerAddress(" https://sagax.example.test ")).toBe("https://sagax.example.test");
    expect(defaultServerAddress("")).toBe(DEFAULT_SERVER_ADDRESS);
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
    expect(launchDue(null, { welcomeDue: true, savedServers: null })).toBe(false);
    expect(launchDue({ onboarding: EMPTY_ONBOARDING }, { welcomeDue: true, savedServers: null })).toBe(true);
    expect(launchDue({}, { welcomeDue: true, savedServers: 0 })).toBe(true);
  });

  it("does not interrupt someone who already finished the welcome tour", () => {
    expect(launchDue({ onboarding: EMPTY_ONBOARDING }, { welcomeDue: false, savedServers: 0 })).toBe(false);
  });

  it("remembers no server for good", () => {
    const solo = { onboarding: { ...EMPTY_ONBOARDING, launchMode: "solo" as const } };
    expect(launchDue(solo, { welcomeDue: true, savedServers: 0 })).toBe(false);
  });

  it("comes back after server mode only when no server is saved any more (signed out and forgotten)", () => {
    const server = { onboarding: { ...EMPTY_ONBOARDING, launchMode: "server" as const } };
    expect(launchDue(server, { welcomeDue: true, savedServers: 1 })).toBe(false);
    expect(launchDue(server, { welcomeDue: false, savedServers: null })).toBe(false);
    expect(launchDue(server, { welcomeDue: false, savedServers: 0 })).toBe(true);
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
