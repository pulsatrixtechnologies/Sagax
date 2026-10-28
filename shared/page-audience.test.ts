import { describe, expect, it } from "vitest";

import { pageAudienceOf, pageMayEnter, parsePageAudience, samePageAudience, shareAudienceBody } from "./page-audience.ts";

describe("page audience", () => {
  it("reads person, room and group, and refuses a wider guess", () => {
    expect(parsePageAudience({ audience: "person" })).toEqual({ ok: true, value: { kind: "person" } });
    expect(parsePageAudience({ kind: "room", id: " room-1 " })).toEqual({ ok: true, value: { kind: "room", id: "room-1" } });
    expect(parsePageAudience({ audience: "group", id: "g_2" }).ok).toBe(true);
    expect(parsePageAudience({ audience: "room" }).ok).toBe(false);
    expect(parsePageAudience({ audience: "org" }).ok).toBe(false);
    expect(parsePageAudience({ audience: "room", id: "../x" }).ok).toBe(false);
    expect(pageAudienceOf(undefined)).toEqual({ kind: "person" });
    expect(pageAudienceOf({ kind: "room" })).toEqual({ kind: "person" });
  });

  it("never puts a person page in a room or a group, and does not swap the two", () => {
    const person = pageAudienceOf(undefined);
    expect(pageMayEnter(person, { kind: "room", id: "room-1" })).toBe(false);
    expect(pageMayEnter(person, { kind: "group", id: "g1" })).toBe(false);
    const room = { kind: "room" as const, id: "room-1" };
    expect(pageMayEnter(room, { kind: "room", id: "room-1" })).toBe(true);
    expect(pageMayEnter(room, { kind: "room", id: "room-2" })).toBe(false);
    expect(pageMayEnter(room, { kind: "group", id: "room-1" })).toBe(false);
    const group = { kind: "group" as const, id: "g1" };
    expect(pageMayEnter(group, { kind: "group", id: "g1" })).toBe(true);
    expect(pageMayEnter(group, { kind: "room", id: "g1" })).toBe(false);
  });

  it("builds a share body only when the person named a real audience", () => {
    expect(shareAudienceBody("person", "")).toEqual({ audience: "person" });
    expect(shareAudienceBody("room", "room-1")).toEqual({ audience: "room", id: "room-1" });
    expect(shareAudienceBody("group", "")).toBeNull();
    expect(shareAudienceBody("link", "x")).toBeNull();
    expect(samePageAudience({ kind: "person" }, { kind: "person" })).toBe(true);
    expect(samePageAudience({ kind: "room", id: "a" }, { kind: "room", id: "b" })).toBe(false);
  });
});
