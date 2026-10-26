import { describe, expect, it } from "vitest";

import { defaultTurnPayerMode, effectiveTurnPayerMode, isTurnPayerMode } from "./turn-payer.ts";

describe("who pays for a shared bot's replies (#1137)", () => {
  it("defaults to the owner for the owner's local model or own subscription, else each person", () => {
    expect(defaultTurnPayerMode({ ownerLocalModel: true, ownerSubscription: false })).toBe("owner");
    expect(defaultTurnPayerMode({ ownerLocalModel: false, ownerSubscription: true })).toBe("owner");
    expect(defaultTurnPayerMode({ ownerLocalModel: false, ownerSubscription: false })).toBe("speaker");
  });

  it("a group's override wins over the bot's choice, which wins over the default", () => {
    expect(effectiveTurnPayerMode({ group: "speaker", bot: "owner", fallback: "owner" })).toBe("speaker");
    expect(effectiveTurnPayerMode({ bot: "speaker", fallback: "owner" })).toBe("speaker");
    expect(effectiveTurnPayerMode({ bot: "owner", fallback: "speaker" })).toBe("owner");
    expect(effectiveTurnPayerMode({ fallback: "owner" })).toBe("owner");
    // anything else stored is ignored
    expect(effectiveTurnPayerMode({ group: "nobody", bot: 3, fallback: "speaker" })).toBe("speaker");
    expect(isTurnPayerMode("owner")).toBe(true);
    expect(isTurnPayerMode("admin")).toBe(false);
  });
});
