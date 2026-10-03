// The routines lab (PARITY_ROUTINES=1 in fixture-server.mjs), for the WP8 UI
// tests (ios/UITests/RoutinesUITests.swift). Off by default: nothing of the
// reference dataset changes without it.
//
// Pass one creates, through the API, a desktop-made routine on Aurora with
// every field the phone's old editor did not show: an interval on weekdays
// between 08:00 and 18:00 with an end date, overlap "queue", an attachment
// and a results thread. Between the passes its run history is written into
// routines.json, the way the fixture seeds transcripts (no engine turn can
// fail or be missed on demand): a failed and a missed run nobody has seen, a
// completed one, and a queued one held back by `admitAfter` so it stays
// cancellable.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const ROUTINE_LAB = process.env.PARITY_ROUTINES === "1";
export const LAB_ROUTINE = "Veille WP8";
const HOUR = 3_600_000;

export async function seedRoutineLab(base, api, ids) {
  const aurora = ids.aurora;
  const now = Date.now();
  const end = new Date(now + 30 * 24 * HOUR);
  end.setHours(23, 59, 59, 999);
  await api(base, "POST", "/api/routines", {
    name: LAB_ROUTINE,
    prompt: "Texte de remplacement : surveille la boîte de réception et résume les nouveautés.",
    botId: aurora.id,
    runOn: "maus",
    enabled: true,
    schedule: {
      type: "interval", everyMinutes: 30, anchorAt: Math.ceil((now + 30 * 60_000) / 60_000) * 60_000,
      weekdays: [1, 2, 3, 4, 5], window: { start: "08:00", end: "18:00" }, endsAt: end.getTime(),
    },
    durationMinutes: 30,
    timeoutMinutes: 45,
    overlap: "queue",
    attachments: [{ id: "lab-brief", kind: "file", name: "brief.md", path: "/tmp/parity-brief.md", size: 12 }],
    resultsThreadId: aurora.threadId,
  });
}

export function seedRoutineLabRuns(dataDir) {
  const file = join(dataDir, "routines.json");
  const disk = JSON.parse(readFileSync(file, "utf8"));
  const routine = disk.routines.find((candidate) => candidate.name === LAB_ROUTINE);
  if (!routine) throw new Error("routine lab: the lab routine is missing");
  const now = Date.now();
  const run = (id, status, at, extra = {}) => ({
    id, routineId: routine.id, routineName: routine.name, prompt: routine.prompt,
    durationMinutes: 30, timeoutMinutes: 45, target: "bot", botId: routine.botId, runOn: "maus",
    scheduledFor: at, status, manual: false, triggerSource: "schedule", createdAt: at,
    resultsThreadId: routine.resultsThreadId, ...extra,
  });
  disk.runs = [
    ...(disk.runs ?? []),
    run("lab-run-failed", "failed", now - 3 * HOUR, { startedAt: now - 3 * HOUR, finishedAt: now - 3 * HOUR + 60_000, error: "Erreur de remplacement : la boîte de réception ne répond pas." }),
    run("lab-run-missed", "missed", now - 2 * HOUR, { finishedAt: now - 2 * HOUR, error: "Sagax était fermé à l'heure prévue." }),
    run("lab-run-done", "completed", now - HOUR, { startedAt: now - HOUR, finishedAt: now - HOUR + 60_000, output: "Résumé de remplacement : trois nouveaux messages." }),
    run("lab-run-queued", "queued", now - 10 * 60_000, { admitAfter: now + 30 * 24 * HOUR }),
  ];
  writeFileSync(file, JSON.stringify(disk, null, 2), { mode: 0o600 });
}
