// Whose Data database a turn or a panel request reaches: the bot's for its
// owner and on a solo server, a person's own on someone else's shared bot of
// an organization server, a confidential thread's own through the hook, and
// the live frames that follow the same rule.
import { createHash } from "node:crypto";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  dataFrameAllowed,
  dataScopeAudience,
  dataScopeBotId,
  DATA_SCOPES_ROOT,
  dataScopeFolder,
  dataScopesFolderOf,
  dataScopeKey,
  dataScopeKind,
  dataScopeThread,
  forgetDataScopes,
  setConfidentialThreadResolver,
  threadScopeKeyFor,
} from "./scope.ts";

afterEach(() => setConfidentialThreadResolver(null));

const hex = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);
const org = { botId: "bot-1", organization: true, ownerPrincipalId: "Owner@Example.com" };

describe("dataScopeKey", () => {
  it("keeps the bot id on a solo server, whoever speaks (no migration)", () => {
    expect(dataScopeKey({ ...org, organization: false, principalId: "someone-else" })).toBe("bot-1");
    expect(dataScopeKey({ ...org, organization: false })).toBe("bot-1");
  });

  it("keeps the bot id for the owner, a routine or the operator on an organization server", () => {
    expect(dataScopeKey({ ...org, principalId: "owner@example.com" })).toBe("bot-1");
    expect(dataScopeKey({ ...org, principalId: "  OWNER@example.com " })).toBe("bot-1");
    expect(dataScopeKey({ ...org })).toBe("bot-1");
  });

  it("gives another person their own key, stable and naming no one", () => {
    const key = dataScopeKey({ ...org, principalId: "B@Example.com" })!;
    expect(key).toBe(`bot-1~p-${hex("b@example.com")}`);
    expect(key).not.toContain("example");
    expect(key).not.toMatch(/[\\/]/);
    expect(dataScopeKey({ ...org, principalId: "b@example.com" })).toBe(key);
    expect(dataScopeKey({ ...org, principalId: "c@example.com" })).not.toBe(key);
    expect(dataScopeKind(key)).toBe("person");
    expect(dataScopeBotId(key)).toBe("bot-1");
    expect(dataScopeAudience(key)).toBe("b@example.com");
  });

  it("never gives an unknown speaker the owner's database", () => {
    const key = dataScopeKey({ ...org, principalId: "" })!;
    expect(key).not.toBe("bot-1");
    expect(dataScopeKind(key)).toBe("person");
    expect(dataScopeAudience(key)).toBe("");
  });

  it("gives a confidential thread its own key through the hook, for its owner only", () => {
    setConfidentialThreadResolver((threadId) => (threadId === "t-secret" ? { ownerPrincipalId: "B@example.com" } : null));
    const key = dataScopeKey({ ...org, principalId: "b@example.com", threadId: "t-secret" })!;
    expect(key).toBe(`bot-1~t-${hex("t-secret")}`);
    expect(dataScopeKind(key)).toBe("thread");
    expect(dataScopeThread(key)).toBe("t-secret");
    expect(dataScopeAudience(key)).toBe("b@example.com");
    // the bot's owner and anyone else are refused
    expect(dataScopeKey({ ...org, principalId: "owner@example.com", threadId: "t-secret" })).toBeNull();
    expect(dataScopeKey({ ...org, principalId: "c@example.com", threadId: "t-secret" })).toBeNull();
    // even on a solo server it never mixes with the bot's database
    expect(dataScopeKey({ ...org, organization: false, threadId: "t-secret" })).toBe(key);
    // an ordinary thread is unchanged
    expect(dataScopeKey({ ...org, principalId: "b@example.com", threadId: "t-plain" })).toBe(`bot-1~p-${hex("b@example.com")}`);
  });

  it("fails closed when the hook throws or names no owner", () => {
    setConfidentialThreadResolver(() => { throw new Error("store unavailable"); });
    expect(dataScopeKey({ ...org, principalId: "owner@example.com", threadId: "t-1" })).toBeNull();
    setConfidentialThreadResolver(() => ({ ownerPrincipalId: "" }));
    expect(dataScopeKey({ ...org, principalId: "owner@example.com", threadId: "t-1" })).toBeNull();
    setConfidentialThreadResolver(null);
    expect(dataScopeKey({ ...org, principalId: "owner@example.com", threadId: "t-1" })).toBe("bot-1");
  });

  it("puts a derived scope's folder outside its bot's folder, which the bot scope's database reaches", () => {
    const folder = (botId: string) => join("/data/bots", botId);
    expect(dataScopeFolder("bot-1", folder, "/data/data-scopes")).toBe(join("/data/bots", "bot-1"));
    expect(dataScopeFolder("bot-1~p-0123456789abcdef", folder, "/data/data-scopes")).toBe(join("/data/data-scopes", "bot-1", "p-0123456789abcdef"));
    expect(dataScopeFolder("bot-1~t-0123456789abcdef", folder, "/data/data-scopes")).toBe(join("/data/data-scopes", "bot-1", "t-0123456789abcdef"));
    expect(dataScopesFolderOf("bot-1", "/data/data-scopes")).toBe(join("/data/data-scopes", "bot-1"));
    // the server's defaults: never below DATA_DIR/bots/<id>
    expect(dataScopeFolder("bot-1~p-0123456789abcdef").startsWith(join(dataScopeFolder("bot-1"), "/"))).toBe(false);
    expect(dataScopeFolder("bot-1~p-0123456789abcdef").startsWith(DATA_SCOPES_ROOT)).toBe(true);
  });

  it("names a confidential thread's scope the way dataScopeKey does", () => {
    setConfidentialThreadResolver(() => ({ ownerPrincipalId: "owner@example.com" }));
    expect(dataScopeKey({ ...org, principalId: "owner@example.com", threadId: "t-9" })).toBe(threadScopeKeyFor("bot-1", "t-9"));
    expect(threadScopeKeyFor("bot-1", "t-9")).toBe(`bot-1~t-${hex("t-9")}`);
  });

  it("forgets a deleted bot's derived keys", () => {
    const key = dataScopeKey({ ...org, botId: "gone", principalId: "b@example.com" })!;
    const kept = dataScopeKey({ ...org, botId: "kept", principalId: "b@example.com" })!;
    forgetDataScopes("gone");
    expect(dataScopeAudience(key)).toBeUndefined();
    expect(dataScopeAudience(kept)).toBe("b@example.com");
  });
});

