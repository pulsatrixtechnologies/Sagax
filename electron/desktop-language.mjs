// The language the person last chose in this app, whatever page they chose
// it on. The local page and an organization server's page (this app's
// bundle drawn on that origin, bundled-ui.cjs) each have their own
// localStorage, so a choice made on one was invisible to the other: French
// picked on the organization's page left the launch screen in English. Main
// keeps it in the app's own userData, like routine-wake.json and
// update-preferences.json, and the preload hands it to the page.
//
// "" is a choice (follow the system); null means never chosen. Pure file
// helpers, so they are tested without Electron.
import fs from "node:fs";
import path from "node:path";

const FILE = "desktop-language.json";
// A BCP 47-ish tag (fr, en-US, zh-Hant-TW) or "" for the system language.
const TAG = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/;

/** The value itself when it is a language the page may store, else null. */
export function normalizeDesktopLanguage(value) {
  if (value === "") return "";
  if (typeof value !== "string" || value.length > 35 || !TAG.test(value)) return null;
  return value;
}

export function readDesktopLanguage(userData, { fsImpl = fs } = {}) {
  try {
    const parsed = JSON.parse(fsImpl.readFileSync(path.join(userData, FILE), "utf8"));
    return normalizeDesktopLanguage(parsed?.language);
  } catch {
    return null;
  }
}

/** Temp-and-rename, so a crash mid-write never leaves a truncated file.
 * Returns the stored value, or null when the value was refused or the
 * write failed. */
export function writeDesktopLanguage(userData, value, { fsImpl = fs } = {}) {
  const language = normalizeDesktopLanguage(value);
  if (language === null) return null;
  const file = path.join(userData, FILE);
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    fsImpl.mkdirSync(userData, { recursive: true });
    fsImpl.writeFileSync(temporary, `${JSON.stringify({ language })}\n`, { mode: 0o600 });
    fsImpl.renameSync(temporary, file);
    return language;
  } catch {
    try {
      fsImpl.unlinkSync(temporary);
    } catch {
      /* never created, or already renamed */
    }
    return null;
  }
}
