import { describe, expect, it } from "vitest";
import type { RemoteSessionView } from "../../../shared/remote-session";
import { remoteControlOffer } from "./remote-control";

const session = { id: "abc123abc123", code: "BQDHS7", state: "connected", os: "windows", elevated: false, endAt: "2026-10-28T00:00:00.000Z", suggestions: [] } as RemoteSessionView;

describe("remote control offer", () => {
  it("offers a switch, the link and the code when a session or a link exists", () => {
    const offer = remoteControlOffer([
      { id: "m1", text: "Page https://support.example.test/assist/BQDHS7", remoteSession: session },
    ]);
    expect(offer).toMatchObject({ sessionId: session.id, link: "https://support.example.test/assist/BQDHS7", copy: "https://support.example.test/assist/BQDHS7", controllable: true, socketOnly: false });
  });

  it("keeps a Tailcat socket visible and copies only what is not the address", () => {
    const address = "tc" + "a".repeat(30);
    const offer = remoteControlOffer([
      { id: "m2", text: `socket ${address}`, terminalEmbed: { sessionId: "s", resourceId: "r", provider: "tailcat", hostLabel: "BQDHS7", label: "Remote", status: "live" } },
    ]);
    expect(offer?.socketOnly).toBe(true);
    expect(offer?.controllable).toBe(false);
    expect(offer?.copy).toBe("BQDHS7");
    expect(offer?.messageId).toBe("m2");
    expect(JSON.stringify(offer)).not.toContain(address);
  });

  it("says nothing when there is no session, link or socket", () => {
    expect(remoteControlOffer([{ id: "m3", text: "no remote here" }])).toBeNull();
  });
});
