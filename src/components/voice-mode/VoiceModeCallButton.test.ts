import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
});

import { forgetVoiceModeStatus, refreshVoiceMode, voiceModeCheckNow } from "@/lib/voice-mode/api";
import { voiceUnavailableView } from "./VoiceModeCallButton";

const ready = (status: Record<string, unknown>) => ({ state: "ready" as const, status: { provider: "xai" as const, organization: true, ...status } as never });

describe("voice mode call button on an organization server", () => {
  it("opens the bar when the server says voice mode serves the speaker (no popover)", () => {
    expect(voiceUnavailableView(ready({ available: true, via: "org-key" }))).toBeNull();
  });

  it("shows the speaker's private access card, never the legacy This computer gate", () => {
    const view = voiceUnavailableView(ready({ available: false, refusal: { cause: "no_credentials", keysUrl: "https://keys.example.test" } }))!;
    expect(view.lines).toEqual(["You don't have xAI access for voice mode: add your xAI key in Perspicax."]);
    expect(view.actions).toEqual(["add-key"]);
    expect(JSON.stringify(view)).not.toMatch(/This computer|on-device|your Mac/);
  });

  it("adds the organization's key hint and Open Settings > Connections for an admin only", () => {
    const view = voiceUnavailableView(ready({ available: false, refusal: { cause: "no_credentials", admin: true } }))!;
    expect(view.lines).toEqual([
      "You don't have xAI access for voice mode: add your xAI key in Perspicax.",
      "As an admin, you can also set the organization's key in Settings > Connections.",
    ]);
    expect(view.actions).toEqual(["open-connections"]);
  });

  it("says when the server is still answering or could not answer, with a retry", () => {
    expect(voiceUnavailableView({ state: "loading" })!.cause).toBe("loading");
    const failed = voiceUnavailableView({ state: "error", error: "HTTP 502", missing: false })!;
    expect(failed.lines[0]).toContain("HTTP 502");
    expect(failed.actions).toEqual(["retry"]);
    expect(voiceUnavailableView(ready({ available: false, refusal: { cause: "payer_disabled" } }))!.actions).toEqual([]);
  });

  it("a room says voice mode talks with one bot at a time", () => {
    expect(voiceUnavailableView({ state: "loading" }, { group: true })!.cause).toBe("group");
  });

  it("asks the server again at each refresh, so a key added meanwhile counts at once", async () => {
    forgetVoiceModeStatus();
    const answers = [ready({ available: false, refusal: { cause: "no_credentials" } }), ready({ available: true, via: "org-key" })];
    const run = vi.fn(async () => answers.shift()!);
    expect(voiceModeCheckNow("b1").state).toBe("loading");
    await refreshVoiceMode("b1", run);
    expect(voiceModeCheckNow("b1")).toMatchObject({ state: "ready", status: { available: false } });
    await refreshVoiceMode("b1", run);
    expect(voiceModeCheckNow("b1")).toMatchObject({ state: "ready", status: { available: true } });
    expect(run).toHaveBeenCalledTimes(2);
  });
});
