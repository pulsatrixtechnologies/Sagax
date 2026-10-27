#!/usr/bin/env node
// Where a cold start of a sandbox goes, read from the cluster's own events
// (2026-10-26, "Cold start", docs/sandbox-kubernetes.md).
//
//   kubectl get events -A -o json > events.json
//   node scripts/k8s-wake-timeline.mjs events.json [--from <RFC 3339 time>]
//
// Read only: it parses a file and prints one line per step with the seconds
// since --from (the webhook, or the first event when absent). It never calls
// the cluster. A person's sandbox Pod is named after an opaque key; the key
// never reaches the output ("sagax-user-<key>").
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SANDBOX_POD = /^sagax-user-[0-9a-f]+$/;
const PROVISIONER_POD = /^sagax-sandboxd-/;

/** The steps, in the order a cold start goes through them. */
export const STEPS = [
  ["api", "Cluster API answers (first event)"],
  ["systemNodeReady", "System node Ready"],
  ["provisionerScheduled", "Provisioner Pod scheduled"],
  ["provisionerPulled", "Provisioner image pulled"],
  ["provisionerStarted", "Provisioner started"],
  ["sandboxFirstEvent", "Sandbox Pod created (first event)"],
  ["scaleUp", "Autoscaler adds a sandbox node"],
  ["sandboxNodeReady", "Sandbox node Ready"],
  ["sandboxScheduled", "Sandbox Pod scheduled"],
  ["volumeAttached", "Workspace volume attached"],
  ["sandboxPullStart", "Sandbox image pull starts"],
  ["sandboxPulled", "Sandbox image ready"],
  ["sandboxStarted", "Sandbox container started"],
];

function at(event) {
  const raw = event.eventTime || event.firstTimestamp || event.metadata?.creationTimestamp;
  const time = raw ? Date.parse(raw) : Number.NaN;
  return Number.isFinite(time) ? time : null;
}

/** The first time of each step at or after `from` (epoch ms, optional). */
export function wakeTimeline(events, from = null) {
  const rows = events
    .map((event) => ({ event, time: at(event) }))
    .filter((row) => row.time !== null && (from === null || row.time >= from))
    .sort((a, b) => a.time - b.time);
  const found = {};
  const first = (step, time) => { if (found[step] === undefined) found[step] = time; };
  for (const { event, time } of rows) {
    const object = event.involvedObject ?? {};
    const name = String(object.name ?? "");
    const reason = String(event.reason ?? "");
    const message = String(event.message ?? "");
    first("api", time);
    if (object.kind === "Node" && reason === "NodeReady") {
      if (/-system-/.test(name)) first("systemNodeReady", time);
      else if (found.sandboxFirstEvent !== undefined) first("sandboxNodeReady", time);
    }
    if (object.kind === "Pod" && PROVISIONER_POD.test(name)) {
      if (reason === "Scheduled") first("provisionerScheduled", time);
      if (reason === "Pulled") first("provisionerPulled", time);
      if (reason === "Started") first("provisionerStarted", time);
    }
    if (object.kind === "Pod" && SANDBOX_POD.test(name)) {
      first("sandboxFirstEvent", time);
      if (reason === "TriggeredScaleUp") first("scaleUp", time);
      if (reason === "Scheduled") first("sandboxScheduled", time);
      if (reason === "SuccessfulAttachVolume") first("volumeAttached", time);
      if (reason === "Pulling") first("sandboxPullStart", time);
      if (reason === "Pulled") {
        first("sandboxPulled", time);
        // "already present on machine": no pull at all.
        if (/already present/i.test(message)) first("sandboxPullStart", time);
      }
      if (reason === "Started") first("sandboxStarted", time);
    }
  }
  const origin = from ?? found.api ?? null;
  return STEPS.map(([step, label]) => ({
    step,
    label,
    seconds: found[step] === undefined || origin === null ? null : Math.round((found[step] - origin) / 1000),
  }));
}

export function formatTimeline(rows) {
  let previous = 0;
  return rows.map((row) => {
    if (row.seconds === null) return `${"-".padStart(6)}          ${row.label}`;
    const delta = row.seconds - previous;
    previous = row.seconds;
    return `${String(row.seconds).padStart(5)} s  (+${String(delta).padStart(3)} s)  ${row.label}`;
  }).join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [file, ...rest] = process.argv.slice(2);
  if (!file) {
    console.error("usage: node scripts/k8s-wake-timeline.mjs <events.json> [--from <RFC 3339 time>]");
    process.exit(2);
  }
  const fromIndex = rest.indexOf("--from");
  const from = fromIndex >= 0 ? Date.parse(rest[fromIndex + 1] ?? "") : null;
  if (from !== null && !Number.isFinite(from)) {
    console.error("--from must be an RFC 3339 time");
    process.exit(2);
  }
  const body = JSON.parse(readFileSync(file, "utf8"));
  console.log(formatTimeline(wakeTimeline(Array.isArray(body.items) ? body.items : [], from)));
}
