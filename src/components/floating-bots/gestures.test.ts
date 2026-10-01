import { describe, expect, it } from "vitest";
import { newStroke, PET_EVERY_MS, strokeLeave, strokeStep, type StrokeState } from "./gestures";

/** Feeds pointer moves as the window receives them (forwarded or not, the page sees plain moves). */
function moves(points: [number, number, number][], state: StrokeState = newStroke()) {
  let pets = 0;
  for (const [x, y, at] of points) {
    const step = strokeStep(state, x, y, at);
    state = step.state;
    if (step.pet) pets += 1;
  }
  return { state, pets };
}

describe("petting: a stroke over the owl", () => {
  it("counts a few back-and-forths within a second as a pet", () => {
    expect(moves([[50, 60, 0], [70, 60, 100], [50, 61, 200], [70, 60, 300]]).pets).toBe(1);
  });

  it("does not count one slow pass, jitter or a stroke spread over seconds", () => {
    expect(moves([[20, 60, 0], [60, 60, 200], [100, 60, 400]]).pets).toBe(0);
    expect(moves([[50, 60, 0], [51, 60, 50], [50, 60, 100], [51, 60, 150], [50, 60, 200]]).pets).toBe(0);
    expect(moves([[50, 60, 0], [70, 60, 1500], [50, 60, 3000], [70, 60, 4500]]).pets).toBe(0);
  });

  it("counts a long rub as a pet even without turning back", () => {
    expect(moves([[0, 60, 0], [120, 60, 300], [240, 60, 600]]).pets).toBe(1);
  });

  it("pets at most once per cooldown, and leaving keeps the cooldown", () => {
    const rub = (from: number): [number, number, number][] => [[50, 60, from], [70, 60, from + 100], [50, 60, from + 200], [70, 60, from + 300]];
    const first = moves([...rub(0), ...rub(400)]);
    expect(first.pets).toBe(1);
    const left = strokeLeave(first.state);
    expect(moves(rub(800), left).pets).toBe(0);
    expect(moves(rub(PET_EVERY_MS + 400), left).pets).toBe(1);
  });
});
