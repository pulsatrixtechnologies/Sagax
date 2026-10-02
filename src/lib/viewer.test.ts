import { describe, expect, it } from "vitest";

import type { ConfigStatus } from "@/state/store";
import { otherAuthorName, viewerActorId, viewerBotsReadOnly, viewerCanCreateBots, viewerIsOrgMember } from "./viewer";

const ZARA = "pr_00000000-0000-4000-8000-000000000002";
const member = { viewer: { operator: false, principalId: ZARA, email: "zara@example.test", name: "zara", role: "member", canCreateBots: true, operatorName: "JC" } } as ConfigStatus;
const operator = { viewer: { operator: true, principalId: "pr_local", email: "jc@gox.ca", name: "JC", role: "owner", canCreateBots: true } } as ConfigStatus;

describe("viewer", () => {
  it("uses the server's principal, else the profile email, else local-owner", () => {
    expect(viewerActorId(member)).toBe(ZARA);
    expect(viewerActorId({ profile: { name: "JC", email: "JC@gox.ca" } } as ConfigStatus)).toBe("jc@gox.ca");
    expect(viewerActorId(null)).toBe("local-owner");
  });

  it("reads a read-only person and an organization member from the server's viewer", () => {
    expect(viewerBotsReadOnly(member)).toBe(false);
    expect(viewerBotsReadOnly({ viewer: { ...member.viewer!, canCreateBots: false, botsReadOnly: true } } as ConfigStatus)).toBe(true);
    expect(viewerBotsReadOnly(undefined)).toBe(false);
    expect(viewerIsOrgMember(member)).toBe(true);
    expect(viewerIsOrgMember(operator)).toBe(false);
    expect(viewerIsOrgMember(null)).toBe(false);
  });

  it("offers New bot on the server's word, and by default for older servers", () => {
    expect(viewerCanCreateBots(member)).toBe(true);
    expect(viewerCanCreateBots({ viewer: { ...member.viewer!, canCreateBots: false } } as ConfigStatus)).toBe(false);
    expect(viewerCanCreateBots(undefined)).toBe(true);
  });

  it("names another person's line and leaves your own unnamed", () => {
    const fromZara = { role: "user" as const, sender: { name: "zara@example.test", id: ZARA } };
    const fromOperator = { role: "user" as const };
    expect(otherAuthorName(fromZara, member)).toBeNull();
    expect(otherAuthorName(fromOperator, member)).toBe("JC");
    expect(otherAuthorName(fromZara, operator)).toBe("zara@example.test");
    expect(otherAuthorName(fromOperator, operator)).toBeNull();
    expect(otherAuthorName({ role: "bot" }, member)).toBeNull();
    expect(otherAuthorName(fromZara, null)).toBeNull();
  });
});
