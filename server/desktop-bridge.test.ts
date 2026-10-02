// The desktop bridge (server/desktop-bridge.ts): where a turn's tools run on
// an organization server (the routing table), and that a bridge relays only
// for the signed-in person who connected it, only while connected.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { DesktopBridges, resolveBotWorkplace, type DesktopBridgeRegistration } from "./desktop-bridge.ts";
import { desktopToolOperation, handleDesktopBridgeMcp } from "./desktop-bridge-tools.ts";
import { DEFAULT_BOT_WORKPLACE, parseBotWorkplace, serializeBotWorkplace } from "../shared/bot-workplace.ts";

const ADA = "pr_11111111-1111-4111-8111-111111111111";
const BOB = "pr_22222222-2222-4222-8222-222222222222";
const secret = "a".repeat(64);
const registration = (name = "Ada's Mac"): DesktopBridgeRegistration => ({
  id: randomUUID(), name, platform: "darwin", attachmentsDir: "/var/folders/x/T/Sagax/attachments",
  capabilities: { shell: true, files: true, fetch: true, browser: true, computer: false, localVm: true },
});

describe("where a turn's tools run (organization server)", () => {
  const base = {
    organization: true, sandboxConfigured: true, desktopTargeted: false, routine: false,
    principal: ADA, personAsked: true, preference: { ...DEFAULT_BOT_WORKPLACE }, desktopConnected: true,
  };
  it("solo server: its own machine, unchanged", () => {
    expect(resolveBotWorkplace({ ...base, organization: false })).toMatchObject({ target: "host", reason: "solo" });
  });
  it("conversation, desktop connected: the speaker's own computer (default preference)", () => {
    expect(resolveBotWorkplace(base)).toEqual({ target: "user-desktop", principal: ADA, reason: "desktop", fallback: false });
  });
  it("conversation, desktop not connected: the server environment, and says it is a fallback", () => {
    expect(resolveBotWorkplace({ ...base, desktopConnected: false })).toEqual({ target: "user-sandbox", principal: ADA, reason: "desktop-not-connected", fallback: true });
    expect(resolveBotWorkplace({ ...base, desktopConnected: false, sandboxConfigured: false })).toMatchObject({ target: "none", fallback: true });
  });
  it("the person chose their server environment: never their computer", () => {
    expect(resolveBotWorkplace({ ...base, preference: { ...DEFAULT_BOT_WORKPLACE, place: "server" } })).toMatchObject({ target: "user-sandbox", reason: "preference-server", fallback: false });
  });
  it("routines: the owner's sandbox unless their desktop is connected AND they allowed routines on it", () => {
    const routine = { ...base, routine: true, personAsked: false };
    expect(resolveBotWorkplace(routine)).toMatchObject({ target: "user-sandbox", reason: "routine-not-allowed" });
    expect(resolveBotWorkplace({ ...routine, preference: { ...DEFAULT_BOT_WORKPLACE, routines: true } })).toMatchObject({ target: "user-desktop", reason: "desktop" });
    expect(resolveBotWorkplace({ ...routine, preference: { ...DEFAULT_BOT_WORKPLACE, routines: true }, desktopConnected: false })).toMatchObject({ target: "user-sandbox" });
    expect(resolveBotWorkplace({ ...routine, preference: { place: "server", routines: true, network: "all" } })).toMatchObject({ target: "user-sandbox" });
  });
  it("rooms: the person whose message triggered the turn; a follow-up nobody asked for never reaches a computer", () => {
    expect(resolveBotWorkplace({ ...base, principal: BOB })).toMatchObject({ target: "user-desktop", principal: BOB });
    expect(resolveBotWorkplace({ ...base, personAsked: false })).toMatchObject({ target: "user-sandbox", reason: "no-person" });
  });
  it("nobody known: nothing at all", () => {
    expect(resolveBotWorkplace({ ...base, principal: null })).toMatchObject({ target: "none", principal: null });
  });
  it("a conversation pinned to This computer keeps the person's computer", () => {
    expect(resolveBotWorkplace({ ...base, desktopTargeted: true, desktopConnected: false })).toMatchObject({ target: "user-desktop", reason: "pinned-desktop" });
  });
  it("the preference reads defensively", () => {
    expect(parseBotWorkplace(undefined)).toEqual({ place: "computer", routines: false, network: "all" });
    expect(parseBotWorkplace("{bad")).toEqual({ place: "computer", routines: false, network: "all" });
    expect(parseBotWorkplace(serializeBotWorkplace({ place: "server", routines: true, network: "lan" }))).toEqual({ place: "server", routines: true, network: "lan" });
  });
});

function hub() {
  const people = new Map([["ada-session", ADA], ["bob-session", BOB]]);
  const bridges = new DesktopBridges((session) => people.get(session) ?? null);
  return { bridges, people };
}

