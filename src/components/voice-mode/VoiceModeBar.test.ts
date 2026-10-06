import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
});

import { voiceAccessCardText } from "./VoiceModeBar";

describe("voice access card", () => {
  it("speaks to the person it is about; the organization's key only for an admin", () => {
    expect(voiceAccessCardText({ cause: "no_credentials", admin: false })).toEqual(["Voice mode needs a Grok voice key. Add one in Settings > API keys. It is separate from the xAI key bots use."]);
    expect(voiceAccessCardText({ cause: "no_credentials", admin: true })).toEqual([
      "Voice mode needs a Grok voice key. Add one in Settings > API keys. It is separate from the xAI key bots use.",
      "As an admin, you can also set the organization's key in Settings > Connections.",
    ]);
    expect(voiceAccessCardText({ cause: "payer_disabled", admin: true })).toEqual(["Your account is disabled: voice mode can't run."]);
  });
});

import { formatCallTime, phaseLabel } from "./VoiceModeBar";

describe("the call's states, as on a phone", () => {
  it("names every state; hold wins over mute, mute over the rest", () => {
    expect(phaseLabel("connecting", false)).toBe("Connecting");
    expect(phaseLabel("listening", false)).toBe("Listening");
    expect(phaseLabel("hearing", false)).toBe("Listening to you");
    expect(phaseLabel("thinking", false)).toBe("Thinking");
    expect(phaseLabel("speaking", false)).toBe("Speaking");
    expect(phaseLabel("interrupted", false)).toBe("Interrupted");
    expect(phaseLabel("held", true)).toBe("On hold");
    expect(phaseLabel("speaking", true)).toBe("Muted");
  });

  it("shows the call's running time like a phone", () => {
    expect(formatCallTime(0)).toBe("0:00");
    expect(formatCallTime(-5)).toBe("0:00");
    expect(formatCallTime(9_999)).toBe("0:09");
    expect(formatCallTime(83_000)).toBe("1:23");
    expect(formatCallTime(3_723_000)).toBe("1:02:03");
  });
});
