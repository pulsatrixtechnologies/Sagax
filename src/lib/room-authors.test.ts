import { describe, expect, it } from "vitest";

import type { OrgDirectoryPerson } from "@/lib/perspicax-org";
import type { ConfigStatus } from "@/state/store";
import { continuesRun, isOwnMessage, personDisplayName, personInitials, roomAuthor, runCorners, RUN_GAP_MS } from "./room-authors";

const JC = "pr_jc";
const ZACK = "pr_zack";
const member = { viewer: { operator: false, principalId: JC, email: "jc@gox.ca", name: "JC", role: "member", canCreateBots: true, operatorName: "Operator Jo" } } as ConfigStatus;
const operator = { viewer: { operator: true, principalId: "pr_local", email: "op@gox.ca", name: "Op", role: "owner", canCreateBots: true } } as ConfigStatus;
const people = new Map<string, OrgDirectoryPerson>([
  [ZACK, { principalId: ZACK, name: "Zachary Sellam", login: "zsellam", email: "zack@gox.ca", role: "member", disabled: false, avatarUrl: "/api/people/pr_zack/avatar?v=3" }],
  ["pr_login", { principalId: "pr_login", name: "mlogin", login: "mlogin", email: "marie.l@gox.ca", role: "member", disabled: false }],
]);

describe("room authors", () => {
  it("reads a person as their display name, else the address's local part, else the login", () => {
    expect(personDisplayName({ name: "Zachary Sellam", login: "zsellam" })).toBe("Zachary Sellam");
    expect(personDisplayName({ name: "mlogin", login: "mlogin", email: "marie.l@gox.ca" })).toBe("marie.l");
    expect(personDisplayName({ name: "", login: "mlogin" })).toBe("mlogin");
  });

  it("makes initials from names and addresses", () => {
    expect(personInitials("Zachary Sellam")).toBe("ZS");
    expect(personInitials("marie.l")).toBe("ML");
    expect(personInitials("")).toBe("?");
  });

  it("places the viewer's own lines as self, whoever the viewer is", () => {
    expect(roomAuthor({ role: "user", sender: { name: "JC", id: JC } }, member, people)).toEqual({ kind: "self", key: "self" });
    expect(roomAuthor({ role: "user" }, operator, people)).toEqual({ kind: "self", key: "self" });
    expect(isOwnMessage({ role: "user", sender: { name: "JC", id: JC } }, member)).toBe(true);
    // An older server sends no viewer: every person line stays yours.
    expect(roomAuthor({ role: "user", sender: { name: "zack@gox.ca", id: ZACK } }, null, people).kind).toBe("self");
  });

  it("names other people from the directory, with their avatar", () => {
    expect(roomAuthor({ role: "user", sender: { name: "Zack (old)", id: ZACK } }, member, people)).toEqual({
      kind: "person", key: `person:${ZACK}`, name: "Zachary Sellam", initials: "ZS", avatarUrl: "/api/people/pr_zack/avatar?v=3",
      // a person of the directory: their name opens the person panel
      personId: people.get(ZACK.toLowerCase())!.principalId,
    });
    expect(roomAuthor({ role: "user", sender: { name: "mlogin", id: "PR_LOGIN" } }, member, people)).toMatchObject({ name: "marie.l", initials: "ML" });
    expect(roomAuthor({ role: "user", sender: { name: "guest@example.test", id: "g1" } }, operator, people)).toMatchObject({ kind: "person", name: "guest", key: "person:g1" });
    expect(roomAuthor({ role: "user" }, member, people)).toMatchObject({ kind: "person", name: "Operator Jo", key: "person:operator" });
  });

  it("keys bots by member id", () => {
    expect(roomAuthor({ role: "bot", from: { botId: "maya", name: "Maya", color: "green" } }, member, people)).toEqual({ kind: "bot", key: "bot:maya" });
  });

  it("groups consecutive lines from one author within five minutes", () => {
    const zack = roomAuthor({ role: "user", sender: { name: "Z", id: ZACK } }, member, people);
    const self = roomAuthor({ role: "user", sender: { name: "JC", id: JC } }, member, people);
    const at = new Date(2026, 9, 1, 12).getTime();
    expect(continuesRun({ at, author: zack }, { at: at + 60_000, author: zack })).toBe(true);
    expect(continuesRun({ at, author: zack }, { at: at + RUN_GAP_MS + 1, author: zack })).toBe(false);
    expect(continuesRun({ at, author: zack }, { at: at + 1, author: self })).toBe(false);
    expect(continuesRun({ at, author: zack, comm: {} }, { at: at + 1, author: zack })).toBe(false);
    expect(continuesRun(undefined, { at, author: zack })).toBe(false);
  });

  it("tightens the corner on the author's side, in logical terms", () => {
    expect(runCorners("end", true, true)).toBe("rounded-se-[6px] rounded-ee-[6px]");
    expect(runCorners("start", false, true)).toBe("rounded-es-[6px]");
    expect(runCorners("start", false, false)).toBe("");
  });
});
