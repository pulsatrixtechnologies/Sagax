import { describe, expect, it } from "vitest";

import {
  footerMenuItems,
  profileInitials,
  profileLabel,
  profileMenuItems,
  updateBusy,
  updateNoteworthy,
  updateLabel,
  updatePhase,
} from "./SidebarProfileMenu";
import { APP_REPOSITORY, DOCS_URL, HELP_CENTER_URL, LICENSE_URL, RELEASES_URL, platformLabel } from "@/lib/app-links";
import type { UpdaterState } from "@/lib/updater";

const state = (patch: Partial<UpdaterState>): UpdaterState => ({ status: "idle", ...patch }) as UpdaterState;

describe("profileInitials", () => {
  it("takes the first letter of the first two words", () => {
    expect(profileInitials({ name: "Milind Soni" })).toBe("MS");
    expect(profileInitials({ name: "Ada Byron Lovelace" })).toBe("AB");
  });

  it("falls back to the email, then to a placeholder", () => {
    expect(profileInitials({ email: "you@x.dev" })).toBe("Y");
    expect(profileInitials({})).toBe("?");
    expect(profileInitials(undefined)).toBe("?");
  });

  it("ignores whitespace-only names", () => {
    expect(profileInitials({ name: "   ", email: "you@x.dev" })).toBe("Y");
  });
});

describe("profileLabel", () => {
  it("prefers the name, then the email, then You", () => {
    expect(profileLabel({ name: "Omkar", email: "o@x.dev" })).toBe("Omkar");
    expect(profileLabel({ email: "o@x.dev" })).toBe("o@x.dev");
    expect(profileLabel(undefined)).toBe("You");
  });
});

describe("updatePhase", () => {
  it("reports the bridge's own in-flight states", () => {
    expect(updatePhase(state({ status: "checking" }), false)).toBe("checking");
    expect(updatePhase(state({ status: "downloading" }), false)).toBe("downloading");
    expect(updatePhase(state({ status: "preparing" }), false)).toBe("preparing");
    expect(updatePhase(state({ status: "installing" }), false)).toBe("installing");
  });

  it("acknowledges a check that found nothing", () => {
    expect(updatePhase(null, true)).toBe("up-to-date");
    expect(updatePhase(null, false)).toBe("idle");
  });

  // the acknowledgement is only for a genuinely quiet result — a found
  // update must not be papered over by a stale "up to date"
  it("lets a real status outrank the acknowledgement", () => {
    expect(updatePhase(state({ status: "available" }), true)).toBe("available");
  });
});

describe("updateLabel", () => {
  it("names the version it found and the one it is ready to install", () => {
    expect(updateLabel("available", state({ status: "available", version: "0.2.0" }))).toBe(
      "Version 0.2.0 available · Download",
    );
    expect(updateLabel("downloaded", state({ status: "downloaded", version: "0.2.0" }))).toBe(
      "Version 0.2.0 ready · Restart",
    );
  });

  it("shows progress only once there is a percentage", () => {
    expect(updateLabel("downloading", state({ status: "downloading" }))).toBe("Starting download…");
    expect(updateLabel("downloading", state({ status: "downloading", percent: 41.6 }))).toBe("Downloading… 42%");
  });

  it("distinguishes native preparation from restart readiness", () => {
    expect(updateLabel("preparing", state({ status: "preparing", percent: 100 }))).toBe("Preparing update…");
    expect(updateLabel("installing", state({ status: "installing", message: "Restart is taking longer than expected." })))
      .toBe("Restart is taking longer than expected.");
    expect(updateLabel("downloaded", state({ status: "downloaded", version: "0.2.0", installMode: "handoff" })))
      .toBe("Version 0.2.0 ready · Install");
    expect(updateLabel("installing", state({ status: "installing", installMode: "handoff" })))
      .toBe("Opening a terminal…");
  });

  it("carries the updater's own message when something failed", () => {
    expect(updateLabel("error", state({ status: "error", message: "Network unreachable" }))).toBe(
      "Network unreachable",
    );
    expect(updateLabel("error", state({ status: "error" }))).toBe("Update failed. Try again");
  });

  it("points a hand-off at the terminal that finishes it", () => {
    expect(updateLabel("handed-off", state({ status: "handed-off" }))).toBe(
      "Finish the update in your terminal",
    );
  });

  it("defaults to the invitation to check", () => {
    expect(updateLabel("idle", null)).toBe("Check for updates");
    expect(updateLabel("up-to-date", null)).toBe("You're up to date");
  });
});

describe("updateBusy", () => {
  it("blocks clicks while something is in flight", () => {
    expect(updateBusy("checking")).toBe(true);
    expect(updateBusy("downloading")).toBe(true);
    expect(updateBusy("preparing")).toBe(true);
    expect(updateBusy("installing")).toBe(true);
    expect(updateBusy("available")).toBe(false);
    expect(updateBusy("downloaded")).toBe(false);
    expect(updateBusy("idle")).toBe(false);
  });

  // the click starts a round-trip through main; until it lands, the status
  // still reads "available" and the row would otherwise invite a second click
  it("blocks the gap between the click and the bridge catching up", () => {
    expect(updateBusy("available", true)).toBe(true);
    expect(updateBusy("downloaded", true)).toBe(true);
  });
});

