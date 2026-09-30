// Slice 4: sidebar sections as channels (server/section-channels.ts).
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { botLevel, canInChannel, type TeamRef, type Viewer } from "./authz.ts";
import { createSectionChannelRoutes, migrationOwner, SectionChannels, validSectionName } from "./section-channels.ts";

const pid = (n: number) => `pr_00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ALICE = pid(1);
const BOB = pid(2);
const CAROL = pid(3);
const DAVE = pid(4);
const MIA = pid(5);
const ADMIN = pid(6);
const teams: Record<string, TeamRef[]> = { [CAROL]: [{ id: "T", manager: false }], [DAVE]: [{ id: "U", manager: false }], [MIA]: [{ id: "T", manager: true }] };
const viewerOf = (id: string): Viewer => ({ principalId: id, orgAdmin: id === ADMIN, teams: teams[id] ?? [], disabled: false });

describe("SectionChannels store", () => {
  it("migrates each section to a private record owned by the owner of most of its bots", () => {
    expect(migrationOwner([{ ownerPrincipalId: ALICE, createdAt: 3 }, { ownerPrincipalId: ALICE, createdAt: 4 }, { ownerPrincipalId: BOB, createdAt: 1 }], ADMIN)).toBe(ALICE);
    // a tie: the owner of the oldest bot among the tied owners
    expect(migrationOwner([{ ownerPrincipalId: ALICE, createdAt: 5 }, { ownerPrincipalId: BOB, createdAt: 2 }], ADMIN)).toBe(BOB);
    expect(migrationOwner([], ADMIN)).toBe(ADMIN);
    const path = join(mkdtempSync(join(tmpdir(), "sections-")), "section-channels.json");
    let n = 0;
    const channels = new SectionChannels({ path, newId: () => `sec_00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, now: () => 7 });
    expect(channels.migrate(["Support", "Ventes"], (name) => (name === "Support" ? ALICE : ADMIN))).toBe(2);
    expect(channels.migrate(["Support", "Ventes"], () => BOB)).toBe(0);
    expect(channels.byName("Support")).toMatchObject({ ownerPrincipalId: ALICE, members: [], defaultLevel: "use" });
    // private: no access facts at all
    expect(channels.accessFor("Support")).toBeNull();
    expect(statSync(path).mode & 0o777).toBe(0o600);
    channels.rename("Support", "Support QC");
    expect(channels.byName("Support QC")?.id).toBe("sec_00000000-0000-4000-8000-000000000001");
    channels.reconcile(["Support QC"]);
    expect(channels.list().map((r) => r.name)).toEqual(["Support QC"]);
    expect(JSON.parse(readFileSync(path, "utf8")).sections).toHaveLength(1);
    expect(new SectionChannels({ path }).list()).toHaveLength(1);
  });

  it("names: 1 to 60 characters without control characters", () => {
    expect(validSectionName("Ventes")).toBe(true);
    expect(validSectionName("")).toBe(false);
    expect(validSectionName("x".repeat(61))).toBe(false);
    expect(validSectionName("a\u0007b")).toBe(false);
    expect(validSectionName(42)).toBe(false);
  });

  it("access through a team, readonly cannot post, default level capped at run, owner opens nothing by owning", () => {
    const section = { ownerPrincipalId: ALICE, members: [{ target: "team:T", role: "readonly" as const }], defaultLevel: "run" as const };
    expect(botLevel({ viewer: viewerOf(CAROL), ownerPrincipalId: BOB, grants: [], sections: [section] })).toBe("run");
    expect(botLevel({ viewer: viewerOf(DAVE), ownerPrincipalId: BOB, grants: [], sections: [section] })).toBeNull();
    expect(botLevel({ viewer: viewerOf(ALICE), ownerPrincipalId: BOB, grants: [], sections: [section] })).toBeNull();
    expect(canInChannel(viewerOf(CAROL), "channel.read", { humanIds: [], section })).toBe(true);
    expect(canInChannel(viewerOf(CAROL), "channel.post", { humanIds: [], section })).toBe(false);
  });
});

