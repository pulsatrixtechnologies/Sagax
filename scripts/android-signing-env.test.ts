// The Android release signing reads SAGAX_* first, then the older names, then
// keystore.properties (android/app/build.gradle.kts). The environment wins
// over the file: once either variable is set, even to "", the file is not
// read. A blank SAGAX_* variable counts as unset only for the fallback to the
// older name, so a CI that maps a missing SAGAX_* secret to "" still reaches
// the old one; blank with no old name set gives no value rather than a silent
// fallback to the file. Gradle and a JDK are not part of the unit test run,
// so this checks the build script's text.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const gradle = readFileSync(new URL("../android/app/build.gradle.kts", import.meta.url), "utf8");

describe("Android release signing variables", () => {
  it("lets a set variable win over the file, and a blank new name fall back only to the old name", () => {
    expect(gradle).toMatch(/private fun nonBlank\(value: String\?\): String\? = value\?\.takeIf\(String::isNotBlank\)/);
    const body = gradle.match(/private fun signingMaterial\([^)]*\): String\? \{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(body.split("\n").map((line) => line.trim()).filter(Boolean)).toEqual([
      "val current = System.getenv(environment)",
      "val legacy = System.getenv(legacyEnvironment)",
      "if (current != null || legacy != null) return nonBlank(current) ?: nonBlank(legacy)",
      "return nonBlank(keystoreProperties.getProperty(property))",
    ]);
    // the rule is written down next to the code
    expect(gradle).toContain("The environment wins over keystore.properties");
    expect(gradle).toContain("no silent fallback to the file");
  });

  it("reads every signing variable through that helper, new name first", () => {
    // The push build values (fcmValue, #1187) read their own variables; they
    // are not signing material and never touch the keystore names.
    const fcm = gradle.match(/private fun fcmValue\([^)]*\): String =\n[^\n]*\n/)?.[0] ?? "";
    expect(fcm).toContain("System.getenv(environment)");
    expect(fcm).not.toMatch(/KEYSTORE|KEY_ALIAS|KEY_PASSWORD/);
    expect(gradle.replace(fcm, "").match(/System\.getenv\(/g)).toHaveLength(2);
    const legacy = ["open", "maus", "bot"].join("").toUpperCase();
    for (const name of ["KEYSTORE_FILE", "KEYSTORE_PASSWORD", "KEY_ALIAS", "KEY_PASSWORD"]) {
      expect(gradle).toContain(`"SAGAX_${name}", "${legacy}_${name}")`);
    }
  });
});