describe("the bridge relays only for its own signed-in person", () => {
  it("binds the desktop to the session's person, never to the body", async () => {
    const { bridges } = hub();
    const desktop = registration();
    bridges.register(desktop, "ada-session", secret);
    expect(bridges.connected(ADA)).toBe(true);
    expect(bridges.connected(BOB)).toBe(false);
    expect(bridges.current(ADA.toUpperCase())?.id).toBe(desktop.id);
  });

  it("a bot turn for Bob never reaches Ada's desktop", async () => {
    const { bridges } = hub();
    bridges.register(registration(), "ada-session", secret);
    await expect(bridges.request(BOB, { action: "run_command", command: "id" }, () => true)).rejects.toMatchObject({ code: "not_connected" });
    await expect(bridges.request(null, { action: "run_command", command: "id" }, () => true)).rejects.toMatchObject({ code: "no_person" });
  });

  it("another session cannot poll, answer or tunnel for a desktop it did not register, even with its secret", async () => {
    const { bridges } = hub();
    const desktop = registration();
    bridges.register(desktop, "ada-session", secret);
    await expect(bridges.poll(desktop.id, "bob-session", secret, 10)).rejects.toMatchObject({ status: 403 });
    expect(bridges.owns(desktop.id, "bob-session", secret)).toBe(false);
    expect(bridges.owns(desktop.id, "ada-session", "b".repeat(64))).toBe(false);
    expect(bridges.owns(desktop.id, "ada-session", secret)).toBe(true);
  });

  it("a session that is now someone else's (or ended) relays for nobody and the bridge closes", async () => {
    const { bridges, people } = hub();
    const desktop = registration();
    bridges.register(desktop, "ada-session", secret);
    const pending = bridges.request(ADA, { action: "run_command", command: "sleep 1" }, () => true);
    people.set("ada-session", BOB);
    await expect(bridges.poll(desktop.id, "ada-session", secret, 10)).rejects.toMatchObject({ status: 403 });
    await expect(pending).rejects.toThrow(/not connected/);
    expect(bridges.connected(ADA)).toBe(false);
    expect(bridges.connected(BOB)).toBe(false);
  });

  it("round trip: queued for the person's desktop, polled, answered; refused after the turn ended", async () => {
    const { bridges } = hub();
    const desktop = registration();
    bridges.register(desktop, "ada-session", secret);
    let live = true;
    const answer = bridges.request(ADA, { action: "read_file", path: "~/notes.md" }, () => live);
    const job = await bridges.poll(desktop.id, "ada-session", secret, 10);
    expect(job?.operation).toEqual({ action: "read_file", path: "~/notes.md" });
    bridges.complete(desktop.id, "ada-session", secret, job!.id, { content: [{ type: "text", text: "hello" }] });
    await expect(answer).resolves.toEqual({ content: [{ type: "text", text: "hello" }] });
    live = false;
    await expect(bridges.request(ADA, { action: "list_files" }, () => live)).rejects.toThrow(/turn ended/);
  });

  it("an action the desktop does not offer is refused before it is queued", async () => {
    const { bridges } = hub();
    bridges.register(registration(), "ada-session", secret);
    await expect(bridges.request(ADA, { action: "computer_tools" }, () => true)).rejects.toMatchObject({ code: "capability" });
  });

  it("status shows only the person's own desktops, without secrets", () => {
    const { bridges } = hub();
    bridges.register(registration("Ada's Mac"), "ada-session", secret);
    bridges.register(registration("Bob's PC"), "bob-session", secret);
    const mine = bridges.status(ADA);
    expect(mine.map((entry) => entry.name)).toEqual(["Ada's Mac"]);
    expect(JSON.stringify(mine)).not.toContain(secret);
  });
});

describe("the sagax-desktop tools", () => {
  it("become typed operations, rejecting bad arguments", () => {
    expect(desktopToolOperation("run_command", { command: "ls", timeout_seconds: 9999 })).toMatchObject({ action: "run_command", command: "ls", timeout_seconds: 600 });
    expect(desktopToolOperation("local_vm", { action: "run", command: "uname" })).toMatchObject({ action: "vm_run_command", command: "uname" });
    expect(desktopToolOperation("fetch_url", { url: "http://intranet.local/x" })).toMatchObject({ action: "fetch_url", url: "http://intranet.local/x" });
    expect(() => desktopToolOperation("fetch_url", { url: "file:///etc/passwd" })).toThrow();
    expect(() => desktopToolOperation("fetch_url", { url: "https://user:pw@x.test/" })).toThrow();
    expect(() => desktopToolOperation("search_files", {})).toThrow();
    expect(() => desktopToolOperation("nope", {})).toThrow();
  });
  it("lists the solo-mode set and turns a refusal into a tool error", async () => {
    const listed = await handleDesktopBridgeMcp("tools/list", {}, async () => null) as { tools: { name: string }[] };
    expect(listed.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(["run_command", "read_file", "write_file", "search_files", "fetch_url", "browse", "computer_use", "local_vm"]));
    const refused = await handleDesktopBridgeMcp("tools/call", { name: "run_command", arguments: { command: "ls" } }, async () => { throw new Error("Your computer is not connected right now."); });
    expect(refused).toEqual({ content: [{ type: "text", text: "Your computer is not connected right now." }], isError: true });
  });
});

describe("the person's own computer in their Computer tab", () => {
  it("keeps coarse system facts for that person's desktop only", async () => {
    const sessions = new Map([["s-ada", ADA], ["s-bob", BOB]]);
    const bridges = new DesktopBridges((session) => sessions.get(session) ?? null);
    const ada = registration();
    bridges.register(ada, "s-ada", secret);
    const system = { os: "macOS 27.0", arch: "arm64", cpus: 10, cpuPercent: 15, memoryGb: 32, memoryUsedGb: 18.5, diskGb: 994, diskFreeGb: 410 };
    expect(() => bridges.setSystem(ada.id, "s-bob", secret, system)).toThrow();
    expect(() => bridges.setSystem(ada.id, "s-ada", "b".repeat(64), system)).toThrow();
    bridges.setSystem(ada.id, "s-ada", secret, system);
    expect(bridges.status(ADA)[0]!.system).toEqual(system);
    expect(bridges.status(BOB)).toEqual([]);
    const { desktopSystemInfo } = await import("./desktop-bridge.ts");
    expect(desktopSystemInfo.safeParse({ ...system, hostname: "ada-mbp" }).success).toBe(false);
    expect(desktopSystemInfo.safeParse({ ...system, os: "x".repeat(81) }).success).toBe(false);
  });
});