describe("dataFrameAllowed", () => {
  const local = "operator@example.com";
  it("lets other frames and a solo server's data frames through", () => {
    expect(dataFrameAllowed({ kind: "bot", audience: "x" }, "b@example.com", local)).toBe(true);
    expect(dataFrameAllowed({ kind: "data" }, "b@example.com", local)).toBe(true);
    expect(dataFrameAllowed({ kind: "data" }, undefined, local)).toBe(true);
  });

  it("sends a bot scope to its owner and the loopback stream only", () => {
    const frame = { kind: "data", audience: "owner@example.com", dataScope: "bot" };
    expect(dataFrameAllowed(frame, "Owner@example.com", local)).toBe(true);
    expect(dataFrameAllowed(frame, "b@example.com", local)).toBe(false);
    expect(dataFrameAllowed(frame, undefined, local)).toBe(true);
  });

  it("sends a person's scope to that person only", () => {
    const frame = { kind: "data", audience: "b@example.com", dataScope: "person" };
    expect(dataFrameAllowed(frame, "b@example.com", local)).toBe(true);
    expect(dataFrameAllowed(frame, "owner@example.com", local)).toBe(false);
    expect(dataFrameAllowed(frame, undefined, local)).toBe(false);
    expect(dataFrameAllowed({ ...frame, audience: local }, undefined, local)).toBe(true);
  });

  it("sends a frame with an unknown audience to no one", () => {
    expect(dataFrameAllowed({ kind: "data", audience: "", dataScope: "person" }, "anon:1", local)).toBe(false);
    expect(dataFrameAllowed({ kind: "data", audience: "", dataScope: "person" }, undefined, local)).toBe(false);
    expect(dataFrameAllowed({ kind: "data", audience: null, dataScope: "person" }, "b@example.com", local)).toBe(false);
  });
});
