import { describe, expect, it } from "vitest";

import { failedTurnTool } from "./failed-turn.ts";
import { repeatedFailureIds, repeatsShownFailure, type DedupMessage } from "./failure-dedup.ts";

const user = (id: string): DedupMessage => ({ id, role: "user", kind: "text" });
const reply = (id: string, botId?: string): DedupMessage => ({ id, role: "bot", kind: "text", ...(botId ? { from: { botId } } : {}) });
const error = (id: string, cause: string, botId?: string): DedupMessage => ({ id, role: "bot", kind: "activity", tool: failedTurnTool(cause), ...(botId ? { from: { botId } } : {}) });
const card = (id: string, engine = "Claude", reason = "key_refused"): DedupMessage => ({ id, role: "bot", kind: "access", access: { reason, engine, botId: "bot" } });

describe("repeatedFailureIds", () => {
  it("draws the same error and the same card once: the last of each", () => {
    const thread = [user("u1"), error("e1", "Limit reached"), card("c1"), user("u2"), error("e2", "Limit  reached"), card("c2"), user("u3"), error("e3", "Limit reached"), card("c3")];
    expect([...repeatedFailureIds(thread, "bot")].sort()).toEqual(["c1", "c2", "e1", "e2"]);
  });

  it("keeps different causes, engines and bots apart", () => {
    const thread = [error("e1", "A", "kiwi"), error("e2", "B", "kiwi"), error("e3", "A", "other"), card("c1", "Claude"), card("c2", "Codex"), card("c3", "Claude", "no_access")];
    expect(repeatedFailureIds(thread, "bot").size).toBe(0);
  });

  it("shows a failure again once the bot answered in between", () => {
    const thread = [error("e1", "A"), reply("r1"), error("e2", "A")];
    expect(repeatedFailureIds(thread, "bot").size).toBe(0);
    // another bot's answer in a room does not reset this bot's failure
    const room = [error("e1", "A", "kiwi"), reply("r1", "other"), error("e2", "A", "kiwi")];
    expect([...repeatedFailureIds(room)]).toEqual(["e1"]);
  });
});

describe("repeatsShownFailure", () => {
  it("is true for a failure the thread already shows since the bot last answered", () => {
    const thread = [user("u1"), error("e1", "A"), user("u2")];
    expect(repeatsShownFailure(thread, { role: "bot", kind: "activity", tool: failedTurnTool("A") }, "bot")).toBe(true);
    expect(repeatsShownFailure(thread, { role: "bot", kind: "activity", tool: failedTurnTool("B") }, "bot")).toBe(false);
    expect(repeatsShownFailure([...thread, reply("r1")], { role: "bot", kind: "activity", tool: failedTurnTool("A") }, "bot")).toBe(false);
    expect(repeatsShownFailure([card("c1")], { role: "bot", kind: "access", access: { reason: "key_refused", engine: "Claude", botId: "bot" } }, "bot")).toBe(true);
    // a row that is no failure is never a repeat
    expect(repeatsShownFailure(thread, { role: "bot", kind: "text" }, "bot")).toBe(false);
  });
});
