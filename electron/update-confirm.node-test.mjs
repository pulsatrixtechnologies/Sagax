import assert from "node:assert/strict";
import test from "node:test";

import { confirmLanguage, confirmedInstall, updateConfirmOptions } from "./update-confirm.mjs";

test("Later is the default and the cancel answer: Enter or Escape never installs", () => {
  for (const platform of ["win32", "darwin", "linux"]) {
    const options = updateConfirmOptions({ language: "fr", platform, version: "0.5.24" });
    assert.deepEqual(options.buttons, ["Redémarrer pour installer", "Plus tard"]);
    assert.equal(options.defaultId, 1);
    assert.equal(options.cancelId, 1);
  }
  assert.equal(confirmedInstall({ response: 0 }), true);
  for (const result of [{ response: 1 }, { response: -1 }, {}, null, undefined]) assert.equal(confirmedInstall(result), false);
});

test("names the version and, on Windows, the installer's progress and the relaunch", () => {
  const fr = updateConfirmOptions({ language: "fr", platform: "win32", version: "0.5.24" });
  assert.equal(fr.message, "Sagax 0.5.24 est prête à installer");
  assert.match(fr.detail, /L'installateur affiche sa progression, puis Sagax se rouvre/);
  const en = updateConfirmOptions({ language: "en", platform: "darwin", version: " " });
  assert.equal(en.message, "A Sagax update is ready to install");
  assert.deepEqual(en.buttons, ["Restart to install", "Later"]);
  assert.match(en.detail, /restart to install/);
  for (const text of [fr.message, fr.detail, en.message, en.detail, ...fr.buttons, ...en.buttons]) {
    assert.doesNotMatch(text, /[–—]/, "no en or em dash");
  }
});

test("French for a French choice or system, English otherwise", () => {
  assert.equal(confirmLanguage("fr"), "fr");
  assert.equal(confirmLanguage("fr-CA"), "fr");
  assert.equal(confirmLanguage("", "fr-CA"), "fr");
  assert.equal(confirmLanguage(null, "fr"), "fr");
  assert.equal(confirmLanguage("en", "fr-CA"), "en");
  assert.equal(confirmLanguage("de"), "en");
  assert.equal(confirmLanguage(null, undefined), "en");
});
