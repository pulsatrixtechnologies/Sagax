import { describe, expect, it, vi } from "vitest";

import { runCardScan, type CardScanOutcome } from "./phone-card-scan";

describe("runCardScan", () => {
  it("keeps waiting while the phone has not answered, then hands back the card", async () => {
    const answers: CardScanOutcome[] = [{ status: "pending", requestId: "r1" }, { status: "done", card: { number: "4111111111111111", expMonth: 9, expYear: 2029 } }];
    const deps = { start: vi.fn(async () => ({ requestId: "r1", expiresAt: 0 })), wait: vi.fn(async () => answers.shift()!), cancel: vi.fn(async () => undefined) };
    await expect(runCardScan(new AbortController().signal, deps)).resolves.toEqual({ status: "done", card: { number: "4111111111111111", expMonth: 9, expYear: 2029 } });
    expect(deps.wait).toHaveBeenCalledTimes(2);
    expect(deps.cancel).not.toHaveBeenCalled();
  });

  it("cancels the request on the phone when the form gives up", async () => {
    const controller = new AbortController();
    const deps = {
      start: vi.fn(async () => ({ requestId: "r2", expiresAt: 0 })),
      wait: vi.fn(async () => {
        controller.abort();
        throw new DOMException("aborted", "AbortError");
      }),
      cancel: vi.fn(async () => undefined),
    };
    await expect(runCardScan(controller.signal, deps)).resolves.toEqual({ status: "cancelled" });
    expect(deps.cancel).toHaveBeenCalledWith("r2");
  });
});
