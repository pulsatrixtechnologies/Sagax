// The Android release signing reads SAGAX_* first, then the older names, then
// keystore.properties (android/app/build.gradle.kts). A set-but-empty variable
// must count as unset, or a CI that maps a missing SAGAX_* secret to "" would
// hide the older variable and the file. Gradle and a JDK are not part of the
// unit test run, so this checks the build script's text.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const gradle = readFileSync(new URL("../android/app/build.gradle.kts", import.meta.url), "utf8");

describe("Android release signing variables", () => {
  it("treats an empty or blank value as unset at every step", () => {
    expect(gradle).toMatch(/private fun nonBlank\(value: String\?\): String\? = value\?\.takeIf\(String::isNotBlank\)/);
    const body = gradle.match(/private fun signingMaterial\([^)]*\): String\? =([\s\S]*?)\n\n/)?.[1] ?? "";
    const steps = body.split("?:").map((step) => step.trim());
    expect(steps).toEqual([
      "nonBlank(System.getenv(environment))",
      "nonBlank(System.getenv(legacyEnvironment))",
      "nonBlank(keystoreProperties.getProperty(property))",
    ]);
  });

  it("reads every signing variable through that helper, new name first", () => {
    expect(gradle.match(/System\.getenv\(/g)).toHaveLength(2);
    const legacy = ["open", "maus", "bot"].join("").toUpperCase();
    for (const name of ["KEYSTORE_FILE", "KEYSTORE_PASSWORD", "KEY_ALIAS", "KEY_PASSWORD"]) {
      expect(gradle).toContain(`"SAGAX_${name}", "${legacy}_${name}")`);
    }
  });
});
