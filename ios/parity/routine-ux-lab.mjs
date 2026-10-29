// The routine runs lab (PARITY_ROUTINE_RUNS=1 in fixture-server.mjs), for
// the 2026-10-29 captures of a routine's page and its runs: Ara's monthly
// routine gets a history of every outcome (a completed run whose report has
// a table and a cost, a failed one that paused
// it, a missed one; a waiting run would not survive the server's restart), and the logs keep a run of a routine deleted since.
// Off by default: nothing of the reference dataset changes without it.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const ROUTINE_RUNS_LAB = process.env.PARITY_ROUTINE_RUNS === "1";
const HOUR = 3_600_000;
const MIN = 60_000;

const REPORT = [
  "Three skills stand out this month; two are worth adding.",
  "",
  "| Skill | Uses | Trend |",
  "| --- | ---: | :---: |",
  "| Summaries | 42 | up |",
  "| Calendar | 31 | flat |",
  "| Spreadsheets | 18 | up |",
  "",
  "**Worth adding**",
  "",
  "1. A meeting notes template.",
  "2. A weekly digest of open items.",
].join("\n");

export function seedRoutineRunsLab(dataDir, routineId) {
  const file = join(dataDir, "routines.json");
  const disk = JSON.parse(readFileSync(file, "utf8"));
  const routine = disk.routines.find((candidate) => candidate.id === routineId);
  if (!routine) throw new Error("routine runs lab: the monthly routine is missing");
  const now = Date.now();
  const run = (id, status, at, extra = {}) => ({
    id, routineId: routine.id, routineName: routine.name, prompt: routine.prompt,
    durationMinutes: 30, timeoutMinutes: 45, target: "bot", botId: routine.botId, runOn: "maus",
    scheduledFor: at, status, manual: false, triggerSource: "schedule", createdAt: at, ...extra,
  });
  disk.runs = [
    ...(disk.runs ?? []),
    run("ux-run-done", "completed", now - 2 * HOUR, { startedAt: now - 2 * HOUR, finishedAt: now - 2 * HOUR + 4 * MIN, output: REPORT, cost: 0.042, seenAt: now - HOUR }),
    run("ux-run-failed", "failed", now - 26 * HOUR, { startedAt: now - 26 * HOUR, finishedAt: now - 26 * HOUR + 3 * MIN, error: "The engine stopped before it answered: the connector timed out after three tries.", cost: 0.003, autoPaused: { failures: 5 } }),
    run("ux-run-missed", "missed", now - 50 * HOUR, { finishedAt: now - 50 * HOUR, error: "The computer was asleep." }),
    { ...run("ux-run-deleted", "completed", now - 5 * HOUR, { startedAt: now - 5 * HOUR, finishedAt: now - 5 * HOUR + 3 * MIN, output: "Archived 27 closed items.", cost: 0.02 }), routineId: "ux-gone", routineName: "Quarterly cleanup" },
  ];
  writeFileSync(file, JSON.stringify(disk, null, 2), { mode: 0o600 });
}
