import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { ApnsTransport } from "./apns.ts";
import { readApnsConfig, type ApnsConfigResult } from "./config.ts";
import { PushRateLimiter, shouldPush, waitsForGrace } from "./decide.ts";
import { createPushDeviceStore } from "./devices.ts";
import { PushHub } from "./hub.ts";
import type { PushMessage } from "./payload.ts";

// A key made for this test only, never an Apple key.
const pem = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ format: "pem", type: "pkcs8" }).toString();
const CONFIG: ApnsConfigResult = { configured: true, config: { keyPem: pem, keyId: "ABC123DEFG", teamId: "PP546MZVHZ", bundleId: "ca.pulsatrix.sagax", environment: "production" } };
const TOKEN_A = "a".repeat(64);
const TOKEN_B = "b".repeat(64);

describe("should push", () => {
  it("a nudge always, at once", () => {
    expect(shouldPush({ kind: "nudge", connected: true, seen: true })).toBe(true);
    expect(waitsForGrace({ kind: "nudge", connected: true })).toBe(false);
  });
  it("a message nobody saw, never one a client of the person showed", () => {
    expect(shouldPush({ kind: "message", connected: true, seen: false })).toBe(true);
    expect(shouldPush({ kind: "message", connected: true, seen: true })).toBe(false);
    expect(waitsForGrace({ kind: "message", connected: true })).toBe(true);
    expect(waitsForGrace({ kind: "message", connected: false })).toBe(false);
  });
  it("an achievement only when no client is connected", () => {
    expect(shouldPush({ kind: "achievement", connected: true, seen: false })).toBe(false);
    expect(shouldPush({ kind: "achievement", connected: false, seen: false })).toBe(true);
  });
  it("rate limits per person", () => {
    const limiter = new PushRateLimiter(2, 1000);
    expect(limiter.tryTake("pr_a", 0)).toBe(true);
    expect(limiter.tryTake("pr_a", 1)).toBe(true);
    expect(limiter.tryTake("pr_a", 2)).toBe(false);
    expect(limiter.tryTake("pr_b", 2)).toBe(true);
    expect(limiter.tryTake("pr_a", 1001)).toBe(true);
  });
});

