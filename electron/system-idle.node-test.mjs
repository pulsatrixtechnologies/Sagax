import assert from "node:assert/strict";
import { test } from "node:test";

import { SYSTEM_IDLE_THRESHOLD_SECONDS, systemIdleSnapshot } from "./system-idle.mjs";

test("passes the away threshold and reports the state and idle seconds", () => {
  let asked = null;
  const monitor = { getSystemIdleState: (threshold) => { asked = threshold; return "locked"; }, getSystemIdleTime: () => 412.7 };
  assert.deepEqual(systemIdleSnapshot(monitor), { state: "locked", idleSeconds: 412 });
  assert.equal(asked, SYSTEM_IDLE_THRESHOLD_SECONDS);
  assert.equal(SYSTEM_IDLE_THRESHOLD_SECONDS, 300);
});

test("anything odd reads as unknown, never throws", () => {
  assert.deepEqual(systemIdleSnapshot(null), { state: "unknown", idleSeconds: 0 });
  assert.deepEqual(systemIdleSnapshot({ getSystemIdleState: () => "asleep", getSystemIdleTime: () => -3 }), { state: "unknown", idleSeconds: 0 });
  assert.deepEqual(systemIdleSnapshot({ getSystemIdleState: () => { throw new Error("no"); }, getSystemIdleTime: () => { throw new Error("no"); } }), { state: "unknown", idleSeconds: 0 });
  assert.deepEqual(systemIdleSnapshot({ getSystemIdleState: () => "active", getSystemIdleTime: () => 3 }), { state: "active", idleSeconds: 3 });
});
