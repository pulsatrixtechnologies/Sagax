import { describe, expect, it } from "vitest";
import { npmInstallHints, rebrandFile } from "./rebrand-upstream.mjs";

// The old name, assembled as the script does so that it never rewrites this file.
const OLD = ["open", "maus", "bot"].join("");
const Old = ["Open", "Maus", "Bot"].join("");
const UPSTREAM = ["milind", "soni"].join("-");

describe("rebrand-upstream narrow rules", () => {
  it("points the deploy image at this project's, and keeps the upstream releases repository", () => {
    const compose = `    image: ghcr.io/${UPSTREAM}/${OLD}:latest\n`;
    expect(rebrandFile("deploy/docker-compose.yml", compose)).toBe("    image: ghcr.io/pulsatrixtechnologies/sagax:latest\n");
    const workflow = `docker tag ${OLD}:ci ghcr.io/${UPSTREAM}/${OLD}:latest\n`;
    expect(rebrandFile(".github/workflows/docker.yml", workflow)).toBe(`docker tag ${OLD}:ci ghcr.io/pulsatrixtechnologies/sagax:latest\n`);
    const releases = `https://github.com/${UPSTREAM}/${OLD}-releases\n`;
    expect(rebrandFile("docs/releasing.md", releases)).toBe(releases);
  });

  it("names the product in the native copy files, keeping credit and resource names", () => {
    const strings = `<string name="mobile_send_to_${OLD}">Send to ${Old}</string>\n<string name="x">That is not an ${Old} pairing QR code.</string>\n`;
    expect(rebrandFile("android/app/src/main/res/values-fr/strings.xml", strings)).toBe(
      `<string name="mobile_send_to_${OLD}">Send to Sagax</string>\n<string name="x">That is not a Sagax pairing QR code.</string>\n`,
    );
    expect(rebrandFile("ios/AppStore/en-US/description.txt", `Requires ${Old}.\nBased on ${Old} 1.0.\n`)).toBe(`Requires Sagax.\nBased on ${Old} 1.0.\n`);
    // other native sources keep their own pace
    const kotlin = `val copy = "Keep ${Old} open"\n`;
    expect(rebrandFile("android/app/src/main/kotlin/x/SharePolicy.kt", kotlin)).toBe(kotlin);
  });

  it("renames the Android signing variables and keeps the documented fallback", () => {
    const UP = OLD.toUpperCase();
    const gradle = `signingMaterial("storeFile", "${UP}_KEYSTORE_FILE")\nsigningMaterial("keyAlias", "SAGAX_KEY_ALIAS", "${UP}_KEY_ALIAS")\n`;
    expect(rebrandFile("android/app/build.gradle.kts", gradle)).toBe(
      `signingMaterial("storeFile", "SAGAX_KEYSTORE_FILE")\nsigningMaterial("keyAlias", "SAGAX_KEY_ALIAS", "${UP}_KEY_ALIAS")\n`,
    );
  });

  it("reports npm install hints in docs without rewriting them", () => {
    const doc = `run this:\nnpx ${OLD} serve\nnpm install --global --prefix "$HOME/.local" ${OLD}@X.Y.Z\n`;
    expect(npmInstallHints("docs/self-hosting.md", doc)).toEqual([
      [2, `npx ${OLD}`],
      [3, `npm install --global --prefix "$HOME/.local" ${OLD}`],
    ]);
    expect(rebrandFile("docs/self-hosting.md", doc)).toBe(doc);
    expect(npmInstallHints("docs/verification/run-2026-09-07.md", doc)).toEqual([]);
    expect(npmInstallHints("server/cli.ts", doc)).toEqual([]);
  });
});
