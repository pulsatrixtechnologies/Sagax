import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { healthzBody } from "./healthz.ts";

describe("healthz", () => {
  it("answers ok with the app identity", () => {
    expect(healthzBody()).toEqual({ ok: true, app: "openmausbot", product: "sagax" });
  });

  it("is served before the SPA fallback and does not require an empty session", () => {
    const source = readFileSync(join(import.meta.dirname, "index.ts"), "utf8");
    const route = source.indexOf('path === "/healthz"');
    const spa = source.indexOf("serveStatic(res, path)");
    const stranger = source.indexOf('path === "/api/health" && !gate.auth');
    expect(route).toBeGreaterThan(0);
    expect(spa).toBeGreaterThan(route);
    expect(stranger).toBeGreaterThan(route);
    expect(source.indexOf('path === "/healthz"', route + 1)).toBe(-1);
    const block = source.slice(route, route + 160);
    expect(block).toContain("healthzBody()");
    expect(block).not.toContain("!gate.auth");
  });
});
