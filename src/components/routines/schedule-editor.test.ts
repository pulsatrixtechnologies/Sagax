import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { defaultScheduleModel } from "../../../shared/schedule-model";
import { AdvancedScheduleFields, HumanScheduleFields } from "./HumanScheduleFields";
import { CronSchedulePreview } from "./CronScheduleFields";
import { keptScheduleValue, savedPatternSchedule, scheduleDraftFor, scheduleEditorValue, scheduleSentenceFor } from "./schedule-editor";

const after = Date.parse("2026-10-29T12:00:00Z");
const weekdays = { type: "cron" as const, expression: "30 8,12,16 * * 1-5", timeZone: "America/Toronto" };

afterEach(() => setLocale("en"));

describe("human schedule editor", () => {
  it("opens a saved cron in its model and zone, with a live sentence and three runs", () => {
    const { draft, fits } = scheduleDraftFor(weekdays, after);
    expect(fits).toBe(true);
    expect(draft).toMatchObject({ timeZone: "America/Toronto", model: { frequency: "weekdays", times: ["08:30", "12:30", "16:30"] } });
    const value = scheduleEditorValue(draft, after);
    expect(value.error).toBe("");
    expect(value.schedule).toEqual(weekdays);
    expect(value.sentence).toBe("Weekdays, at 8:30 AM, 12:30 PM and 4:30 PM (Toronto time)");
    expect(value.runs.map((at) => new Date(at).toISOString())).toEqual([
      "2026-10-29T12:30:00.000Z", "2026-10-29T16:30:00.000Z", "2026-10-29T20:30:00.000Z",
    ]);
    setLocale("fr");
    expect(scheduleSentenceFor(weekdays)).toBe("Du lundi au vendredi, à 8 h 30, 12 h 30 et 16 h 30 (heure de Toronto)");
  });

  it("keeps a schedule no model fits, described in words, never as the expression", () => {
    const odd = { type: "cron" as const, expression: "15 9-17/2 * * 1-5", timeZone: "America/Toronto" };
    expect(scheduleDraftFor(odd, after).fits).toBe(false);
    const value = keptScheduleValue(odd, after);
    expect(value.schedule).toBe(odd);
    expect(value.sentence).toBe("Weekdays, every 2 hours, 9 AM to 5 PM, at :15 (Toronto time)");
    const opaque = keptScheduleValue({ ...odd, expression: "0 9 1 * 1" }, after);
    expect(opaque.sentence).toBe("Custom schedule (Toronto time)");
    const markup = renderToStaticMarkup(createElement(AdvancedScheduleFields, { value: opaque, onSimplify: vi.fn() }));
    expect(markup).toContain("Choose a simple schedule");
    expect(markup).not.toContain("0 9 1 * 1");
    expect(markup).not.toMatch(/cron/i);
  });

  it("opens a daily routine in the person's zone and saves one time there as daily", () => {
    const { draft } = scheduleDraftFor({ type: "daily", time: "07:15", weekdays: [1, 3, 5] }, after);
    expect(draft.model).toMatchObject({ frequency: "days", times: ["07:15"], weekdays: [1, 3, 5] });
    const value = scheduleEditorValue(draft, after);
    expect(savedPatternSchedule(value.schedule!, draft)).toEqual({ type: "daily", time: "07:15", weekdays: [1, 3, 5] });
    const twice = { ...draft, model: { ...draft.model, times: ["07:15", "19:15"] } };
    expect(savedPatternSchedule(scheduleEditorValue(twice, after).schedule!, twice)).toEqual({ type: "cron", expression: "15 7,19 * * 1,3,5", timeZone: draft.timeZone });
  });

  it("says why a schedule cannot be saved", () => {
    const draft = { model: defaultScheduleModel({ times: ["08:15", "12:30"] }), timeZone: "America/Toronto" };
    expect(scheduleEditorValue(draft, after)).toMatchObject({ schedule: null, error: "Times on the same day share their minutes, for example 8:30 and 12:30." });
    expect(scheduleEditorValue({ ...draft, model: defaultScheduleModel(), timeZone: "Not/AZone" }, after).error).toBe("Choose a time zone from the list.");
    expect(scheduleEditorValue({ ...draft, model: defaultScheduleModel({ frequency: "yearly", monthDay: 31, month: 2 }) }, after).error).toBe("This schedule has no upcoming runs. Choose a date that exists.");
  });

  it("draws times, days, the zone by its city, the sentence and the next runs, without cron", () => {
    const { draft } = scheduleDraftFor(weekdays, after);
    const markup = renderToStaticMarkup(createElement(HumanScheduleFields, { draft, value: scheduleEditorValue(draft, after), onChange: vi.fn() }));
    expect(markup.match(/type="time"/g)).toHaveLength(3);
    expect(markup).toContain("Add a time");
    expect(markup).toContain("Weekdays, at 8:30 AM, 12:30 PM and 4:30 PM (Toronto time)");
    expect(markup).toContain("Next runs · Toronto");
    expect(markup.match(/<time /g)).toHaveLength(3);
    expect(markup).not.toMatch(/cron|America\/Toronto"?>America/i);
    const days = { ...draft, model: { ...draft.model, frequency: "days" as const, weekdays: [1, 3] } };
    const dayMarkup = renderToStaticMarkup(createElement(HumanScheduleFields, { draft: days, value: scheduleEditorValue(days, after), onChange: vi.fn() }));
    expect(dayMarkup.match(/aria-pressed="true"/g)).toHaveLength(2);
    expect(dayMarkup.match(/aria-pressed=/g)).toHaveLength(7);
    const monthly = { ...draft, model: { ...draft.model, frequency: "monthly" as const, monthDay: 31, times: ["09:00"] } };
    const monthMarkup = renderToStaticMarkup(createElement(HumanScheduleFields, { draft: monthly, value: scheduleEditorValue(monthly, after), onChange: vi.fn() }));
    expect(monthMarkup).toContain("Last day");
    expect(monthMarkup).toContain("Months without this date are skipped");
  });

  it("labels paused dates as a preview, by the zone's city", () => {
    const markup = renderToStaticMarkup(createElement(CronSchedulePreview, { schedule: weekdays, paused: true }));
    expect(markup).toContain("Paused: schedule preview · Toronto");
    expect(markup).not.toMatch(/[–—]/);
    expect(markup.match(/<time /g)).toHaveLength(3);
  });
});
