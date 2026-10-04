import { expect, it } from "vitest";

import en from "./en.json";
import fr from "./fr.json";

const translated = [
  "botSettings.nav.overview",
  "botPanel.model.backups",
  "botPanel.access.nothing",
  "botPanel.overview.refresh",
  "botPanel.memory.upkeepHelp",
  "settings.share.intro",
  "settings.servers.title",
  "fullAccessWarning.body",
  "localAuto.title",
  "botPanel.skills.title",
  "botPanel.routines.instruction",
  "botPanel.avatar.generateAvatar",
  "settings.profile.uploadPhoto",
] as const;

it("translates Bot panel and Settings card copy into French", () => {
  for (const key of translated) {
    expect(fr[key], key).toBeTruthy();
    expect(fr[key], key).not.toBe(en[key]);
  }
  expect(en["botPanel.overview.refresh"]).toBe("Couldn’t refresh. Showing the last loaded overview.");
  expect(en["settings.share.intro"]).not.toMatch(/\bworkspaces?\b/i);
  expect(en["fullAccessWarning.body"]).not.toMatch(/[\u2013\u2014]/);
  expect(en["botPanel.access.placeholder"]).toBe("Private bot folder, or an absolute path");
  expect(fr["botSettings.nav.soul"]).toBe("Soul");
});
