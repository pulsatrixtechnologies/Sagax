// Settings > Appearance > Sidebar > "Keep people apart": unassigned
// conversations with people sit in their own automatic sidebar section
// (builtin:people), next to Unassigned's bots and groups, instead of
// mixing with them. On by default (#1661). Personal sections stay free to
// hold a bot, a group and a person together. Kept like the other appearance
// choices (localStorage, and per person on an organization server through
// shared/user-preferences.ts), changed by a bot through the settings tool
// (shared/settings-actions.ts, appearance.sidebarPeopleApart), applied live.
import { useSyncExternalStore } from "react";
import { localChoice } from "./local-choice";

export const SIDEBAR_PEOPLE_APART_KEY = "sagax.sidebarPeopleApart.v1";
export const SIDEBAR_PEOPLE_APART_CHOICES = ["on", "off"] as const;
export type SidebarPeopleApartChoice = (typeof SIDEBAR_PEOPLE_APART_CHOICES)[number];

export const sidebarPeopleApartChoice = localChoice<SidebarPeopleApartChoice>(
  SIDEBAR_PEOPLE_APART_KEY,
  SIDEBAR_PEOPLE_APART_CHOICES,
  "on",
);

/** True when unassigned people sit in their own section (the default). */
export function sidebarPeopleApartEnabled(): boolean {
  return sidebarPeopleApartChoice.get() === "on";
}

export function setSidebarPeopleApart(next: boolean): void {
  sidebarPeopleApartChoice.set(next ? "on" : "off");
}

/** The choice, followed live (this window, another window, a bot, another device). */
export function useSidebarPeopleApart(): boolean {
  // Same get on the server snapshot (static renders, tests): renderToStaticMarkup
  // must see the session choice, not the fallback.
  return useSyncExternalStore(sidebarPeopleApartChoice.subscribe, sidebarPeopleApartChoice.get, sidebarPeopleApartChoice.get) === "on";
}
