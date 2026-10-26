// CI runs the post-deploy smoke against the dev gate: the same check that
// gates a deploy fails the build on any tool-name parity mismatch.
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

it("smoke-mcp-tool-names passes on the dev gate", () => {
  const out = execFileSync(process.execPath, [join(ROOT, "scripts/smoke-mcp-tool-names.mjs")], {
    cwd: ROOT, env: { ...process.env, SMOKE_GATE: join(ROOT, "server/mcp-gate.ts") }, encoding: "utf8", timeout: 60_000,
  });
  expect(out).toContain("smoke: OK");
  expect(out).toMatch(/cw_psa__query registered as perspicax_profil_ottoline_limited__cw_psa_query/);
});
