// A Clock the scenario suite drives by hand (docs/runtime-contract.md §6).
// advance() is time passing while the host is awake: wall and monotonic
// move together. sleep() is a laptop lid closing: the wall clock jumps, the
// monotonic clock does not, so a per-turn stall window must not fire.
import type { Clock } from "../types.ts";

export class FakeClock implements Clock {
  #now: number;
  #monotonic: number;

  constructor(start = 1_760_000_000_000, monotonic = 10_000) {
    this.#now = start;
    this.#monotonic = monotonic;
  }

  now(): number {
    return this.#now;
  }

  monotonic(): number {
    return this.#monotonic;
  }

  /** Time passes awake: both clocks move. */
  advance(ms: number): void {
    this.#now += ms;
    this.#monotonic += ms;
  }

  /** The host slept: only the wall clock moves. */
  sleep(ms: number): void {
    this.#now += ms;
  }
}
