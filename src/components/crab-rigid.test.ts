// Owner 2026-10-12: the desktop crab came apart (legs and arms turning and
// stretching on their own) and filled the whole mascot box. The rig keeps
// one rigid pixel sprite, and the desktop draws it at its old footprint.
import { describe, expect, it } from "vitest";
import { CRAB_PX } from "./crab-art";
import { CRAB_MOVES, CRAB_TRACKS, CrabRig, crabIdlePose, crabTransforms } from "./crab-moves";
import { CRAB_DESKTOP_SCALE } from "./floating-bots/mascots";

const onGrid = (n: number) => Math.abs(n / CRAB_PX - Math.round(n / CRAB_PX)) < 1e-9;

describe("the crab moves as one rigid sprite", () => {
  it("never rotates or scales a leg or arm, and every offset is a whole cell", () => {
    const rig = new CrabRig(0);
    for (const move of CRAB_MOVES) {
      rig.play(move, 0);
      for (let t = 0; t <= CRAB_TRACKS[move].duration; t += 0.05) {
        const tr = crabTransforms(rig.pose(t));
        for (const key of ["armL", "armR", "leg0", "leg1", "leg2", "leg3"] as const) {
          expect(tr[key]).not.toMatch(/rotate|scale/);
          const [, y] = /translate\(0 (-?[\d.]+)\)/.exec(tr[key])!;
          expect(onGrid(Number(y))).toBe(true);
          expect(Number(y)).toBeGreaterThanOrEqual(-CRAB_PX);
        }
        expect(tr.whole).not.toMatch(/scale/);
      }
    }
  });

  it("the idle tilt stays small and the bob lands on the grid", () => {
    for (let t = 0; t < 11; t += 0.1) {
      const tr = crabTransforms(crabIdlePose(t, []));
      const [, x, y, rot] = /translate\((-?[\d.]+) (-?[\d.]+)\) rotate\((-?[\d.]+)/.exec(tr.whole)!;
      expect(onGrid(Number(x)) && onGrid(Number(y))).toBe(true);
      expect(Math.abs(Number(rot))).toBeLessThanOrEqual(4);
    }
  });

  it("the desktop crab is drawn at its old small footprint", () => {
    expect(CRAB_DESKTOP_SCALE).toBeLessThanOrEqual(0.65);
  });
});