function harness() {
  const path = join(mkdtempSync(join(tmpdir(), "sections-routes-")), "section-channels.json");
  let n = 0;
  const channels = new SectionChannels({ path, newId: () => `sec_00000000-0000-4000-8000-${String(++n).padStart(12, "0")}` });
  const sections = new Set<string>(["Support"]);
  const bots: Record<string, { owner: string; section?: string; manage?: string[] }> = {
    v: { owner: ALICE }, w: { owner: BOB, manage: [ALICE] }, x: { owner: BOB },
  };
  const rooms = new Set<string>();
  let changed = 0;
  channels.migrate([...sections], () => ALICE);
  const route = createSectionChannelRoutes({
    channels,
    viewer: (auth) => {
      const id = (auth as unknown as { actor?: string }).actor;
      return id ? viewerOf(id) : undefined;
    },
    principalId: (auth) => (auth as unknown as { actor: string }).actor,
    teamsOf: (id) => teams[id] ?? [],
    resolvePerson: (ref) => ([ALICE, BOB, CAROL, DAVE, MIA, ADMIN].includes(ref) ? { ok: true, id: ref } : { ok: false, code: "unknown_person" }),
    teamKnown: (id) => id === "T" || id === "U",
    sections: () => [...sections],
    createSection: (name) => { sections.add(name); return undefined; },
    renameSection: (name, next) => {
      sections.delete(name); sections.add(next);
      for (const bot of Object.values(bots)) if (bot.section === name) bot.section = next;
      return undefined;
    },
    deleteSection: (name) => {
      sections.delete(name);
      for (const bot of Object.values(bots)) if (bot.section === name) delete bot.section;
      return undefined;
    },
    moveBots: (name, add, remove) => {
      for (const id of add) bots[id]!.section = name;
      for (const id of remove) delete bots[id]!.section;
      return undefined;
    },
    botExists: (id) => id in bots,
    botSection: (id) => bots[id]?.section,
    botOwner: (id) => bots[id]?.owner ?? "",
    managesBot: (auth, id) => {
      const actor = (auth as unknown as { actor: string }).actor;
      return bots[id]!.owner === actor || Boolean(bots[id]!.manage?.includes(actor));
    },
    createRoom: (name) => { const id = `room-${name}`; rooms.add(id); return id; },
    roomExists: (id) => rooms.has(id),
    onChanged: () => { changed += 1; },
  });
  const call = async (actor: string | undefined, method: string, path: string, body?: unknown) => {
    let answer: { status: number; body: any } | undefined;
    await route({
      req: {} as never,
      res: { setHeader: () => {} } as never,
      url: new URL(`http://x${path}`),
      path,
      method,
      auth: { actor } as never,
      json: ((_res: unknown, status: number, payload: unknown) => { answer = { status, body: payload }; }) as never,
      readBody: (async () => body) as never,
    });
    return answer!;
  };
  return { channels, sections, bots, rooms, call, changed: () => changed };
}

describe("section access follows the bot owner's consent", () => {
  it("a mixed section shared by one owner gives nothing on another owner's bot", async () => {
    const h = harness();
    // before slice 4: carol's bot y sat in Support with alice's v
    h.bots.v!.section = "Support";
    h.bots.y = { owner: CAROL, section: "Support" };
    const record = h.channels.byName("Support")!;
    expect(record.ownerPrincipalId).toBe(ALICE);
    expect((await h.call(ALICE, "PUT", `/api/org/sections/${record.id}/members`, { members: [{ target: "team:U", role: "participant" }], defaultLevel: "run" })).status).toBe(200);
    const onV = h.channels.accessForBot("Support", { id: "v", ownerPrincipalId: ALICE });
    const onY = h.channels.accessForBot("Support", { id: "y", ownerPrincipalId: CAROL });
    expect(onV).not.toBeNull();
    expect(onY).toBeNull();
    expect(botLevel({ viewer: viewerOf(DAVE), ownerPrincipalId: ALICE, grants: [], sections: onV ? [onV] : [] })).toBe("run");
    expect(botLevel({ viewer: viewerOf(DAVE), ownerPrincipalId: CAROL, grants: [], sections: onY ? [onY] : [] })).toBeNull();
  });

  it("a bot placed through the section route by someone who manages it is shared; taking it out forgets it", async () => {
    const h = harness();
    const id = (await h.call(ALICE, "POST", "/api/org/sections", { name: "Ventes" })).body.section.id;
    await h.call(ALICE, "PUT", `/api/org/sections/${id}/members`, { members: [{ target: `user:${BOB}`, role: "participant" }] });
    expect((await h.call(BOB, "PUT", `/api/org/sections/${id}/bots`, { add: ["x"] })).status).toBe(200);
    expect(h.channels.accessForBot("Ventes", { id: "x", ownerPrincipalId: BOB })).not.toBeNull();
    // the consent is bob's: once x changes hands it no longer counts
    expect(h.channels.accessForBot("Ventes", { id: "x", ownerPrincipalId: CAROL })).toBeNull();
    expect((await h.call(BOB, "PUT", `/api/org/sections/${id}/bots`, { remove: ["x"] })).status).toBe(200);
    expect(h.channels.accessForBot("Ventes", { id: "x", ownerPrincipalId: BOB })).toBeNull();
    // alice holds manage on bob's w: placing it counts as bob's delegate
    expect((await h.call(ALICE, "PUT", `/api/org/sections/${id}/bots`, { add: ["w"] })).status).toBe(200);
    expect(h.channels.accessForBot("Ventes", { id: "w", ownerPrincipalId: BOB })).not.toBeNull();
    // the consent survives a rename
    expect((await h.call(ALICE, "PATCH", `/api/org/sections/${id}`, { name: "Ventes QC" })).status).toBe(200);
    expect(h.channels.accessForBot("Ventes QC", { id: "w", ownerPrincipalId: BOB })).not.toBeNull();
  });
});

