import { describe, expect, it } from "vitest";

import { formatTimeline, wakeTimeline } from "./k8s-wake-timeline.mjs";

const KEY = "0b5e".repeat(8);
const event = (time, kind, name, reason, message = "") => ({
  firstTimestamp: time,
  involvedObject: { kind, name },
  reason,
  message,
});

// The shape of a real cold start (cluster stopped, sandbox pool at 0).
const COLD = [
  event("2026-10-26T00:01:14Z", "Service", "sagax-sandboxd", "EnsuringLoadBalancer"),
  event("2026-10-26T00:04:06Z", "Node", "aks-system-1-vmss000001", "NodeReady"),
  event("2026-10-26T00:04:07Z", "Pod", "sagax-sandboxd-abc-123", "Scheduled"),
  event("2026-10-26T00:05:14Z", "Pod", "sagax-sandboxd-abc-123", "Pulled"),
  event("2026-10-26T00:05:14Z", "Pod", "sagax-sandboxd-abc-123", "Started"),
  event("2026-10-26T00:05:20Z", "Pod", `sagax-user-${KEY}`, "FailedScheduling"),
  event("2026-10-26T00:05:31Z", "Pod", `sagax-user-${KEY}`, "TriggeredScaleUp"),
  event("2026-10-26T00:06:42Z", "Node", "aks-sbx-1-vmss000002", "NodeReady"),
  event("2026-10-26T00:06:43Z", "Pod", `sagax-user-${KEY}`, "Scheduled"),
  event("2026-10-26T00:06:50Z", "Pod", `sagax-user-${KEY}`, "SuccessfulAttachVolume"),
  event("2026-10-26T00:06:55Z", "Pod", `sagax-user-${KEY}`, "Pulling"),
  event("2026-10-26T00:07:07Z", "Pod", `sagax-user-${KEY}`, "Pulled"),
  event("2026-10-26T00:07:08Z", "Pod", `sagax-user-${KEY}`, "Started"),
];

describe("k8s wake timeline", () => {
  it("puts each step of a cold start at its seconds since the webhook", () => {
    const rows = wakeTimeline(COLD, Date.parse("2026-10-26T00:00:00Z"));
    const seconds = Object.fromEntries(rows.map((row) => [row.step, row.seconds]));
    expect(seconds).toMatchObject({
      api: 74, systemNodeReady: 246, provisionerPulled: 314, scaleUp: 331,
      sandboxNodeReady: 402, volumeAttached: 410, sandboxPulled: 427, sandboxStarted: 428,
    });
  });

  it("reads a warm start: no node, no pull, and never prints the person's key", () => {
    const warm = [
      event("2026-10-26T01:00:00Z", "Pod", `sagax-user-${KEY}`, "Scheduled"),
      event("2026-10-26T01:00:07Z", "Pod", `sagax-user-${KEY}`, "SuccessfulAttachVolume"),
      event("2026-10-26T01:00:08Z", "Pod", `sagax-user-${KEY}`, "Pulled", "Container image already present on machine"),
      event("2026-10-26T01:00:09Z", "Pod", `sagax-user-${KEY}`, "Started"),
    ];
    const rows = wakeTimeline(warm, Date.parse("2026-10-26T00:59:58Z"));
    const seconds = Object.fromEntries(rows.map((row) => [row.step, row.seconds]));
    expect(seconds.scaleUp).toBeNull();
    expect(seconds.sandboxPullStart).toBe(10);
    expect(seconds.sandboxStarted).toBe(11);
    const text = formatTimeline(rows);
    expect(text).not.toContain(KEY);
    expect(text).toContain("Sandbox container started");
  });

  it("ignores events before --from", () => {
    const rows = wakeTimeline(COLD, Date.parse("2026-10-26T00:06:00Z"));
    expect(rows.find((row) => row.step === "systemNodeReady")?.seconds).toBeNull();
    expect(rows.find((row) => row.step === "sandboxStarted")?.seconds).toBe(68);
  });
});
