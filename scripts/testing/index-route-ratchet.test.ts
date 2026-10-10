// server/index.ts may not gain request-path guards; new routes go in server/routes (see its README).
// Counted per occurrence. Each count must equal its number here, so a PR that moves a route out lowers it.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const INDEX = readFileSync(new URL("../../server/index.ts", import.meta.url), "utf8");

const EXACT: Record<string, number> = {
  // Internal harness routes have no server/routes module yet; moving them out is the follow-up that lowers this.
  // Counted on Sagax's server/index.ts, which keeps its own routes (organization, Perspicax, MCP sign-in, read receipts #166) there,
  // plus the fork routes merged on main after the 2026-10-08 sync branch was cut (the PRs after #176, Auto model #153 among them).
  // 190: DELETE /api/routine-runs ("Clear logs", #238), then the routes of the PRs merged on 2026-10-09 that kept
  // them in index.ts (people threads, reactions and Seen by, bot zip #271, persona Rules and Files, plugin updates #272).
  'path === "/': 190,
  "path.match(": 97,
  "path.startsWith(": 14,
  ".exec(path)": 23,
  ".test(path)": 8,
  ".includes(path)": 4,
};

const count = (needle: string) => INDEX.split(needle).length - 1;

describe("server/index.ts gains no route handlers", () => {
  it("matches request paths exactly as often as written here", () => {
    const changed = Object.entries(EXACT).flatMap(([needle, written]) => {
      const n = count(needle);
      if (n > written) return [`${needle} appears ${n} times, more than ${written}: put the new route in server/routes`];
      if (n < written) return [`${needle} appears ${n} times: lower its number here to ${n}`];
      return [];
    });
    expect(changed, "See server/routes/README.md").toEqual([]);
  });
});
