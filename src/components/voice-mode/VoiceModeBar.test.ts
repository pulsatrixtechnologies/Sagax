import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
});

import { voiceAccessCardText } from "./VoiceModeBar";

describe("voice access card", () => {
  it("speaks to the person it is about; the organization's key only for an admin", () => {
    expect(voiceAccessCardText({ cause: "no_credentials", admin: false })).toEqual(["You don't have xAI access for voice mode: add your xAI key in Perspicax."]);
    expect(voiceAccessCardText({ cause: "no_credentials", admin: true })).toEqual([
      "You don't have xAI access for voice mode: add your xAI key in Perspicax.",
      "As an admin, you can also set the organization's key in Settings > Connections.",
    ]);
    expect(voiceAccessCardText({ cause: "payer_disabled", admin: true })).toEqual(["Your account is disabled: voice mode can't run."]);
  });
});

import { phaseLabel } from "./VoiceModeBar";

describe("the call's states, as on a phone", () => {
  it("names every state; hold wins over mute, mute over the rest", () => {
    expect(phaseLabel("connecting", "Cryptic", false)).toBe("Connecting");
    expect(phaseLabel("listening", "Cryptic", false)).toBe("Listening");
    expect(phaseLabel("hearing", "Cryptic", false)).toBe("Listening to you");
    expect(phaseLabel("thinking", "Cryptic", false)).toBe("Thinking");
    expect(phaseLabel("speaking", "Cryptic", false)).toBe("Cryptic");
    expect(phaseLabel("interrupted", "Cryptic", false)).toBe("Interrupted");
    expect(phaseLabel("held", "Cryptic", true)).toBe("On hold");
    expect(phaseLabel("speaking", "Cryptic", true)).toBe("Muted");
  });
});
