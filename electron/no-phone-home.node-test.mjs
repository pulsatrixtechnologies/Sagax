// Built bundles (dist, dist-server) and the Electron runtime files must not
// name a host Sagax never contacts (scripts/check-no-phone-home.mjs). Bundles
// that are not built yet are skipped here; packaging runs the check with
// --require-bundles.
import assert from "node:assert/strict";
import test from "node:test";

import { scan, scanText } from "../scripts/check-no-phone-home.mjs";

test("the scanner flags upstream services, analytics and the upstream author", () => {
  const sample = [
    'const CLOUD = "https://cloud.openmausbot.com";',
    'fetch("https://accounts.openmausbot.com/v1")',
    'import posthog from "posthog-js";',
    'const TOKEN = "phc_m2hP39w8y2gLPvHgDvSXAu6xcZ3agjf4ruL56rGcMZEe";',
    'const ROOT = "https://raw.githubusercontent.com/milind-soni/openmausbot-teams/main";',
  ].join("\n");
  const names = scanText(sample, "fixture.js").map((finding) => finding.name);
  assert.deepEqual(new Set(names), new Set(["OpenMausBot service host", "PostHog", "PostHog project key", "upstream author's GitHub"]));
});

test("only the reviewed exceptions pass", () => {
  const allowed = [
    'const HOST_BUNDLE_ID = "com.openmausbot.app";',
    'var BLOCKED_DOMAINS = Object.freeze([\n  "openmausbot.com",\n  "openmausbot.ai",\n  "openmausbot.app",\n  "openmausbot.dev",\n  "posthog.com"\n]);\nvar BLOCKED_GITHUB_OWNERS = Object.freeze(["milind-soni"]);',
    '{ slug: "posthog", label: "PostHog", blurb: "Analytics, feature flags, experiments", domain: "posthog.com", logo: null }',
  ].join("\n");
  assert.deepEqual(scanText(allowed, "fixture.js"), []);
  assert.equal(scanText('const x = "openmausbot.com";', "fixture.js").length, 1);
});

test("no built bundle or Electron runtime file names a blocked host", () => {
  const { findings, missing, files } = scan();
  if (missing.length) console.log(`# not built, skipped: ${missing.join(", ")}`);
  assert.ok(files > 0);
  assert.deepEqual(findings.map((f) => `${f.file}:${f.line} ${f.match}`), []);
});
