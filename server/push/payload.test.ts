import { describe, expect, it } from "vitest";

import { buildApnsRequest, collapseId, NUDGE_SOUND, type PushMessage } from "./payload.ts";

const message = (patch: Partial<PushMessage> = {}): PushMessage => ({
  kind: "message",
  personId: "pr_bob",
  title: "Alice",
  body: "Are you there?",
  threadId: "t_people_1",
  groupId: "g_people_1",
  at: 1_000,
  ...patch,
});

describe("APNs payload", () => {
  it("carries the alert, the thread and the keys the phone opens it with", () => {
    const request = buildApnsRequest({ message: message(), bundleId: "ca.pulsatrix.sagax", nowMs: 2_000_000 });
    const body = JSON.parse(request.body);
    expect(body.aps.alert).toEqual({ title: "Alice", body: "Are you there?" });
    expect(body.aps["thread-id"]).toBe("t_people_1");
    expect(body.aps.sound).toBe("default");
    expect(body.aps["content-available"]).toBe(1);
    expect(body.aps["mutable-content"]).toBeUndefined();
    // a conversation between people opens by its group
    expect(body).toMatchObject({ kind: "message", threadId: "t_people_1", botId: "g_people_1", groupId: "g_people_1" });
    expect(request.headers).toMatchObject({
      "apns-push-type": "alert",
      "apns-topic": "ca.pulsatrix.sagax",
      "apns-priority": "5",
      "apns-collapse-id": "sagax.t.t_people_1",
      "apns-expiration": String(2_000 + 24 * 60 * 60),
    });
  });

  it("a nudge is priority 10, time sensitive, with the wizz and the phone's own strings", () => {
    const request = buildApnsRequest({
      message: message({ kind: "nudge", title: "Alice sent you a nudge", body: "Open the conversation to answer.", titleLocKey: "%@ sent you a nudge", titleLocArgs: ["Alice"], bodyLocKey: "Open the conversation to answer.", id: "n1", fromId: "pr_alice" }),
      bundleId: "ca.pulsatrix.sagax",
      nowMs: 2_000_000,
    });
    const body = JSON.parse(request.body);
    expect(request.headers["apns-priority"]).toBe("10");
    expect(request.headers["apns-expiration"]).toBe(String(2_000 + 300));
    expect(body.aps.sound).toBe(NUDGE_SOUND);
    expect(body.aps["interruption-level"]).toBe("time-sensitive");
    expect(body.aps.alert).toMatchObject({ "title-loc-key": "%@ sent you a nudge", "title-loc-args": ["Alice"], "loc-key": "Open the conversation to answer." });
    expect(body).toMatchObject({ kind: "nudge", id: "n1", fromId: "pr_alice" });
  });

  it("follows the device's and the person's sound switches", () => {
    const silent = JSON.parse(buildApnsRequest({ message: message(), bundleId: "x", settings: { sound: false }, nowMs: 0 }).body);
    expect(silent.aps.sound).toBeUndefined();
    const personOff = JSON.parse(buildApnsRequest({ message: message(), bundleId: "x", personSound: false, nowMs: 0 }).body);
    expect(personOff.aps.sound).toBeUndefined();
    const nudgeNoWizz = JSON.parse(buildApnsRequest({ message: message({ kind: "nudge" }), bundleId: "x", settings: { nudgeSound: false }, nowMs: 0 }).body);
    expect(nudgeNoWizz.aps.sound).toBe("default");
  });

  it("clips long text and keeps the collapse id within 64 bytes", () => {
    const long = buildApnsRequest({ message: message({ body: "word ".repeat(200) }), bundleId: "x", nowMs: 0 });
    expect(JSON.parse(long.body).aps.alert.body.length).toBeLessThanOrEqual(240);
    const id = collapseId({ kind: "message", threadId: "t_".padEnd(120, "x") });
    expect(Buffer.byteLength(id)).toBeLessThanOrEqual(64);
    expect(id.startsWith("sagax.h.")).toBe(true);
    expect(collapseId({ kind: "achievement" })).toBe("sagax.achievement");
  });
});
