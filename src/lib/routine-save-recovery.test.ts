import { describe, expect, it } from "vitest";

import { answerWasLost, isRawStatusText, routineCreatedBy } from "./routine-save-recovery";
import type { Routine } from "./routines";

function apiError(status: number, body: Record<string, unknown> = {}) {
  return Object.assign(new Error(`${status} Unknown Status Code`), { status, body });
}

function routine(id: string, name: string, createdAt: number, extra: Partial<Routine> = {}): Routine {
  return {
    id, name, prompt: "p", target: "bot", botId: "b1", runOn: "maus", enabled: true,
    schedule: { type: "once", at: 1 }, durationMinutes: 30, createdAt, updatedAt: createdAt, ...extra,
  } as Routine;
}

describe("routine save recovery (#1522)", () => {
  it("treats a closed request, a gateway error or the network as a lost answer", () => {
    expect(answerWasLost(apiError(499))).toBe(true);
    expect(answerWasLost(apiError(504))).toBe(true);
    expect(answerWasLost(new TypeError("Failed to fetch"))).toBe(true);
  });

  it("keeps a refusal the server worded as a real failure", () => {
    expect(answerWasLost(apiError(400, { error: "Give the routine a name" }))).toBe(false);
    expect(answerWasLost(apiError(503, { error: "Busy" }))).toBe(false);
    expect(answerWasLost(apiError(403))).toBe(false);
    expect(answerWasLost(new Error("Choose a valid schedule"))).toBe(false);
  });

  it("spots a raw status line", () => {
    expect(isRawStatusText("499 Unknown Status Code")).toBe(true);
    expect(isRawStatusText("502 ")).toBe(true);
    expect(isRawStatusText("Give the routine a name")).toBe(false);
  });

  it("finds the routine the lost create made, never an older one", () => {
    const known = new Set(["old"]);
    const listed = [
      routine("old", "Brief", 1),
      routine("other-bot", "Brief", 5, { botId: "b2" }),
      routine("new", "Brief", 10),
    ];
    expect(routineCreatedBy(known, listed, { name: " Brief ", botId: "b1", target: "bot" })?.id).toBe("new");
    expect(routineCreatedBy(new Set(["old", "new"]), listed, { name: "Brief", botId: "b1", target: "bot" })).toBeNull();
  });
});
