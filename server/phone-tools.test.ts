import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createPhoneToolBroker, PHONE_ONLINE_MS, phoneToolTurn, type PhoneToolAuditRow } from "./phone-tools.ts";

describe("phone tool broker", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function setup(options: { pushable?: boolean } = {}) {
    const dataDir = mkdtempSync(join(tmpdir(), "sagax-phone-tools-"));
    dirs.push(dataDir);
    let clock = 1_000_000;
    const notified: string[] = [];
    const pushed: string[] = [];
    const audit: PhoneToolAuditRow[] = [];
    const broker = createPhoneToolBroker({
      dataDir,
      now: () => clock,
      notify: (person) => notified.push(person),
      push: (person, request) => pushed.push(`${person}:${request.tool}`),
      pushable: () => options.pushable === true,
      audit: (row) => audit.push(row),
    });
    return { broker, dataDir, notified, pushed, audit, tick: (ms: number) => { clock += ms; } };
  }

  const ask = { person: "ann", botId: "bot1", botName: "Wren", threadId: "t1" };

  it("offers only what a phone of that person registered, while it is around", () => {
    const { broker, tick } = setup();
    expect(broker.availableTools("ann")).toEqual([]);
    broker.registerDevice("ann", "phone-a", { deviceName: "iPhone", tools: ["location", "contacts"], transport: "protected" });
    expect(broker.availableTools("ann")).toEqual(["contacts", "location"]);
    expect(broker.availableTools("bob")).toEqual([]);
    tick(PHONE_ONLINE_MS + 1);
    expect(broker.availableTools("ann")).toEqual([]);
  });

  it("keeps a phone that can be woken by a push for a day", () => {
    const { broker, tick } = setup({ pushable: true });
    broker.registerDevice("ann", "phone-a", { deviceName: "iPhone", tools: ["status"], transport: "protected" });
    tick(PHONE_ONLINE_MS + 1);
    expect(broker.availableTools("ann")).toEqual(["status"]);
    tick(24 * 60 * 60_000);
    expect(broker.availableTools("ann")).toEqual([]);
  });

  it("refuses a tool no phone of the person offers", () => {
    const { broker } = setup();
    broker.registerDevice("ann", "phone-a", { deviceName: "", tools: ["status"], transport: "protected" });
    expect(() => broker.request({ ...ask, tool: "location", args: {} })).toThrow(/phone/);
  });

  it("tells the person's phones, and only theirs, and hands the answer to the waiting turn once", async () => {
    const { broker, notified, pushed, audit } = setup();
    broker.registerDevice("ann", "phone-a", { deviceName: "", tools: ["location"], transport: "protected" });
    const request = broker.request({ ...ask, tool: "location", args: {} });
    expect(notified).toEqual(["ann"]);
    expect(pushed).toEqual(["ann:location"]);
    expect(broker.pendingFor("ann").map((row) => row.id)).toEqual([request.id]);
    expect(broker.pendingFor("bob")).toEqual([]);
    expect(request.allowAlways).toBe(true);
    expect(request.preApproved).toBe(false);

    const waiting = broker.wait(request.id, { botId: "bot1", threadId: "t1" }, 5_000);
    // another person's phone cannot answer
    expect(broker.answer("bob", "phone-b", request.id, { decision: "once", result: { latitude: 1, longitude: 2 } })).toMatchObject({ ok: false, status: 404 });
    // nor an unregistered device of the same person
    expect(broker.answer("ann", "laptop", request.id, { decision: "once", result: { latitude: 1, longitude: 2 } })).toMatchObject({ ok: false, status: 403 });
    expect(broker.answer("ann", "phone-a", request.id, { decision: "once", result: { latitude: 45.50169, longitude: -73.56726 } })).toEqual({ ok: true });
    await expect(waiting).resolves.toEqual({ status: "done", tool: "location", result: { latitude: 45.502, longitude: -73.567, precise: false } });
    // answered once: a second answer finds nothing
    expect(broker.answer("ann", "phone-a", request.id, { decision: "once", result: {} })).toMatchObject({ ok: false });
    expect(broker.pendingFor("ann")).toEqual([]);
    // the audit names the decision, never the data
    expect(audit.map((row) => row.outcome)).toEqual(["requested", "once"]);
    expect(JSON.stringify(audit)).not.toContain("45.5");
  });

  it("never lets another bot or conversation read an answer", async () => {
    const { broker } = setup();
    broker.registerDevice("ann", "phone-a", { deviceName: "", tools: ["status"], transport: "protected" });
    const request = broker.request({ ...ask, tool: "status", args: {} });
    await expect(broker.wait(request.id, { botId: "bot2", threadId: "t1" }, 10)).resolves.toEqual({ status: "unknown" });
  });

  it("says pending when the phone has not answered within the wait, then expires", async () => {
    const { broker, tick } = setup();
    broker.registerDevice("ann", "phone-a", { deviceName: "", tools: ["status"], transport: "protected" });
    const request = broker.request({ ...ask, tool: "status", args: {} });
    await expect(broker.wait(request.id, ask, 5)).resolves.toEqual({ status: "pending", requestId: request.id });
    tick(5 * 60_000 + 1);
    await expect(broker.wait(request.id, ask, 5)).resolves.toEqual({ status: "expired" });
    expect(broker.answer("ann", "phone-a", request.id, { decision: "once", result: {} })).toMatchObject({ ok: false, status: 410 });
  });

  it("a refusal reaches the turn as a refusal", async () => {
    const { broker } = setup();
    broker.registerDevice("ann", "phone-a", { deviceName: "", tools: ["contacts"], transport: "protected" });
    const request = broker.request({ ...ask, tool: "contacts", args: { query: "Marie" } });
    expect(broker.answer("ann", "phone-a", request.id, { decision: "deny" })).toEqual({ ok: true });
    await expect(broker.wait(request.id, ask, 10)).resolves.toEqual({ status: "denied" });
  });

  it("an approved request whose iOS call failed says why", async () => {
    const { broker } = setup();
    broker.registerDevice("ann", "phone-a", { deviceName: "", tools: ["contacts"], transport: "protected" });
    const request = broker.request({ ...ask, tool: "contacts", args: { query: "Marie" } });
    expect(broker.answer("ann", "phone-a", request.id, { decision: "once", error: "Contacts access is off in Settings." })).toEqual({ ok: true });
    await expect(broker.wait(request.id, ask, 10)).resolves.toEqual({ status: "failed", error: "Contacts access is off in Settings." });
  });

  it("Toujours permettre covers that bot, that tool and that access only, and survives a restart", () => {
    const { broker, dataDir } = setup();
    broker.registerDevice("ann", "phone-a", { deviceName: "", tools: ["reminders", "shortcut"], transport: "protected" });
    const first = broker.request({ ...ask, tool: "reminders", args: { action: "list" } });
    expect(broker.answer("ann", "phone-a", first.id, { decision: "always", result: { reminders: [] } })).toEqual({ ok: true });
    expect(broker.request({ ...ask, tool: "reminders", args: { action: "list" } }).preApproved).toBe(true);
    expect(broker.request({ ...ask, tool: "reminders", args: { action: "create", title: "Pain" } }).preApproved).toBe(false);
    expect(broker.request({ ...ask, botId: "bot2", tool: "reminders", args: { action: "list" } }).preApproved).toBe(false);
    expect(broker.grants("ann")).toEqual([{ botId: "bot1", key: "reminders:read" }]);
    expect(JSON.parse(readFileSync(join(dataDir, "phone-tools", "grants.json"), "utf8")).people.ann).toEqual({ bot1: ["reminders:read"] });

    const again = createPhoneToolBroker({ dataDir, notify: () => {} });
    expect(again.grants("ann")).toEqual([{ botId: "bot1", key: "reminders:read" }]);
    expect(again.revokeGrant("ann", "bot1", "reminders:read")).toBe(true);
    expect(again.grants("ann")).toEqual([]);
  });

  it("refuses Toujours permettre where the card does not offer it", () => {
    const { broker } = setup();
    broker.registerDevice("ann", "phone-a", { deviceName: "", tools: ["shortcut"], transport: "protected" });
    const request = broker.request({ ...ask, tool: "shortcut", args: { name: "Pay" } });
    expect(request.allowAlways).toBe(false);
    expect(broker.answer("ann", "phone-a", request.id, { decision: "always", result: { started: true } })).toMatchObject({ ok: false, status: 400 });
    expect(broker.grants("ann")).toEqual([]);
  });

  it("an answer the phone made up is refused, and the turn hears the phone failed", async () => {
    const { broker } = setup();
    broker.registerDevice("ann", "phone-a", { deviceName: "", tools: ["location"], transport: "protected" });
    const request = broker.request({ ...ask, tool: "location", args: {} });
    expect(broker.answer("ann", "phone-a", request.id, { decision: "once", result: { latitude: "here" } })).toMatchObject({ ok: false, status: 400 });
    await expect(broker.wait(request.id, ask, 10)).resolves.toEqual({ status: "failed", error: "The phone's answer could not be read." });
  });

  it("caps how many requests one person can have waiting", () => {
    const { broker } = setup();
    broker.registerDevice("ann", "phone-a", { deviceName: "", tools: ["status"], transport: "protected" });
    for (let i = 0; i < 5; i += 1) broker.request({ ...ask, tool: "status", args: {} });
    expect(() => broker.request({ ...ask, tool: "status", args: {} })).toThrow(/waiting/);
  });
});

