import { describe, expect, it } from "vitest";
import { turnRunFor } from "./turn-run.ts";

describe("turnRunFor", () => {
  it("keeps the engine, the model and the effort of the selection", () => {
    expect(turnRunFor({ instanceId: "claude", model: "opus", effort: "medium" }))
      .toEqual({ instanceId: "claude", model: "opus", effort: "medium" });
  });

  it("leaves effort out when the engine ran on its default, so nothing is stored for it", () => {
    const run = turnRunFor({ instanceId: "claude", model: "opus" });
    expect(run).toEqual({ instanceId: "claude", model: "opus" });
    expect("effort" in run).toBe(false);
  });

  it("does not carry variant or the Auto flag onto the message", () => {
    expect(turnRunFor({ instanceId: "claude", model: "opus", variant: "think", auto: true } as never))
      .toEqual({ instanceId: "claude", model: "opus" });
  });
});
