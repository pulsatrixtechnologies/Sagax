import { expect, it } from "vitest";
import { coalescedRun } from "./coalesced-run.ts";

it("runs once for one caller", async () => {
  let runs = 0;
  const run = coalescedRun(async () => { runs += 1; });
  await run();
  expect(runs).toBe(1);
});

it("folds callers that ask during a run into one more run after it", async () => {
  let runs = 0;
  let release!: () => void;
  const run = coalescedRun(async () => {
    runs += 1;
    if (runs === 1) await new Promise<void>((resolve) => { release = resolve; });
  });
  const first = run();
  const others = [run(), run(), run(), run()];
  release();
  await Promise.all([first, ...others]);
  expect(runs).toBe(2);
  // and a later caller starts a fresh run
  await run();
  expect(runs).toBe(3);
});

it("rejects when the last run failed and recovers on the next call", async () => {
  let fail = true;
  const run = coalescedRun(async () => { if (fail) throw new Error("engines unreadable"); });
  await expect(run()).rejects.toThrow("engines unreadable");
  fail = false;
  await expect(run()).resolves.toBeUndefined();
});
