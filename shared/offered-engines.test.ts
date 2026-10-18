import { describe, expect, it } from "vitest";
import { engineOffer, offeredEngines, orgEngineMoveLine, type EngineOfferContext } from "./offered-engines.ts";

const engines = [{ instanceId: "claude" }, { instanceId: "codex" }, { instanceId: "grok" }];
const ids = (rows: readonly { instanceId: string }[]) => rows.map((row) => row.instanceId);
const org = (allowedEngines: EngineOfferContext["allowedEngines"], mine?: EngineOfferContext["mine"]): EngineOfferContext => ({ organization: true, allowedEngines, mine });

describe("the engines offered to a person (2026-10-18)", () => {
  it("solo: every engine, whatever a stray list says", () => {
    const solo = { organization: false, allowedEngines: [] as string[] };
    expect(ids(offeredEngines(engines, solo))).toEqual(["claude", "codex", "grok"]);
    expect(engineOffer(solo, "codex")).toBe("offered");
  });

  it("organization: null or absent is every engine, a list keeps its own, [] is none (Sagax 0.5.12+)", () => {
    expect(ids(offeredEngines(engines, org(null)))).toEqual(["claude", "codex", "grok"]);
    expect(ids(offeredEngines(engines, org(undefined)))).toEqual(["claude", "codex", "grok"]);
    expect(ids(offeredEngines(engines, org(["grok", "claude"])))).toEqual(["claude", "grok"]);
    expect(offeredEngines(engines, org([]))).toEqual([]);
    expect(engineOffer(org(["claude"]), "codex")).toBe("notAllowed");
  });

  it("an engine hidden by the organization stays hidden even when the person connected it", () => {
    const mine = [{ instanceId: "codex", myTurns: "subscription" }];
    expect(engineOffer(org(["claude"], mine), "codex")).toBe("notAllowed");
    expect(ids(offeredEngines(engines, org(["claude"], mine), "settings"))).toEqual(["claude"]);
  });

  it("an engine the organization pays for but did not give the person: not to pick, still in Settings", () => {
    const mine = [
      { instanceId: "grok", orgKeyNotGiven: true, myTurns: "none" },
      { instanceId: "codex", orgKeyNotGiven: true, myTurns: "subscription" },
    ];
    expect(engineOffer(org(null, mine), "grok")).toBe("notGiven");
    // their own subscription serves it: offered
    expect(engineOffer(org(null, mine), "codex")).toBe("offered");
    expect(ids(offeredEngines(engines, org(null, mine)))).toEqual(["claude", "codex"]);
    expect(ids(offeredEngines(engines, org(null, mine), "settings"))).toEqual(["claude", "codex", "grok"]);
    // not known yet (loading): nothing is dropped for it
    expect(engineOffer(org(null, null), "grok")).toBe("offered");
  });

  it("the moved bot's plain line", () => {
    expect(orgEngineMoveLine({ from: "Codex", to: "Claude" })).toBe("Your organization no longer offers Codex. This bot now uses Auto, starting on Claude.");
  });
});
