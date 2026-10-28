// The Data surface's strings have been rewritten twice (#2544, #2596) and
// each pass left keys behind. Every data.* key must still be read somewhere:
// as a literal t("data.…") or map value, or through a template on its parent
// (t(`data.view.${mode}`)).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

import en from "./en.json";

const root = fileURLToPath(new URL("..", import.meta.url));
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "locales" ? [] : sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [readFileSync(path, "utf8")] : [];
  });
}

it("keeps no Data string that nothing reads", () => {
  const code = sources(root).join("\n");
  const unread = Object.keys(en).filter((key) => key.startsWith("data.")).filter((key) => {
    const parent = key.slice(0, key.lastIndexOf(".") + 1);
    return !code.includes(`"${key}"`) && !code.includes(`\`${parent}\${`);
  });
  expect(unread).toEqual([]);
});

// Families still being sorted (#1385). Every other family must be read as a
// literal t("…") or t('…'), or through a template on its parent.
const STILL_SORTING = new Set([
  "access", "achievements", "activity", "approval", "approvalMode", "apps", "attach", "attention",
  "backgroundWork", "backup", "botAccess", "botPanel", "botSettings", "botSetup", "botWizard", "botZip",
  "browser", "call", "canvas", "chat", "cloudAccount", "cloudCredit", "cloudHome", "cloudHowTo",
  "cloudIntro", "cloudNotice", "cloudSignIn", "code", "commandAllowlist", "composer", "computer",
  "connectApps", "connectors", "customRules", "cw", "devPods", "engines", "engineSetup", "floatingBots",
  "folder", "groupPanel", "keys", "leftOut", "library", "manageMembers", "mascot", "mcp", "model",
  "myConnections", "myEngines", "newBot", "notice", "onboarding", "org", "organization", "orgComputer",
  "orgImport", "pair", "people", "persona", "personLabel", "phoneApp", "place", "planUsage", "pro",
  "question", "releaseNotes", "remote", "remoteControl", "remoteSession", "remoteSessionsAdmin", "room",
  "routines", "serverEnvironment", "settings", "sidebar", "star", "step", "stream", "task", "teach",
  "team", "teamBotFromThread", "toolDetail", "triggers", "update", "usage", "vm", "voice", "voiceMode",
  "whop", "worksOn",
]);

it("keeps no catalog string that nothing reads, outside the families still being sorted", () => {
  const code = sources(root).join("\n");
  const unread = Object.keys(en).filter((key) => !STILL_SORTING.has(key.split(".")[0])).filter((key) => {
    const dot = key.lastIndexOf(".");
    const parent = dot === -1 ? "" : key.slice(0, dot + 1);
    const templated = parent.length > 0 && code.includes("`" + parent + "${");
    return !code.includes(`"${key}"`) && !code.includes(`'${key}'`) && !templated;
  });
  expect(unread).toEqual([]);
});