describe("phoneToolTurn", () => {
  const base = { ownsThread: true, inRoom: false, depth: 0, speakerOrigin: "person" as const, speakerPrincipal: "Ann", ownerPrincipal: "ann" };
  it("is the owner's own 1:1 turn", () => {
    expect(phoneToolTurn(base)).toEqual({ person: "ann" });
    expect(phoneToolTurn({ ...base, speakerOrigin: "operator" })).toEqual({ person: "ann" });
  });
  it("refuses a room, a hop, a routine and another member", () => {
    expect(phoneToolTurn({ ...base, inRoom: true })).toHaveProperty("error");
    expect(phoneToolTurn({ ...base, depth: 1 })).toHaveProperty("error");
    expect(phoneToolTurn({ ...base, speakerOrigin: "owner-routine" })).toHaveProperty("error");
    expect(phoneToolTurn({ ...base, speakerOrigin: "peer" })).toHaveProperty("error");
    expect(phoneToolTurn({ ...base, speakerPrincipal: "bob" })).toHaveProperty("error");
    expect(phoneToolTurn({ ...base, speakerPrincipal: "" })).toHaveProperty("error");
    expect(phoneToolTurn({ ...base, ownsThread: false })).toHaveProperty("error");
  });
});

describe("protected transport only (JC 2026-10-21)", () => {
  it("a phone on plain local Wi-Fi offers nothing to bots", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "sagax-phone-transport-"));
    try {
      const broker = createPhoneToolBroker({ dataDir, notify: () => {} });
      broker.registerDevice("ann", "phone-a", { deviceName: "", tools: ["location"], transport: "local" });
      expect(broker.availableTools("ann")).toEqual([]);
      expect(() => broker.request({ person: "ann", botId: "b", botName: "B", threadId: "t", tool: "location", args: {} })).toThrow(/HTTPS or Tailscale/);
      broker.registerDevice("ann", "phone-a", { deviceName: "", tools: ["location"], transport: "protected" });
      expect(broker.availableTools("ann")).toEqual(["location"]);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe("a phone that refuses with a reason", () => {
  it("hands the reason to the turn", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "sagax-phone-reason-"));
    try {
      const broker = createPhoneToolBroker({ dataDir, notify: () => {} });
      broker.registerDevice("ann", "phone-a", { deviceName: "", tools: ["status"], transport: "protected" });
      const request = broker.request({ person: "ann", botId: "b", botName: "B", threadId: "t", tool: "status", args: {} });
      expect(broker.answer("ann", "phone-a", request.id, { decision: "deny", error: "The phone is on plain local Wi-Fi." })).toEqual({ ok: true });
      await expect(broker.wait(request.id, { botId: "b", threadId: "t" }, 10)).resolves.toEqual({ status: "failed", error: "The phone is on plain local Wi-Fi." });
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
