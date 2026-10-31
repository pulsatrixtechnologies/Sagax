import { createElement } from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale, t } from "@/lib/i18n";
import { RoutineScheduleNote, schedulePlace } from "./RoutineScheduleNote";

vi.stubGlobal("window", {});

afterEach(() => {
  setLocale("en");
  delete (window as { ogb?: unknown }).ogb;
});

describe("schedulePlace", () => {
  it("picks local or server from the desktop flag", () => {
    expect(schedulePlace({ local: true })).toEqual({ kind: "local" });
    expect(schedulePlace({ local: false })).toEqual({ kind: "server" });
  });
});

describe("RoutineScheduleNote", () => {
  it("uses the translated local note on this computer, never hard-coded English", () => {
    window.ogb = { remoteClient: { active: false } } as Window["ogb"];
    setLocale("fr");
    const markup = renderToStaticMarkup(createElement(RoutineScheduleNote));
    expect(markup).toContain('data-routine-schedule-note="local"');
    expect(markup).toContain("Sagax est ouvert sur cet ordinateur");
    expect(t("routines.scheduleNote.local")).toContain("Sagax est ouvert sur cet ordinateur");
    expect(markup).not.toContain("Runs while Sagax");
    expect(markup).not.toMatch(/\u2014|\u2013/);
  });

  it("uses the translated server note off this computer", () => {
    delete (window as { ogb?: unknown }).ogb;
    setLocale("fr");
    const markup = renderToStaticMarkup(createElement(RoutineScheduleNote));
    expect(markup).toContain('data-routine-schedule-note="server"');
    expect(markup).toContain("ce serveur fonctionne");
    expect(t("routines.scheduleNote.server")).toContain("ce serveur fonctionne");
  });

  it("keeps the local branch on the locale key in source", () => {
    const source = readFileSync(new URL("./RoutineScheduleNote.tsx", import.meta.url), "utf8");
    expect(source).toContain('t("routines.scheduleNote.local")');
    expect(source).not.toContain("Runs while Sagax is open");
    expect(source).not.toMatch(/\u2014|\u2013/);
  });
});
