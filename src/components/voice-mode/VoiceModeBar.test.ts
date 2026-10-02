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