describe("platformLabel", () => {
  it("names the platforms we ship, and stays quiet otherwise", () => {
    expect(platformLabel("darwin")).toBe("macOS");
    expect(platformLabel("win32")).toBe("Windows");
    expect(platformLabel("linux")).toBe("Linux");
    expect(platformLabel("freebsd")).toBeNull();
    expect(platformLabel(undefined)).toBeNull();
  });
});

describe("updateNoteworthy", () => {
  it("puts a real update on the profile row", () => {
    expect(updateNoteworthy("available")).toBe(true);
    expect(updateNoteworthy("downloading")).toBe(true);
    expect(updateNoteworthy("preparing")).toBe(true);
    expect(updateNoteworthy("downloaded")).toBe(true);
    expect(updateNoteworthy("installing")).toBe(true);
    expect(updateNoteworthy("error")).toBe(true);
    expect(updateNoteworthy("handed-off")).toBe(true);
  });

  // a check the user started from inside the open menu is answered there;
  // badging the row for it would flash at someone already looking elsewhere
  it("leaves a quiet updater quiet", () => {
    expect(updateNoteworthy("idle")).toBe(false);
    expect(updateNoteworthy("checking")).toBe(false);
    expect(updateNoteworthy("up-to-date")).toBe(false);
  });

  it("shows the click that has not landed yet", () => {
    expect(updateNoteworthy("idle", true)).toBe(true);
  });
});

describe("outward links", () => {
  // both were pointed somewhere else once; pin them so a future tidy-up of
  // app-links does not quietly send Help back to the README
  it("sends Help Center, docs, releases, and the license to this fork", () => {
    expect(HELP_CENTER_URL).toBe(DOCS_URL);
    expect(DOCS_URL).toBe(`${APP_REPOSITORY}/tree/main/docs`);
    expect(RELEASES_URL).toBe(`${APP_REPOSITORY}/releases`);
    expect(LICENSE_URL).toBe(`${APP_REPOSITORY}/blob/main/LICENSE`);
    expect(APP_REPOSITORY).toBe("https://github.com/pulsatrixtechnologies/sagax");
  });
});

describe("profileMenuItems", () => {
  const handlers = {
    onTeamMap: () => {},
    onAutomations: () => {},
    onSettings: () => {},
    onAchievements: () => {},
    onShortcuts: () => {},
    onAbout: () => {},
    onReleaseNotes: () => {},
  };
  const items = (patch: Partial<Parameters<typeof profileMenuItems>[0]> = {}) => profileMenuItems({
    teamMapLabel: "Team map",
    automationsLabel: "Automations",
    settingsLabel: "Settings",
    achievementsLabel: "Achievements",
    aboutLabel: "About",
    releaseNotesLabel: "Release notes",
    teamMapActive: false,
    automationsActive: true,
    routineAttention: true,
    updateItem: null,
    handlers,
    ...patch,
  });

  it("puts Release notes right above Check for updates and opens the browse sheet", () => {
    const calls: string[] = [];
    const update = { key: "update", label: "Check for updates", onSelect: () => {} };
    const menu = items({ updateItem: update as never, handlers: { ...handlers, onReleaseNotes: () => calls.push("browse") } });
    const keys = menu.map((entry) => entry.key);
    expect(keys.indexOf("release-notes")).toBe(keys.indexOf("update") - 1);
    const entry = menu.find((item) => item.key === "release-notes");
    expect(entry?.label).toBe("Release notes");
    entry?.onSelect();
    expect(calls).toEqual(["browse"]);
  });

  it("leads with Team map and Automations, then a hairline, and leaves out phone and help", () => {
    const menu = items();
    expect(menu.map((entry) => entry.key)).toEqual([
      "team-map", "routines", "settings", "achievements", "shortcuts", "release-notes", "about",
    ]);
    expect(menu.find((entry) => entry.key === "settings")?.separatorBefore).toBe(true);
    expect(menu.find((entry) => entry.key === "about")?.separatorBefore).toBe(true);
    expect(menu.find((entry) => entry.key === "team-map")?.separatorBefore).toBeUndefined();
    expect(menu.find((entry) => entry.key === "routines")).toMatchObject({
      attention: true,
      active: true,
      tourId: "nav-automations",
    });
    expect(menu.some((entry) => entry.key === "phone" || entry.key === "help")).toBe(false);
  });

  it("drops achievements when they are not ready and keeps one hairline under the pair", () => {
    const menu = items({ achievementsLabel: null, routineAttention: false, automationsActive: false });
    expect(menu.map((entry) => entry.key)).toEqual(["team-map", "routines", "settings", "shortcuts", "release-notes", "about"]);
    expect(menu.filter((entry) => entry.separatorBefore).map((entry) => entry.key)).toEqual(["settings", "about"]);
  });
});

describe("footerMenuItems", () => {
  const item = (key: string) => ({ key, label: key, onSelect: () => {} });

  it("lists the places first, then a hairline, then the profile items", () => {
    const merged = footerMenuItems(
      [item("team-map"), item("routines"), item("plugins"), item("templates")],
      [item("phone"), item("settings"), item("about")],
    );
    expect(merged.map((entry) => entry.key)).toEqual(["team-map", "routines", "plugins", "templates", "phone", "settings", "about"]);
    expect(merged.find((entry) => entry.key === "phone")?.separatorBefore).toBe(true);
    expect(merged.filter((entry) => entry.separatorBefore)).toHaveLength(1);
  });

  it("is the profile menu alone without places", () => {
    const profile = [item("phone"), item("settings")];
    expect(footerMenuItems([], profile)).toBe(profile);
  });
});
