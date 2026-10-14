import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  HERMES_REQUIRES_PYTHON,
  PINNED_PYTHON_APT,
  PINNED_PYTHON_BIN,
  PINNED_PYTHON_VERSION,
  pinnedSeriesSatisfiesHermes,
  versionSatisfies,
} from "./hermes-python.mjs";

const root = join(import.meta.dirname, "..");
const read = (path) => readFileSync(join(root, path), "utf8");

describe("Hermes Python pin", () => {
  it("accepts the pinned 3.13 series and refuses 3.10 and 3.14", () => {
    expect(HERMES_REQUIRES_PYTHON).toBe(">=3.11,<3.14");
    expect(versionSatisfies("3.13.5", HERMES_REQUIRES_PYTHON)).toBe(true);
    expect(versionSatisfies(PINNED_PYTHON_VERSION, HERMES_REQUIRES_PYTHON)).toBe(true);
    expect(pinnedSeriesSatisfiesHermes()).toBe(true);
    expect(versionSatisfies("3.11.0", HERMES_REQUIRES_PYTHON)).toBe(true);
    expect(versionSatisfies("3.10.12", HERMES_REQUIRES_PYTHON)).toBe(false);
    expect(versionSatisfies("3.14.0", HERMES_REQUIRES_PYTHON)).toBe(false);
    expect(versionSatisfies("3.14.8", HERMES_REQUIRES_PYTHON)).toBe(false);
  });

  it("installs the same apt pins from the Dockerfile and the engine installer", () => {
    const dockerfile = read("Dockerfile");
    const installer = read("scripts/install-engines.mjs");
    expect(dockerfile).toContain("libstdc++6");
    expect(dockerfile).toContain(PINNED_PYTHON_BIN);
    expect(installer).toContain("PINNED_PYTHON_BIN");
    expect(installer).toContain("PINNED_PYTHON_APT");
    expect(installer).toContain("from \"./hermes-python.mjs\"");
    for (const spec of PINNED_PYTHON_APT) {
      expect(dockerfile).toContain(spec);
    }
    expect(installer).not.toMatch(/apt-get", \["install", "-y", "--no-install-recommends", "python3", "python3-venv"\]/);
  });
});
