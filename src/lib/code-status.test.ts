// The Code row and its status: hidden while loading and on a Perspicax
// without the agents API; the status asked once for the whole app.
import { afterEach, describe, expect, it } from "vitest";

import type { CodeStatus } from "../../shared/code-runs.ts";
import { codeRowVisible, codeStatusOnce, resetCodeStatusCache } from "@/lib/code-runs";

afterEach(() => resetCodeStatusCache());

describe("codeRowVisible", () => {
  it("hides the row while loading and when Perspicax does not serve the agents API", () => {
    expect(codeRowVisible(null)).toBe(false);
    expect(codeRowVisible({ available: false, reason: "not_available" })).toBe(false);
  });
  it("shows it when Code works, and on the other gates (solo, sign-in, unreachable)", () => {
    expect(codeRowVisible({ available: true })).toBe(true);
    for (const reason of ["solo", "no_session", "unreachable"] as const) expect(codeRowVisible({ available: false, reason })).toBe(true);
  });
});

describe("codeStatusOnce", () => {
  it("asks the server once, then answers from the cache for a few minutes", async () => {
    let calls = 0;
    const load = async (): Promise<CodeStatus> => { calls++; return { available: false, reason: "not_available" }; };
    const t0 = 1_000_000;
    for (let i = 0; i < 4; i++) expect(await codeStatusOnce(load, t0 + i * 1000)).toEqual({ available: false, reason: "not_available" });
    expect(calls).toBe(1);
    await codeStatusOnce(load, t0 + 5 * 60_000 + 1);
    expect(calls).toBe(2);
  });
  it("a failed load is unreachable, not an error", async () => {
    expect(await codeStatusOnce(async () => { throw new Error("down"); })).toEqual({ available: false, reason: "unreachable" });
  });
});