describe("push hub", () => {
  const dirs: string[] = [];
  afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

  function setup(options: { connected?: boolean; activeTokens?: string[]; answer?: (token: string) => { status: number; reason?: string }; config?: ApnsConfigResult } = {}) {
    const dir = mkdtempSync(join(tmpdir(), "sagax-push-"));
    dirs.push(dir);
    let now = 10_000;
    const store = createPushDeviceStore(dir, () => now);
    const sent: Array<{ host: string; path: string; headers: Record<string, string>; body: unknown }> = [];
    const transport: ApnsTransport = async (input) => {
      sent.push({ host: input.host, path: input.path, headers: input.headers, body: JSON.parse(input.body) });
      return options.answer?.(input.path.split("/").pop()!) ?? { status: 200 };
    };
    const timers: Array<() => void> = [];
    const logs: string[] = [];
    const hub = new PushHub({
      config: options.config ?? CONFIG,
      store,
      connected: () => options.connected ?? true,
      activeTokens: options.activeTokens ? () => options.activeTokens! : undefined,
      transport,
      now: () => now,
      log: { info: (line) => logs.push(line), warn: (line) => logs.push(line) },
      schedule: (run) => { timers.push(run); return () => {}; },
    });
    const fire = async () => { for (const run of timers.splice(0)) run(); await hub.drain(); };
    return { dir, store, hub, sent, fire, logs, tick: (ms: number) => { now += ms; } };
  }

  const message = (patch: Partial<PushMessage> = {}): PushMessage => ({ kind: "message", personId: "pr_bob", title: "Alice", body: "Hi", threadId: "t1", groupId: "g1", at: 1, ...patch });

  it("pushes a message nobody saw after the grace, to each device in its environment", async () => {
    const { store, hub, sent, fire } = setup();
    store.register("pr_bob", { token: TOKEN_A, platform: "ios", environment: "production", appVersion: "0.4.15", deviceName: "Bob" });
    store.register("pr_bob", { token: TOKEN_B, platform: "ios", environment: "sandbox", appVersion: "0.4.15", deviceName: "Bob dev" });
    hub.submit(message());
    expect(sent).toHaveLength(0);
    await fire();
    expect(sent.map((call) => call.host).sort()).toEqual(["api.push.apple.com", "api.sandbox.push.apple.com"]);
    expect(sent[0]!.headers.authorization).toMatch(/^bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    expect(sent[0]!.path).toMatch(/^\/3\/device\/[ab]{64}$/);
  });

  it("does not push when a client of the person showed the conversation (read during the grace)", async () => {
    const { store, hub, sent, fire, tick } = setup();
    store.register("pr_bob", { token: TOKEN_A, platform: "ios", environment: "production", appVersion: "", deviceName: "" });
    hub.submit(message());
    tick(500);
    hub.noteRead("PR_BOB", "t1");
    await fire();
    expect(sent).toHaveLength(0);
    // a read of another conversation does not count
    tick(60_000);
    hub.submit(message());
    tick(500);
    hub.noteRead("pr_bob", "t2");
    await fire();
    expect(sent).toHaveLength(1);
  });

  it("an approval answered elsewhere withdraws its banner: a queued one never goes, a delivered one is taken down by its own id", async () => {
    const { store, hub, sent, fire } = setup({ connected: true });
    store.register("pr_bob", { token: TOKEN_A, platform: "ios", environment: "production", appVersion: "", deviceName: "" });
    // still in its grace: dropped
    hub.submit(message({ kind: "approval", requestId: "r1", title: "Allow Nib to run a command?", body: "Run echo hi." }));
    hub.noteSettled("t1", "r1");
    await fire();
    expect(sent).toHaveLength(0);
    // delivered (no client connected), then answered on the desktop
    const offline = setup({ connected: false });
    offline.store.register("pr_bob", { token: TOKEN_A, platform: "ios", environment: "production", appVersion: "", deviceName: "" });
    offline.hub.submit(message({ kind: "approval", requestId: "r1", prompt: "approval", title: "Allow Nib to run a command?", body: "Run echo hi." }));
    await offline.fire();
    expect(offline.sent).toHaveLength(1);
    offline.hub.noteSettled("t2", "r1");
    offline.hub.noteSettled("t1", "r9");
    await offline.hub.drain();
    expect(offline.sent).toHaveLength(1);
    offline.hub.noteSettled("t1", "r1");
    await offline.hub.drain();
    expect(offline.sent).toHaveLength(2);
    const settled = offline.sent[1]!;
    // the ask's own id: the phone replaces it in place, then takes it down
    expect(settled.headers).toMatchObject({ "apns-push-type": "alert", "apns-collapse-id": offline.sent[0]!.headers["apns-collapse-id"] });
    expect(settled.body).toMatchObject({ kind: "settled", threadId: "t1", requestId: "r1", aps: { "mutable-content": 1, "interruption-level": "passive" } });
    // never a sound, never the buttons of an ask that is gone
    expect((settled.body as { aps: Record<string, unknown> }).aps.sound).toBeUndefined();
    expect((settled.body as { aps: Record<string, unknown> }).aps.category).toBe("SAGAX_UPDATE");
    // already told
    offline.hub.noteSettled("t1", "r1");
    await offline.hub.drain();
    expect(offline.sent).toHaveLength(2);
  });

  it("settles one ask at a time: another ask of the same conversation stays", async () => {
    const { store, hub, sent } = setup({ connected: false });
    store.register("pr_bob", { token: TOKEN_A, platform: "ios", environment: "production", appVersion: "", deviceName: "" });
    hub.submit(message({ kind: "approval", requestId: "r1", body: "first" }));
    hub.submit(message({ kind: "approval", requestId: "r2", body: "second" }));
    await hub.drain();
    expect(sent).toHaveLength(2);
    expect(sent[0]!.headers["apns-collapse-id"]).not.toBe(sent[1]!.headers["apns-collapse-id"]);
    hub.noteSettled("t1", "r1");
    await hub.drain();
    expect(sent).toHaveLength(3);
    expect(sent[2]!.body).toMatchObject({ kind: "settled", requestId: "r1" });
  });

  it("the conversation's next line never replaces a waiting approval (its buttons would go)", async () => {
    const { store, hub, sent, fire } = setup({ connected: true });
    store.register("pr_bob", { token: TOKEN_A, platform: "ios", environment: "production", appVersion: "", deviceName: "" });
    hub.submit(message({ kind: "approval", requestId: "r1", prompt: "approval", body: "Run echo hi." }));
    hub.submit(message({ body: "a line after it" }));
    await fire();
    expect(sent).toHaveLength(2);
    const approval = sent.find((row) => (row.body as { kind: string }).kind === "approval")!;
    const line = sent.find((row) => (row.body as { kind: string }).kind === "message")!;
    expect((approval.body as { aps: { category: string } }).aps.category).toBe("SAGAX_APPROVAL");
    expect(approval.headers["apns-collapse-id"]).not.toBe(line.headers["apns-collapse-id"]);
    expect(approval.headers["apns-priority"]).toBe("10");
  });

  it("a conversation read after it buzzed the phones tells them, silently, once", async () => {
    const { store, hub, sent, fire, tick } = setup({ connected: false });
    store.register("pr_bob", { token: TOKEN_A, platform: "ios", environment: "production", appVersion: "", deviceName: "" });
    // a read of a conversation that never buzzed sends nothing
    hub.noteRead("pr_bob", "t1");
    await hub.drain();
    expect(sent).toHaveLength(0);
    hub.submit(message());
    await fire();
    expect(sent).toHaveLength(1);
    tick(5_000);
    hub.noteRead("PR_BOB", "t1");
    await hub.drain();
    expect(sent).toHaveLength(2);
    expect(sent[1]!.headers).toMatchObject({ "apns-push-type": "background", "apns-priority": "5", "apns-topic": "ca.pulsatrix.sagax" });
    expect(sent[1]!.body).toEqual({ aps: { "content-available": 1 }, kind: "read", threadId: "t1", at: 15_000 });
    // no banner, no sound, no badge number: the phone recounts its own
    expect(JSON.stringify(sent[1]!.body)).not.toMatch(/alert|sound|badge/);
    // read again: already told
    hub.noteRead("pr_bob", "t1");
    await hub.drain();
    expect(sent).toHaveLength(2);
  });

  it("collapses a burst in one conversation into one push with the newest line", async () => {
    const { store, hub, sent, fire } = setup();
    store.register("pr_bob", { token: TOKEN_A, platform: "ios", environment: "production", appVersion: "", deviceName: "" });
    hub.submit(message({ body: "one" }));
    hub.submit(message({ body: "two" }));
    await fire();
    expect(sent).toHaveLength(1);
    expect((sent[0]!.body as { aps: { alert: { body: string } } }).aps.alert.body).toBe("two");
  });

  it("skips APNs for a device whose live stream is open, and still pushes the others", async () => {
    const { store, hub, sent, fire } = setup({ activeTokens: [TOKEN_A] });
    store.register("pr_bob", { token: TOKEN_A, platform: "ios", environment: "production", appVersion: "", deviceName: "in app" });
    store.register("pr_bob", { token: TOKEN_B, platform: "ios", environment: "production", appVersion: "", deviceName: "locked" });
    hub.submit(message());
    await fire();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.path).toBe(`/3/device/${TOKEN_B}`);
  });

  it("skips a nudge to the device that is in the app", async () => {
    const { store, hub, sent } = setup({ connected: true, activeTokens: [TOKEN_A] });
    store.register("pr_bob", { token: TOKEN_A, platform: "ios", environment: "production", appVersion: "", deviceName: "" });
    hub.submit(message({ kind: "nudge" }));
    await hub.drain();
    expect(sent).toHaveLength(0);
  });

  it("pushes a nudge at once, even while a client is connected", async () => {
    const { store, hub, sent } = setup({ connected: true });
    store.register("pr_bob", { token: TOKEN_A, platform: "ios", environment: "production", appVersion: "", deviceName: "" });
    hub.submit(message({ kind: "nudge" }));
    await hub.drain();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.headers["apns-priority"]).toBe("10");
  });

  it("pushes at once when no client of the person is connected", async () => {
    const { store, hub, sent } = setup({ connected: false });
    store.register("pr_bob", { token: TOKEN_A, platform: "ios", environment: "production", appVersion: "", deviceName: "" });
    hub.submit(message());
    await hub.drain();
    expect(sent).toHaveLength(1);
  });

  it("removes a device APNs says is gone (410 Unregistered, 400 BadDeviceToken) and keeps the others", async () => {
    const { store, hub, logs } = setup({
      connected: false,
      answer: (token) => token === TOKEN_A ? { status: 410, reason: "Unregistered" } : { status: 200 },
    });
    store.register("pr_bob", { token: TOKEN_A, platform: "ios", environment: "production", appVersion: "", deviceName: "" });
    store.register("pr_bob", { token: TOKEN_B, platform: "ios", environment: "production", appVersion: "", deviceName: "" });
    hub.submit(message());
    await hub.drain();
    expect(store.list("pr_bob").map((device) => device.token)).toEqual([TOKEN_B]);
    // the log names the device masked, never the token
    expect(logs.join("\n")).not.toContain(TOKEN_A);
    expect(logs.join("\n")).toContain("aaaa****aaaa");
  });

  it("removes a BadDeviceToken too, but not a device after a server error", async () => {
    const { store, hub } = setup({
      connected: false,
      answer: (token) => token === TOKEN_A ? { status: 400, reason: "BadDeviceToken" } : { status: 500, reason: "InternalServerError" },
    });
    store.register("pr_bob", { token: TOKEN_A, platform: "ios", environment: "production", appVersion: "", deviceName: "" });
    store.register("pr_bob", { token: TOKEN_B, platform: "ios", environment: "production", appVersion: "", deviceName: "" });
    hub.submit(message());
    await hub.drain();
    expect(store.list("pr_bob").map((device) => device.token)).toEqual([TOKEN_B]);
  });

  it("says once that APNs is not configured, then skips quietly", async () => {
    const { store, hub, sent, logs } = setup({ connected: false, config: readApnsConfig({}) });
    store.register("pr_bob", { token: TOKEN_A, platform: "ios", environment: "production", appVersion: "", deviceName: "" });
    expect(hub.enabled).toBe(false);
    hub.submit(message());
    hub.submit(message({ kind: "nudge" }));
    await hub.drain();
    expect(sent).toHaveLength(0);
    expect(logs.filter((line) => line.includes("not configured"))).toHaveLength(1);
    expect(logs[0]).toContain("SAGAX_APNS_KEY_PATH and SAGAX_APNS_KEY_ID not set");
  });

  it("stores devices per person in a 0600 file and moves a token that signs in as someone else", () => {
    const { dir, store } = setup();
    store.register("pr_bob", { token: TOKEN_A, platform: "ios", environment: "production", appVersion: "", deviceName: "" });
    if (process.platform !== "win32") expect(statSync(join(dir, "push-devices", "pr_bob.json")).mode & 0o777).toBe(0o600);
    store.register("pr_cara", { token: TOKEN_A, platform: "ios", environment: "production", appVersion: "", deviceName: "" });
    expect(store.list("pr_bob")).toEqual([]);
    expect(store.list("pr_cara")).toHaveLength(1);
    // read back from disk by a new store
    expect(createPushDeviceStore(dir).list("pr_cara").map((device) => device.token)).toEqual([TOKEN_A]);
    expect(store.remove("pr_cara", TOKEN_A)).toBe(true);
    expect(store.list("pr_cara")).toEqual([]);
  });
});
