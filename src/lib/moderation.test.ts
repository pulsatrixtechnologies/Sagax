import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfigStatus, Message } from "@/state/store";
import { blockPerson, blockedDmSender, isBlockedId, isBlockedLine, personLineAuthor, unblockPerson } from "./moderation";

const config = { viewer: { operator: false, principalId: "pr_alex", email: "alex@example.test", name: "Alex", role: "member", canCreateBots: true } } as unknown as ConfigStatus;
const line = (fields: Partial<Message>): Message => ({ id: "m-1", role: "user", kind: "text", at: 1, text: "hi", ...fields }) as Message;

afterEach(() => {
  vi.unstubAllGlobals();
});

function answer(people: Array<{ id: string; name: string; at: number }>) {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ people }), { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("moderation (App Store 1.2)", () => {
  it("names the person behind someone else's line, never your own or a bot's", () => {
    expect(personLineAuthor(line({ sender: { id: "PR_SAM", name: "Sam" } }), config)).toEqual({ id: "pr_sam", name: "Sam" });
    expect(personLineAuthor(line({ sender: { id: "pr_alex", name: "Alex" } }), config)).toBeNull();
    expect(personLineAuthor(line({}), { viewer: { ...config.viewer!, operator: true } } as ConfigStatus)).toBeNull();
    expect(personLineAuthor(line({ role: "bot", from: { botId: "atlas", name: "Atlas", color: "blue" } }), config)).toBeNull();
    // a line with no id to hold on to is reported, not blocked
    expect(personLineAuthor(line({ sender: { name: "Sam" } }), config)).toBeNull();
  });

  it("folds a blocked person's lines only, and the block and unblock reach the server", async () => {
    const people = [{ id: "pr_sam", name: "Sam", at: 1 }];
    expect(isBlockedLine(line({ sender: { id: "pr_sam", name: "Sam" } }), config, people)).toBe(true);
    expect(isBlockedLine(line({ sender: { id: "pr_cara", name: "Cara" } }), config, people)).toBe(false);
    expect(isBlockedId(people, " PR_SAM ")).toBe(true);
    expect(isBlockedId(people, "")).toBe(false);

    const fetch = answer(people);
    await blockPerson({ id: "pr_sam", name: "Sam" });
    expect(fetch).toHaveBeenCalledWith("/api/me/blocks", expect.objectContaining({ method: "POST", body: JSON.stringify({ id: "pr_sam", name: "Sam" }) }));
    const dm = { threadId: "t-dm", peopleDm: true, humanIds: ["pr_alex", "PR_SAM"] };
    const room = { threadId: "t-room", peopleDm: false, humanIds: ["pr_alex", "pr_sam"] };
    expect(blockedDmSender("t-dm", { groups: [dm, room], config })).toBe(true);
    expect(blockedDmSender("t-room", { groups: [dm, room], config })).toBe(false);

    const back = answer([]);
    await unblockPerson("pr_sam");
    expect(back).toHaveBeenCalledWith("/api/me/blocks/pr_sam", expect.objectContaining({ method: "DELETE" }));
    expect(blockedDmSender("t-dm", { groups: [dm], config })).toBe(false);
  });
});
