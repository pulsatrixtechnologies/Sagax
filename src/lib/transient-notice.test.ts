import { describe, expect, it } from "vitest";
import { pickTransientNotice, transientNoticeSettled } from "./transient-notice";
import type { Message } from "@/state/store";

const NOW = 1_800_000_000_000;
const failed = (id: string, at: number): Message => ({ id, at, role: "bot", kind: "routine.run", routineRun: { runId: id, routineId: "rt1", routineName: "Morning digest", status: "failed" } } as Message);
const access = (id: string, at: number): Message => ({ id, at, role: "bot", kind: "access", access: { reason: "no_access", engine: "Claude", botId: "b1", ownerPrincipalId: "p1", routine: true } } as Message);
const done = (id: string, at: number): Message => ({ id, at, role: "bot", kind: "routine.run", from: { botId: "b1", name: "Ada", color: "teal" }, routineRun: { runId: id, routineId: "rt1", routineName: "Morning digest", status: "completed" } } as Message);

describe("pickTransientNotice", () => {
  it("shows the newest fresh notice once, never one already shown or older than the fresh window", () => {
    const messages = [failed("old", NOW - 10 * 60_000), failed("a", NOW - 1000), access("b", NOW - 500)];
    expect(pickTransientNotice(messages, NOW, new Set())?.id).toBe("b");
    expect(pickTransientNotice(messages, NOW, new Set(["b"]))?.id).toBe("a");
    expect(pickTransientNotice(messages, NOW, new Set(["a", "b"]))).toBeNull();
  });

  it("never shows an access notice the routine has settled since, and closes the one on screen", () => {
    const notice = access("b", NOW - 2000);
    const messages = [notice, done("c", NOW - 1000)];
    expect(pickTransientNotice(messages, NOW, new Set())).toBeNull();
    expect(transientNoticeSettled(notice, messages)).toBe(true);
    expect(transientNoticeSettled(notice, [notice])).toBe(false);
  });
});
