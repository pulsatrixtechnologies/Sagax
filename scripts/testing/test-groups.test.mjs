import { describe, expect, it } from "vitest";

import { balanceShards, isE2eTestFile, selectGroup } from "./test-groups.mjs";

describe("test groups", () => {
  it("puts e2e-named files and server-booting files in e2e, the rest in unit", () => {
    expect(isE2eTestFile("server/org.e2e.test.ts", "")).toBe(true);
    // Built from pieces so this file does not classify itself as e2e.
    const spawnLine = ["spawn(process.execPath", ', [join(SERVER_DIR, "index.ts")])'].join("");
    expect(isE2eTestFile("server/comms.test.ts", spawnLine)).toBe(true);
    expect(isE2eTestFile("server/x.test.ts", ["await launchVerification", "Server(env)"].join(""))).toBe(true);
    expect(isE2eTestFile("server/guard.test.ts", 'readFileSync(new URL("./index.ts", import.meta.url), "utf8")')).toBe(false);
    expect(isE2eTestFile("src/lib/time.test.ts", 'import { t } from "./time";')).toBe(false);
    const sources = { "a.e2e.test.ts": "", "b.test.ts": "", "c.test.ts": ["launchVerification", "Server()"].join("") };
    const read = (file) => sources[file];
    expect(selectGroup(Object.keys(sources), "unit", read)).toEqual(["b.test.ts"]);
    expect(selectGroup(Object.keys(sources), "e2e", read)).toEqual(["a.e2e.test.ts", "c.test.ts"]);
    expect(selectGroup(Object.keys(sources), "all", read)).toHaveLength(3);
    expect(() => selectGroup([], "slow", read)).toThrow(/unknown test group/);
  });

  it("deals every file exactly once and spreads the heavy ones", () => {
    const weights = { h1: 100, h2: 100, h3: 100, l1: 1, l2: 1, l3: 1, l4: 1 };
    const shards = balanceShards(Object.keys(weights), 3, (file) => weights[file]);
    expect(shards.flat().sort()).toEqual(Object.keys(weights).sort());
    for (const shard of shards) expect(shard.filter((file) => file.startsWith("h"))).toHaveLength(1);
    expect(balanceShards(["only"], 8, () => 1)).toEqual([["only"]]);
  });
});
