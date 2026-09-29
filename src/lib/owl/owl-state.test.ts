import { describe, expect, it } from "vitest";

import { MAUS_MOTIONS, MAUS_STATES, MAUS_WING_MOTIONS, type MausState } from "@/lib/mascot";
import { OWL_STATES, OWL_WING_MOVES } from "./owl-art";
import { OWL_BEAT_OF, owlBeatForMotion, owlStateForMaus } from "./owl-state";

/** The whole table, written out so a change to any row is a visible diff. */
const EXPECTED: Record<MausState, string> = {
  sleeping: "sleepy",
  waking: "idle",
  idle: "idle",
  listening: "thinking",
  thinking: "thinking",
  searching: "thinking",
  working: "working",
  excited: "success",
  surprised: "alert",
  suspicious: "thinking",
  angry: "alert",
  drowsy: "sleepy",
  happy: "success",
  curious: "thinking",
  confused: "thinking",
  bored: "sleepy",
  proud: "success",
  shy: "idle",
  sad: "idle",
  laughing: "success",
  scared: "alert",
  playful: "idle",
  celebrate: "success",
  orbit: "working",
  radar: "thinking",
  progress: "working",
  spawning: "idle",
  humming: "working",
  loading: "working",
  dictating: "working",
  sending: "working",
  receiving: "working",
  uploading: "working",
  writing: "working",
  notifying: "alert",
  alerting: "alert",
  bouncing: "success",
  dragging: "working",
  "powering-down": "sleepy",
};

describe("owlStateForMaus", () => {
  it("covers every MausState", () => {
    expect(new Set(Object.keys(EXPECTED))).toEqual(new Set(MAUS_STATES));
  });

  it.each(MAUS_STATES)("maps %s", (state) => {
    const mapped = owlStateForMaus(state);
    expect(mapped.state).toBe(EXPECTED[state]);
    expect(OWL_STATES).toContain(mapped.state);
    expect(mapped.oneShot).toBe(mapped.state === "success" || mapped.state === "alert");
  });

  it("maps the legacy stored names through their current state", () => {
    expect(owlStateForMaus("deadpan").state).toBe("idle");
    expect(owlStateForMaus("friendly").state).toBe("success");
    expect(owlStateForMaus("focused").state).toBe("working");
    expect(owlStateForMaus("sleepy").state).toBe("sleepy");
    expect(owlStateForMaus("skeptical").state).toBe("thinking");
    expect(owlStateForMaus("worried").state).toBe("alert");
    expect(owlStateForMaus("mischievous").state).toBe("idle");
  });

  it("falls back to idle for junk and empty values", () => {
    expect(owlStateForMaus("nope")).toEqual({ state: "idle", oneShot: false });
    expect(owlStateForMaus(null)).toEqual({ state: "idle", oneShot: false });
    expect(owlStateForMaus(undefined)).toEqual({ state: "idle", oneShot: false });
  });
});

describe("owlBeatForMotion", () => {
  it("gives every one-shot motion a beat that plays a state, blinks or opens the wings", () => {
    expect(new Set(Object.keys(OWL_BEAT_OF))).toEqual(new Set(MAUS_MOTIONS));
    for (const motion of MAUS_MOTIONS) {
      const beat = owlBeatForMotion(motion);
      expect(beat?.play != null || beat?.blink === true || beat?.wings != null).toBe(true);
      if (beat?.play) expect(OWL_STATES).toContain(beat.play);
      if (beat?.wings) expect(OWL_WING_MOVES).toContain(beat.wings);
    }
  });

  it("opens the wings for every wing move and the app's big moments, never the quiet beats", () => {
    for (const motion of MAUS_WING_MOTIONS) expect(owlBeatForMotion(motion)?.wings).toBeDefined();
    expect(owlBeatForMotion("celebrate")?.wings).toBe("flap");
    expect(owlBeatForMotion("success")?.wings).toBe("spread");
    expect(owlBeatForMotion("launch")?.wings).toBe("takeoff");
    for (const quiet of ["blink", "thinking", "failure", "switch"] as const) {
      expect(owlBeatForMotion(quiet)?.wings).toBeUndefined();
    }
  });

  it("does nothing for none", () => {
    expect(owlBeatForMotion("none")).toBeNull();
  });
});
