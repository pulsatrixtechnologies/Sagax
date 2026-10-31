import { describe, expect, it, vi } from "vitest";

import {
  answerWasLost,
  createAnswerErrorMessage,
  isRawStatusText,
  recoverCreatedRoutineAfterLostAnswer,
  routineCreatedBy,
} from "./routine-save-recovery";
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

describe("routine save recovery (#1522 / #1753)", () => {
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

  it("replaces a lost or raw status with the readable fallback", () => {
    expect(createAnswerErrorMessage(apiError(499), "Check first")).toBe("Check first");
    expect(createAnswerErrorMessage(new Error("499 Unknown Status Code"), "Check first")).toBe("Check first");
    expect(createAnswerErrorMessage(new Error("Give the routine a name"), "Check first")).toBe("Give the routine a name");
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

  it("recovers the created routine after a lost answer, and skips a real refusal", async () => {
    const known = new Set(["old"]);
    const listed = [routine("old", "Brief", 1), routine("new", "Brief", 10)];
    const list = vi.fn().mockResolvedValue({ routines: listed });
    expect((await recoverCreatedRoutineAfterLostAnswer(apiError(499), known, { name: "Brief", botId: "b1" }, list))?.id).toBe("new");
    expect(list).toHaveBeenCalledOnce();
    list.mockClear();
    expect(await recoverCreatedRoutineAfterLostAnswer(apiError(400, { error: "bad" }), known, { name: "Brief", botId: "b1" }, list)).toBeNull();
    expect(list).not.toHaveBeenCalled();
  });

  it("treats a failed re-list as unrecovered", async () => {
    const list = vi.fn().mockRejectedValue(new Error("offline"));
    expect(await recoverCreatedRoutineAfterLostAnswer(apiError(499), new Set(), { name: "Brief", botId: "b1" }, list)).toBeNull();
  });
});