describe("section routes", () => {
  it("creates a section owned by the caller, refuses General and duplicates", async () => {
    const h = harness();
    const created = await h.call(ALICE, "POST", "/api/org/sections", { name: "Ventes" });
    expect(created).toMatchObject({ status: 201, body: { section: { name: "Ventes", ownerPrincipalId: ALICE, viewerRole: "owner", canModerate: true, members: [] } } });
    expect((await h.call(ALICE, "POST", "/api/org/sections", { name: "general" })).body.code).toBe("general_is_personal");
    expect((await h.call(ALICE, "POST", "/api/org/sections", { name: "Ventes" })).status).toBe(409);
    expect((await h.call(ALICE, "POST", "/api/org/sections", { name: "" })).status).toBe(400);
    expect((await h.call(ALICE, "PUT", "/api/org/sections/general/members", { members: [] })).body.code).toBe("general_is_personal");
    expect((await h.call(ALICE, "PATCH", "/api/org/sections/general", { name: "x" })).body.code).toBe("general_is_personal");
  });

  it("shares with a team: the room is created, members see it, readonly and roles validated", async () => {
    const h = harness();
    const id = (await h.call(ALICE, "POST", "/api/org/sections", { name: "Ventes" })).body.section.id;
    expect((await h.call(ALICE, "PUT", `/api/org/sections/${id}/members`, { members: [{ target: "team:T", role: "boss" }] })).body.code).toBe("bad_role");
    expect((await h.call(ALICE, "PUT", `/api/org/sections/${id}/members`, { members: [{ target: "bob", role: "participant" }] })).body.code).toBe("bad_target");
    expect((await h.call(ALICE, "PUT", `/api/org/sections/${id}/members`, { members: [], defaultLevel: "edit" })).body.code).toBe("bad_level");
    expect((await h.call(ALICE, "PUT", `/api/org/sections/${id}/members`, { members: [{ target: "team:ZZ", role: "participant" }] })).body.code).toBe("unknown_team");
    expect((await h.call(ALICE, "PUT", `/api/org/sections/${id}/members`, { members: [{ target: `user:${pid(99)}`, role: "participant" }] })).body.code).toBe("unknown_person");
    const shared = await h.call(ALICE, "PUT", `/api/org/sections/${id}/members`, { members: [{ target: "team:T", role: "participant" }], defaultLevel: "use" });
    expect(shared).toMatchObject({ status: 200, body: { section: { members: [{ target: "team:T", role: "participant" }], roomId: "room-Ventes" } } });
    expect(h.channels.accessFor("Ventes")).toMatchObject({ members: [{ target: "team:T" }] });
    // carol (in T) lists it; dave does not
    expect((await h.call(CAROL, "GET", "/api/org/sections")).body.sections.map((s: { name: string }) => s.name)).toEqual(["Ventes"]);
    expect((await h.call(CAROL, "GET", "/api/org/sections")).body.sections[0]).toMatchObject({ viewerRole: "participant", canModerate: false });
    expect((await h.call(DAVE, "GET", "/api/org/sections")).body.sections).toEqual([]);
    // a participant may not rename or change members
    expect((await h.call(CAROL, "PATCH", `/api/org/sections/${id}`, { name: "Nope" })).status).toBe(403);
    expect((await h.call(CAROL, "PUT", `/api/org/sections/${id}/members`, { members: [] })).status).toBe(403);
  });

  it("rename and delete need channel.moderate and keep the record in step", async () => {
    const h = harness();
    const id = (await h.call(ALICE, "POST", "/api/org/sections", { name: "Ventes" })).body.section.id;
    await h.call(ALICE, "PUT", `/api/org/sections/${id}/members`, { members: [{ target: `user:${BOB}`, role: "moderator" }] });
    expect((await h.call(BOB, "PATCH", `/api/org/sections/${id}`, { name: "Ventes QC" })).status).toBe(200);
    expect(h.channels.byId(id)).toMatchObject({ name: "Ventes QC", members: [{ target: `user:${BOB}` }] });
    expect(h.sections.has("Ventes QC")).toBe(true);
    expect((await h.call(DAVE, "DELETE", `/api/org/sections/${id}`)).status).toBe(403);
    expect((await h.call(ADMIN, "DELETE", `/api/org/sections/${id}`)).status).toBe(200);
    expect(h.channels.byId(id)).toBeNull();
    expect(h.sections.has("Ventes QC")).toBe(false);
  });

  it("moving a bot in needs manage on it and participant or more; out needs manage or moderate", async () => {
    const h = harness();
    const id = (await h.call(ALICE, "POST", "/api/org/sections", { name: "Ventes" })).body.section.id;
    expect((await h.call(ALICE, "PUT", `/api/org/sections/${id}/bots`, { add: ["v"] })).status).toBe(200);
    expect(h.bots.v!.section).toBe("Ventes");
    // alice manages w (manage grant) and owns the section
    expect((await h.call(ALICE, "PUT", `/api/org/sections/${id}/bots`, { add: ["w"] })).status).toBe(200);
    // x is bob's and alice has no manage on it
    expect((await h.call(ALICE, "PUT", `/api/org/sections/${id}/bots`, { add: ["x"] })).status).toBe(403);
    // bob owns x but is not a member of the section
    expect((await h.call(BOB, "PUT", `/api/org/sections/${id}/bots`, { add: ["x"] })).status).toBe(403);
    await h.call(ALICE, "PUT", `/api/org/sections/${id}/members`, { members: [{ target: `user:${BOB}`, role: "readonly" }] });
    expect((await h.call(BOB, "PUT", `/api/org/sections/${id}/bots`, { add: ["x"] })).status).toBe(403);
    await h.call(ALICE, "PUT", `/api/org/sections/${id}/members`, { members: [{ target: `user:${BOB}`, role: "participant" }] });
    expect((await h.call(BOB, "PUT", `/api/org/sections/${id}/bots`, { add: ["x"] })).status).toBe(200);
    // bob takes his own bot out; alice (owner, moderates) takes w out
    expect((await h.call(BOB, "PUT", `/api/org/sections/${id}/bots`, { remove: ["v"] })).status).toBe(403);
    expect((await h.call(ALICE, "PUT", `/api/org/sections/${id}/bots`, { remove: ["x"] })).status).toBe(200);
    expect((await h.call(ALICE, "PUT", `/api/org/sections/${id}/bots`, { add: ["nope"] })).status).toBe(404);
  });

  it("a manager changes entries of their teams only with an anchor", async () => {
    const h = harness();
    const id = (await h.call(ALICE, "POST", "/api/org/sections", { name: "Ventes" })).body.section.id;
    // no anchor: mia cannot add her team
    expect((await h.call(MIA, "PUT", `/api/org/sections/${id}/members`, { members: [{ target: "team:T", role: "readonly" }] })).status).toBe(403);
    await h.call(ALICE, "PUT", `/api/org/sections/${id}/members`, { members: [{ target: "team:T", role: "participant" }] });
    // with the anchor: add carol up to participant, never moderator; dave is not hers
    expect((await h.call(MIA, "PUT", `/api/org/sections/${id}/members`, { members: [{ target: "team:T", role: "participant" }, { target: `user:${CAROL}`, role: "participant" }] })).status).toBe(200);
    expect((await h.call(MIA, "PUT", `/api/org/sections/${id}/members`, { members: [{ target: "team:T", role: "participant" }, { target: `user:${CAROL}`, role: "moderator" }] })).status).toBe(403);
    expect((await h.call(MIA, "PUT", `/api/org/sections/${id}/members`, { members: [{ target: "team:T", role: "participant" }, { target: `user:${DAVE}`, role: "readonly" }] })).status).toBe(403);
    // removing her team is always allowed
    expect((await h.call(MIA, "PUT", `/api/org/sections/${id}/members`, { members: [] })).status).toBe(200);
    // the default level is the moderators' call
    expect((await h.call(MIA, "PUT", `/api/org/sections/${id}/members`, { members: [], defaultLevel: "run" })).status).toBe(403);
  });
});
