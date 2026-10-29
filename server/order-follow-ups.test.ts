import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { followUpNote, OrderFollowUps } from "./order-follow-ups.ts";

const HOUR = 3_600_000;
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "order-follow-ups-"));
  dirs.push(dir);
  let now = 1_800_000_000_000;
  const clock = { advance: (ms: number) => { now += ms; } };
  return { dir, clock, followUps: () => new OrderFollowUps(dir, () => now) };
}

const order = { principalId: "p1", purchaseId: "pay_0123456789abcdef", botId: "b1", threadId: "t1" };

describe("order follow-ups", () => {
  it("wakes once when due, then again a day later until the bot answers", () => {
    const { dir, clock, followUps } = setup();
    const list = followUps();
    list.schedule(order, 24);
    expect(statSync(join(dir, "order-follow-ups.json")).mode & 0o777).toBe(0o600);
    clock.advance(23 * HOUR);
    expect(list.takeDue()).toEqual([]);
    clock.advance(HOUR);
    expect(list.takeDue().map((row) => row.purchaseId)).toEqual([order.purchaseId]);
    expect(list.takeDue()).toEqual([]);
    // read back from disk: the retry a day later stands
    clock.advance(24 * HOUR);
    expect(followUps().takeDue()).toHaveLength(1);
  });

  it("moves the next check when the bot answers and stops once delivered", () => {
    const { clock, followUps } = setup();
    const list = followUps();
    list.schedule(order, 24);
    list.schedule(order, 4);
    expect(list.list()).toHaveLength(1);
    clock.advance(4 * HOUR);
    expect(list.takeDue()).toHaveLength(1);
    list.schedule(order, 0);
    expect(list.list()).toEqual([]);
  });

  it("stops 30 days after the order", () => {
    const { clock, followUps } = setup();
    const list = followUps();
    list.schedule(order, 24);
    clock.advance(29 * 24 * HOUR);
    list.schedule(order, 48);
    expect(list.list()).toEqual([]);
  });

  it("tells the bot what to check and how to answer", () => {
    expect(followUpNote({ merchant: "Audio Shop", orderRef: "A-1", tracking: { carrier: "UPS", number: "1Z9", url: "https://t.example/1Z9" } }))
      .toBe('Sagax order follow-up: check where the order A-1 from Audio Shop is now (UPS 1Z9, https://t.example/1Z9): the carrier\'s tracking page or the shop\'s email. Then call update_order_tracking with order_ref "A-1" and the step you found. Tell the person only if the step changed or there is a problem.');
  });
});
