import Foundation
import XCTest
@testable import CompanionCore

/// WP8: the routine editor's schedules (AU12, AU13), the fields it now sends
/// (AU14), what it must keep (S3), and the run actions (AU6, AU8-AU10, AU15).
/// Expected cron instants were read from croner 10 (the server's calculator).
final class RoutineEditorTests: XCTestCase {
    private func iso(_ text: String) -> Date { ISO8601DateFormatter().date(from: text)! }
    private func isoList(_ dates: [Date]) -> [String] {
        let formatter = ISO8601DateFormatter()
        return dates.map { formatter.string(from: $0) }
    }

    private var montreal: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/Toronto")!
        return calendar
    }

    // MARK: Cron calculator

    func testCronMatchesCronerForDayOrWeekday() throws {
        let cron = try CronExpression(expression: "2 7 1-7 * 1", timeZone: "America/Toronto")
        XCTAssertEqual(isoList(cron.nextRuns(after: iso("2026-10-03T12:00:00Z"), count: 4)), [
            "2026-10-04T11:02:00Z", "2026-10-05T11:02:00Z", "2026-10-06T11:02:00Z", "2026-10-07T11:02:00Z",
        ])
    }

    func testCronLastDayNthAndLastWeekdayAndNames() throws {
        let from = iso("2026-10-03T12:00:00Z")
        XCTAssertEqual(isoList(try CronExpression(expression: "0 9 L * *", timeZone: "UTC").nextRuns(after: from, count: 3)),
                       ["2026-10-31T09:00:00Z", "2026-11-30T09:00:00Z", "2026-12-31T09:00:00Z"])
        XCTAssertEqual(isoList(try CronExpression(expression: "0 9 * * 5L", timeZone: "UTC").nextRuns(after: from, count: 2)),
                       ["2026-10-30T09:00:00Z", "2026-11-27T09:00:00Z"])
        XCTAssertEqual(isoList(try CronExpression(expression: "0 9 * * 5#2", timeZone: "UTC").nextRuns(after: from, count: 2)),
                       ["2026-10-09T09:00:00Z", "2026-11-13T09:00:00Z"])
        XCTAssertEqual(isoList(try CronExpression(expression: "0 9 * JAN,FEB MON-WED", timeZone: "UTC").nextRuns(after: from, count: 2)),
                       ["2027-01-04T09:00:00Z", "2027-01-05T09:00:00Z"])
        XCTAssertEqual(isoList(try CronExpression(expression: "*/20 9-10 * * *", timeZone: "UTC").nextRuns(after: from, count: 4)),
                       ["2026-10-04T09:00:00Z", "2026-10-04T09:20:00Z", "2026-10-04T09:40:00Z", "2026-10-04T10:00:00Z"])
        XCTAssertEqual(isoList(try CronExpression(expression: "0 9 * * 7", timeZone: "UTC").nextRuns(after: from, count: 1)),
                       ["2026-10-04T09:00:00Z"])
        XCTAssertEqual(isoList(try CronExpression(expression: "0 9 15W * *", timeZone: "UTC").nextRuns(after: from, count: 2)),
                       ["2026-10-15T09:00:00Z", "2026-11-16T09:00:00Z"])
        XCTAssertEqual(isoList(try CronExpression(expression: "0 9 * * 1-5/2", timeZone: "UTC").nextRuns(after: from, count: 3)),
                       ["2026-10-05T09:00:00Z", "2026-10-07T09:00:00Z", "2026-10-09T09:00:00Z"])
    }

    func testCronReadsTheZoneAcrossDaylightSaving() throws {
        let cron = try CronExpression(expression: "0 9 1 * *", timeZone: "America/New_York")
        XCTAssertEqual(isoList(cron.nextRuns(after: iso("2026-10-03T12:00:00Z"), count: 3)),
                       ["2026-11-01T14:00:00Z", "2026-12-01T14:00:00Z", "2027-01-01T14:00:00Z"])
    }

    func testCronErrorsMatchTheServer() {
        XCTAssertThrowsError(try CronExpression(expression: "0 9 * *", timeZone: "UTC")) {
            XCTAssertEqual($0 as? CronExpression.Failure, .fields)
        }
        XCTAssertThrowsError(try CronExpression(expression: "@daily x y z w", timeZone: "UTC"))
        XCTAssertThrowsError(try CronExpression(expression: "0 9 * * *", timeZone: "+05:00")) {
            XCTAssertEqual($0 as? CronExpression.Failure, .zone)
        }
        XCTAssertThrowsError(try CronExpression(expression: "0 9 * * *", timeZone: "Mars/Olympus")) {
            XCTAssertEqual($0 as? CronExpression.Failure, .invalidZone)
        }
        XCTAssertThrowsError(try CronExpression(expression: "61 9 * * *", timeZone: "UTC")) {
            XCTAssertEqual($0 as? CronExpression.Failure, .pattern("Invalid value for minute: 61"))
        }
        XCTAssertThrowsError(try CronExpression(expression: "5/20 * * * *", timeZone: "UTC"))
        XCTAssertThrowsError(try CronExpression.normalized(.cron(expression: "0 9 31 2 *", timeZone: "UTC"), after: Date())) {
            XCTAssertEqual($0 as? CronExpression.Failure, .noFutureRuns)
        }
    }

    /// 2026-10-29: several expressions joined by ";" run at every instant
    /// any of them names, once per instant, in order.
    func testSeveralCronExpressionsMergeTheirRuns() throws {
        let from = iso("2026-10-05T00:00:00Z") // a Monday
        let cron = try CronExpression(expression: " 30 12 * * 1-5 ;15  8 * * 1-5", timeZone: "UTC")
        XCTAssertEqual(cron.expression, "30 12 * * 1-5; 15 8 * * 1-5")
        XCTAssertEqual(isoList(cron.nextRuns(after: from, count: 4)), [
            "2026-10-05T08:15:00Z", "2026-10-05T12:30:00Z", "2026-10-06T08:15:00Z", "2026-10-06T12:30:00Z",
        ])
        // the same instant twice runs once
        let twice = try CronExpression(expression: "30 8 * * *; 30 8 * * *", timeZone: "UTC")
        XCTAssertEqual(twice.expression, "30 8 * * *")
        XCTAssertEqual(isoList(twice.nextRuns(after: from, count: 3)),
                       ["2026-10-05T08:30:00Z", "2026-10-06T08:30:00Z", "2026-10-07T08:30:00Z"])
        let overlap = try CronExpression(expression: "30 8,9 * * *; 30 9 * * *", timeZone: "UTC")
        XCTAssertEqual(isoList(overlap.nextRuns(after: from, count: 3)),
                       ["2026-10-05T08:30:00Z", "2026-10-05T09:30:00Z", "2026-10-06T08:30:00Z"])
        // one expression stays as it was
        XCTAssertEqual(try CronExpression(expression: "30  8 * * 1-5", timeZone: "UTC").expression, "30 8 * * 1-5")
        XCTAssertEqual(try CronExpression.normalized(.cron(expression: "15 8 * * 1-5;30 12 * * 1-5", timeZone: "UTC"), after: from).expression,
                       "15 8 * * 1-5; 30 12 * * 1-5")
    }

    func testSeveralCronExpressionsKeepTheServerLimits() {
        XCTAssertThrowsError(try CronExpression(expression: "15 8 * * 1-5; 30 12 * *", timeZone: "UTC")) {
            XCTAssertEqual($0 as? CronExpression.Failure, .fields)
        }
        XCTAssertThrowsError(try CronExpression(expression: " ; ", timeZone: "UTC")) {
            XCTAssertEqual($0 as? CronExpression.Failure, .fields)
        }
        XCTAssertThrowsError(try CronExpression(expression: "15 8 * * *; 61 9 * * *", timeZone: "UTC")) {
            XCTAssertEqual($0 as? CronExpression.Failure, .pattern("Invalid value for minute: 61"))
        }
        let twentyFour = (0..<24).map { "\($0) \($0) * * *" }.joined(separator: "; ")
        XCTAssertNoThrow(try CronExpression(expression: twentyFour, timeZone: "UTC"))
        XCTAssertThrowsError(try CronExpression(expression: twentyFour + "; 30 0 * * *", timeZone: "UTC")) {
            XCTAssertEqual($0 as? CronExpression.Failure, .fields)
        }
    }

    // MARK: The schedule form

    func testRecurrenceIsReadFromTheSchedule() {
        let at = iso("2026-10-05T13:00:00Z") // a Monday in Toronto
        let calendar = montreal
        XCTAssertEqual(RoutineScheduleForm.recurrence(for: nil, at: at, calendar: calendar), .none)
        XCTAssertEqual(RoutineScheduleForm.recurrence(for: .daily(time: "09:00", weekdays: [0, 1, 2, 3, 4, 5, 6]), at: at, calendar: calendar), .daily)
        XCTAssertEqual(RoutineScheduleForm.recurrence(for: .daily(time: "09:00", weekdays: [1, 2, 3, 4, 5]), at: at, calendar: calendar), .weekdays)
        XCTAssertEqual(RoutineScheduleForm.recurrence(for: .daily(time: "09:00", weekdays: [1]), at: at, calendar: calendar), .days)
        XCTAssertEqual(RoutineScheduleForm.recurrence(for: .daily(time: "09:00", weekdays: [2]), at: at, calendar: calendar), .days)
        XCTAssertEqual(RoutineScheduleForm.recurrence(for: .cron(expression: "0 9 1 * *", timeZone: "UTC"), at: at, calendar: calendar), .monthly)
        XCTAssertEqual(RoutineScheduleForm.recurrence(for: .cron(expression: "0 9 1 1 *", timeZone: "UTC"), at: at, calendar: calendar), .yearly)
        XCTAssertEqual(RoutineScheduleForm.recurrence(for: .cron(expression: "30 * * * *", timeZone: "UTC"), at: at, calendar: calendar), .hourly)
        XCTAssertEqual(RoutineScheduleForm.recurrence(for: .cron(expression: "*/15 * * * *", timeZone: "UTC"), at: at, calendar: calendar), .interval)
        XCTAssertEqual(RoutineScheduleForm.recurrence(for: .cron(expression: "2 7 1-7 * 1", timeZone: "UTC"), at: at, calendar: calendar), .advanced)
        XCTAssertEqual(RoutineScheduleForm.recurrence(for: .interval(everyMinutes: 15, anchorAt: at), at: at, calendar: calendar), .interval)
    }

    func testEveryKindRoundTripsUnchanged() throws {
        let now = iso("2026-10-03T12:00:00Z")
        var interval = RoutineSchedule.interval(everyMinutes: 30, anchorAt: iso("2026-10-01T13:00:00Z"))
        interval.weekdays = [1, 3, 5]
        interval.window = RoutineIntervalWindow(start: "08:00", end: "18:00")
        interval.endsAt = 1_830_000_000_000
        let schedules: [RoutineSchedule] = [
            .once(at: iso("2026-10-09T15:00:07Z")),
            .daily(time: "07:00", weekdays: [1]),
            .daily(time: "07:00", weekdays: [0, 1, 2, 3, 4, 5, 6]),
            .daily(time: "06:45", weekdays: [2, 4]),
            interval,
            .interval(everyMinutes: 15, anchorAt: iso("2026-10-01T13:00:00Z")),
            .cron(expression: "2 7 1-7 * 1", timeZone: "America/Toronto"),
            .cron(expression: "0 9 1 * *", timeZone: "UTC"),
            .cron(expression: "30 8,12,16 * * MON-FRI", timeZone: "America/Toronto"),
            .cron(expression: "*/15 * * * *", timeZone: "Europe/Paris"),
            .cron(expression: "0 9 * * 1#2", timeZone: "UTC"),
        ]
        for schedule in schedules {
            let form = RoutineScheduleForm(schedule: schedule, seedAt: iso("2026-10-05T11:00:00Z"), now: now, calendar: montreal)
            let saved = try form.schedule(savedAt: now)
            XCTAssertTrue(RoutinePatch.sameSchedule(saved, schedule), "\(schedule) became \(saved)")
        }
    }

    func testCertainDaysSaveAsCronInTheZone() throws {
        var form = RoutineScheduleForm(schedule: nil, seedAt: iso("2026-10-07T13:00:00Z"), now: iso("2026-10-03T12:00:00Z"), calendar: montreal)
        XCTAssertEqual(form.timeZone, "America/Toronto")
        form.select(.days)
        form.model.weekdays = [3]
        var expected = RoutineSchedule.cron(expression: "0 9 * * 3", timeZone: "America/Toronto")
        expected.timing = "exact" // a repeating save names its timing (withRoutineTiming)
        XCTAssertEqual(try form.schedule(savedAt: Date()), expected)
        form.toggleModelWeekday(3)
        XCTAssertEqual(form.problem, .schedule(.noDays))
        form.toggleModelWeekday(5)
        form.toggleModelWeekday(1)
        XCTAssertEqual(try form.schedule(savedAt: Date()).expression, "0 9 * * 1,5")
    }

    func testAnEditedDailyBecomesCronAndAnUntouchedOneStaysDaily() throws {
        let now = iso("2026-10-03T12:00:00Z")
        let daily = RoutineSchedule.daily(time: "07:30", weekdays: [1, 2, 3, 4, 5])
        var form = RoutineScheduleForm(schedule: daily, seedAt: now, now: now, calendar: montreal)
        XCTAssertEqual(form.recurrence, .weekdays)
        XCTAssertEqual(form.model.times, ["07:30"])
        XCTAssertFalse(form.scheduleChanged)
        XCTAssertEqual(try form.schedule(savedAt: now).type, .daily)
        XCTAssertEqual(form.preview?.runs.count, 3)
        form.addTime()
        XCTAssertEqual(form.model.times, ["07:30", "08:30"])
        XCTAssertEqual(try form.schedule(savedAt: now).expression, "30 7,8 * * 1-5")
        form.removeTime(at: 1)
        form.timeZone = "Europe/Paris"
        let saved = try form.schedule(savedAt: now)
        XCTAssertEqual(saved.expression, "30 7 * * 1-5")
        XCTAssertEqual(saved.timeZone, "Europe/Paris")
    }

    func testEachTimeKeepsItsOwnMinutes() throws {
        let now = iso("2026-10-03T12:00:00Z")
        var form = RoutineScheduleForm(schedule: nil, seedAt: iso("2026-10-07T13:00:00Z"), now: now, calendar: montreal)
        form.select(.weekdays)
        form.model.times = ["12:30", "08:15"]
        XCTAssertNil(form.problem)
        let saved = try form.schedule(savedAt: now)
        XCTAssertEqual(saved.expression, "15 8 * * 1-5; 30 12 * * 1-5")
        // Monday 5 October, Toronto time
        XCTAssertEqual(isoList(form.preview?.runs ?? []), ["2026-10-05T12:15:00Z", "2026-10-05T16:30:00Z", "2026-10-06T12:15:00Z"])
        // reopened, it is the same weekdays model
        let reopened = RoutineScheduleForm(schedule: saved, seedAt: now, now: now, calendar: montreal)
        XCTAssertEqual(reopened.recurrence, .weekdays)
        XCTAssertEqual(reopened.model.times, ["08:15", "12:30"])
    }

    func testAnAdvancedCronIsKeptUntilASimpleScheduleIsChosen() throws {
        let now = iso("2026-10-03T12:00:00Z")
        let original = RoutineSchedule.cron(expression: "2  7 1-7 * 1", timeZone: "America/Toronto")
        var form = RoutineScheduleForm(schedule: original, seedAt: now, now: now, calendar: montreal)
        XCTAssertEqual(form.recurrence, .advanced)
        XCTAssertEqual(form.preview?.runs.count, 3)
        XCTAssertEqual(try form.schedule(savedAt: now).expression, "2  7 1-7 * 1")
        form.chooseSimpleSchedule()
        XCTAssertEqual(form.recurrence, .daily)
        // the next run (Sunday 4 October, 7:02 Toronto time) gives the time
        XCTAssertEqual(form.model.times, ["07:02"])
        XCTAssertEqual(try form.schedule(savedAt: now), {
            var schedule = RoutineSchedule.cron(expression: "2 7 * * *", timeZone: "America/Toronto")
            schedule.timing = "exact"
            return schedule
        }())
    }

    func testAnIntervalCronOpensInTheIntervalFieldsAndIsKeptUntouched() throws {
        let now = iso("2026-10-03T12:00:00Z")
        let original = RoutineSchedule.cron(expression: "0 */2 * * *", timeZone: "UTC")
        var form = RoutineScheduleForm(schedule: original, seedAt: now, now: now, calendar: montreal)
        XCTAssertEqual(form.recurrence, .interval)
        XCTAssertEqual(form.intervalUnit, .hours)
        XCTAssertEqual(form.intervalCount, 2)
        XCTAssertEqual(try form.schedule(savedAt: now).expression, "0 */2 * * *")
        form.setIntervalCount(3)
        let saved = try form.schedule(savedAt: now)
        XCTAssertEqual(saved.type, .interval)
        XCTAssertEqual(saved.everyMinutes, 180)
        form.selectIntervalUnit(.minutes)
        XCTAssertEqual(form.intervalMinutes, 15)
    }

    func testANoFutureRunYearlyIsAProblem() {
        var form = RoutineScheduleForm(schedule: nil, seedAt: iso("2026-10-07T13:00:00Z"), now: iso("2026-10-03T12:00:00Z"), calendar: montreal)
        form.select(.yearly)
        form.model.month = 2
        form.model.monthDay = .day(30)
        XCTAssertEqual(form.problem, .cron(CronExpression.Failure.noFutureRuns.errorDescription!))
    }

    func testIntervalValidationMatchesTheDesktop() {
        let now = iso("2026-10-03T12:00:00Z")
        var form = RoutineScheduleForm(schedule: nil, seedAt: now, now: now, calendar: montreal)
        form.select(.interval)
        form.intervalMinutes = 3
        XCTAssertEqual(form.problem, .intervalRange)
        form.intervalMinutes = 60
        form.selectIntervalDays(.custom)
        XCTAssertEqual(form.intervalWeekdays, RoutineScheduleForm.allDays)
        for day in 0...6 { form.toggleIntervalWeekday(day) }
        XCTAssertEqual(form.problem, .noDays)
        form.selectIntervalDays(.weekdays)
        form.windowCustom = true
        form.windowStart = "09:00"
        form.windowEnd = "09:30"
        XCTAssertEqual(form.problem, .window(minutes: 60))
        form.windowEnd = "17:00"
        form.endsOnDate = true
        form.endDate = iso("2026-10-01T12:00:00Z")
        XCTAssertEqual(form.problem, .endDate)
        form.endDate = iso("2026-10-20T12:00:00Z")
        XCTAssertNil(form.problem)
    }

    func testANewIntervalAnchorsOneCadenceAheadAndWritesItsRestrictions() throws {
        let now = iso("2026-10-03T12:00:30Z")
        var form = RoutineScheduleForm(schedule: nil, seedAt: now, now: now, calendar: montreal)
        form.select(.interval)
        form.intervalMinutes = 10
        form.selectIntervalDays(.weekdays)
        form.windowCustom = true
        form.endsOnDate = true
        form.endDate = iso("2026-10-20T12:00:00Z")
        let schedule = try form.schedule(savedAt: now)
        XCTAssertEqual(schedule.anchorAt, Int64(iso("2026-10-03T12:11:00Z").timeIntervalSince1970 * 1_000))
        XCTAssertEqual(schedule.weekdays, [1, 2, 3, 4, 5])
        XCTAssertEqual(schedule.window, RoutineIntervalWindow(start: "09:00", end: "17:00"))
        // the end of 20 October, Toronto time
        XCTAssertEqual(schedule.endsAt, Int64(iso("2026-10-21T03:59:59Z").timeIntervalSince1970 * 1_000) + 999)
    }

    func testAnEditedIntervalKeepsItsPhase() throws {
        let anchor = iso("2026-10-01T13:07:00Z")
        let now = iso("2026-10-03T12:00:00Z")
        let original = RoutineSchedule.interval(everyMinutes: 15, anchorAt: anchor)
        var form = RoutineScheduleForm(schedule: original, seedAt: now, now: now, calendar: montreal)
        form.windowCustom = true
        XCTAssertEqual(try form.schedule(savedAt: now).anchorAt, original.anchorAt)
        form.intervalMinutes = 30
        XCTAssertNotEqual(try form.schedule(savedAt: now).anchorAt, original.anchorAt)
    }

    // MARK: What a save sends (S3)

    private func routine(_ json: String) throws -> Routine {
        try JSONDecoder().decode(Routine.self, from: Data(json.utf8))
    }

    private var desktopRoutine: String {
        #"""
        {"id":"r1","name":"Pulse","prompt":"Check","botId":"b1","runOn":"maus","enabled":true,
         "schedule":{"type":"interval","everyMinutes":15,"anchorAt":1790000000000,"weekdays":[1,2,3],
                     "window":{"start":"08:00","end":"18:00"},"endsAt":1830000000000},
         "durationMinutes":30,"timeoutMinutes":45,"nextRunAt":1790000900000,"createdAt":1,"updatedAt":1,
         "target":"bot","overlap":"queue","resultsThreadId":"t-results",
         "attachments":[{"id":"a1","kind":"file","name":"brief.md","path":"/x/brief.md","size":12}],
         "runAs":{"principalId":"p1","name":"Parity"},"sourceThreadId":"t-source"}
        """#
    }

    /// The editor opened on a desktop routine and saved a rename: only the
    /// name goes out, so the window, end date, overlap, attachments, results
    /// thread and target stay as the desktop set them.
    func testARenameFromTheFullEditorSendsOnlyTheName() throws {
        let original = try routine(desktopRoutine)
        let now = Date(timeIntervalSince1970: 1_790_000_000)
        let form = RoutineScheduleForm(schedule: original.schedule, seedAt: now, now: now)
        let input = RoutineInput(
            name: "Pulse 2", prompt: "Check", botId: "b1", runOn: "maus", schedule: try form.schedule(savedAt: now),
            durationMinutes: 30, timeoutMinutes: 45, target: "bot", overlap: "queue",
            attachments: original.attachments, results: .keep, completeSchedule: true
        )
        let body = RoutinePatch.body(original: original, input: input)
        XCTAssertEqual(Set(body.keys), ["name"])
    }

    func testTheEditorSendsWhatItChanged() throws {
        let original = try routine(desktopRoutine)
        var schedule = original.schedule
        schedule.window = nil
        schedule.endsAt = nil
        let input = RoutineInput(
            name: "Pulse", prompt: "Check", botId: "b1", runOn: "maus", schedule: schedule,
            durationMinutes: 30, timeoutMinutes: 45, target: "bot", overlap: "skip",
            attachments: [], results: .newThread, completeSchedule: true
        )
        let body = RoutinePatch.body(original: original, input: input)
        XCTAssertEqual(body["overlap"] as? String, "skip")
        XCTAssertEqual((body["attachments"] as? [Any])?.count, 0)
        XCTAssertTrue(body["resultsThreadId"] is NSNull)
        let sent = try XCTUnwrap(body["schedule"] as? [String: Any])
        XCTAssertTrue(sent["window"] is NSNull)
        XCTAssertTrue(sent["endsAt"] is NSNull)
        XCTAssertEqual(sent["weekdays"] as? [Int], [1, 2, 3])
        XCTAssertNil(body["target"])
        XCTAssertNil(body["name"])
    }

    func testATeamGoalSendsTheRoomAndALaterBotTaskClearsIt() throws {
        let original = try routine(desktopRoutine)
        var input = RoutineInput(
            name: "Pulse", prompt: "Check", botId: "b2", runOn: "maus", schedule: original.schedule,
            durationMinutes: 30, timeoutMinutes: 45, target: "room-goal", groupId: "g1", overlap: "queue",
            attachments: [], completeSchedule: true
        )
        var body = RoutinePatch.body(original: original, input: input)
        XCTAssertEqual(body["target"] as? String, "room-goal")
        XCTAssertEqual(body["groupId"] as? String, "g1")
        XCTAssertNil(body["resultsThreadId"])
        var goal = original
        goal.target = "room-goal"
        goal.groupId = "g1"
        input.target = "bot"
        body = RoutinePatch.body(original: goal, input: input)
        XCTAssertEqual(body["target"] as? String, "bot")
        XCTAssertTrue(body["groupId"] is NSNull)
    }

    func testAnOlderEditorStillKeepsTheIntervalRestrictions() throws {
        let original = try routine(desktopRoutine)
        let input = RoutineInput(
            name: "Pulse", prompt: "Check", botId: "b1", runOn: "maus",
            schedule: .interval(everyMinutes: 30, anchorAt: Date(timeIntervalSince1970: 1_790_000_000)),
            durationMinutes: 30, timeoutMinutes: 45
        )
        let sent = try XCTUnwrap(RoutinePatch.body(original: original, input: input)["schedule"] as? [String: Any])
        XCTAssertEqual(sent["endsAt"] as? Int64, 1_830_000_000_000)
        XCTAssertNil(RoutinePatch.body(original: original, input: input)["overlap"])
    }

    func testCreateSendsEveryField() {
        let body = RoutinePatch.createBody(RoutineInput(
            name: "N", prompt: "P", botId: "b1", enabled: true, schedule: .cron(expression: "0 9 1 * *", timeZone: "UTC"),
            durationMinutes: 30, timeoutMinutes: nil, clearTimeout: true, target: "bot", overlap: "queue",
            attachments: [RoutineAttachment(id: "a", kind: "image", name: "x.png", path: "/p/x.png", size: 3)],
            results: .newThread, completeSchedule: true
        ))
        XCTAssertEqual(body["target"] as? String, "bot")
        XCTAssertNil(body["groupId"])
        XCTAssertEqual(body["overlap"] as? String, "queue")
        XCTAssertTrue(body["resultsThreadId"] is NSNull)
        XCTAssertTrue(body["timeoutMinutes"] is NSNull)
        XCTAssertEqual(((body["attachments"] as? [[String: Any]])?.first?["kind"]) as? String, "image")
        XCTAssertEqual((body["schedule"] as? [String: Any])?["expression"] as? String, "0 9 1 * *")
    }

    // MARK: Runs

    private func run(_ id: String, _ status: String, bot: String = "b1", seen: Double? = nil, createdAt: Double = 1, output: String? = nil) -> RoutineRun {
        RoutineRun(id: id, routineId: "r-\(bot)", routineName: "Pulse \(bot)", botId: bot, runOn: "maus",
                   scheduledFor: 1, status: status, manual: false, output: output, createdAt: createdAt, seenAt: seen)
    }

    func testProblemsBadgeFilterAndSearch() {
        let runs = [
            run("1", "failed", createdAt: 3), run("2", "missed", seen: 5, createdAt: 2),
            run("3", "completed", bot: "b2", createdAt: 4, output: "Rapport hebdo"), run("4", "running", createdAt: 1),
        ]
        XCTAssertEqual(RoutineRunLog.unseenProblems(runs), 1)
        XCTAssertEqual(RoutineRunLog.active(runs), 1)
        XCTAssertEqual(RoutineRunLog.filter(runs, bots: []).map(\.id), ["3", "1", "2", "4"])
        XCTAssertEqual(RoutineRunLog.filter(runs, bots: [], status: .problems).map(\.id), ["1", "2"])
        XCTAssertEqual(RoutineRunLog.filter(runs, bots: [], status: .status("running")).map(\.id), ["4"])
        XCTAssertEqual(RoutineRunLog.filter(runs, bots: [], query: "HEBDO").map(\.id), ["3"])
        XCTAssertEqual(RoutineRunLog.filter(runs, bots: [], routineId: "r-b2").map(\.id), ["3"])
        XCTAssertEqual(RoutineBotFilter(botId: "b2").runs(runs).map(\.id), ["3"])
        XCTAssertTrue(runs[3].isActive)
        XCTAssertFalse(runs[2].isActive)
        let seen = run("1", "failed", seen: 9, createdAt: 3)
        XCTAssertEqual(RoutineRunLog.replacing(runs, with: [seen]).first?.seenAt, 9)
    }

    func testDecodesARunsNewFields() throws {
        let run = try JSONDecoder().decode(RoutineRun.self, from: Data(#"""
        {"id":"x","routineId":"r","routineName":"N","botId":"b","runOn":"maus","scheduledFor":1,"status":"waiting",
         "manual":true,"createdAt":1,"attention":"Approve?","target":"room-goal","goalStatus":"needs-input",
         "groupId":"g","executionThreadId":"e","resultsThreadId":"t","sourceThreadId":"s"}
        """#.utf8))
        XCTAssertEqual(run.preview, "Approve?")
        XCTAssertEqual(run.labelKey, "goal.needs-input")
        XCTAssertEqual(run.trigger, "manual")
        XCTAssertEqual(run.executionThreadId, "e")
    }

    func testTheGateShowsTheRoutineSurfacesEverywhere() {
        for scope in [PairingScope.sidecar, .serverClient, .serverAdmin] {
            let gate = SurfaceGate(scope: scope)
            for feature in [SurfaceFeature.routineRunCancel, .routineRunsSeen, .routineAdvancedEditor, .routineAttachments] {
                XCTAssertTrue(gate.allows(feature), "\(feature) on \(scope)")
            }
        }
    }
}

// MARK: - Calls

private final class RunCallStub: URLProtocol {
    nonisolated(unsafe) static var requests: [URLRequest] = []

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.requests.append(request)
        let run = #"{"id":"run-1","routineId":"r","routineName":"N","botId":"b","runOn":"maus","scheduledFor":1,"status":"cancelled","manual":false,"createdAt":1,"seenAt":2}"#
        let body = request.url?.path.hasSuffix("seen-all") == true ? #"{"ids":["run-1"],"count":1,"seenAt":2,"runs":[]}"# : #"{"run":\#(run)}"#
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1",
                                       headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

final class RoutineRunCallsTests: XCTestCase {
    func testCancelSeenAndSeenAllHitTheDesktopRoutes() async throws {
        RunCallStub.requests = []
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [RunCallStub.self]
        let session = URLSession(configuration: configuration)
        let client = CompanionClient(connection: Connection(name: "Mac", host: "127.0.0.1", port: 8810), token: "t", session: session)
        let cancelled = try await client.cancelRoutineRun(id: "run-1")
        XCTAssertEqual(cancelled.status, "cancelled")
        _ = try await client.markRoutineRunSeen(id: "run-1")
        let all = try await client.markAllRoutineRunsSeen()
        XCTAssertEqual(all.ids, ["run-1"])
        XCTAssertEqual(all.count, 1)
        XCTAssertEqual(all.seenAt, 2)
        XCTAssertEqual(RunCallStub.requests.map { "\($0.httpMethod ?? "") \($0.url?.path ?? "")" }, [
            "POST /api/routine-runs/run-1/cancel", "POST /api/routine-runs/run-1/seen", "POST /api/routine-runs/seen-all",
        ])
    }
}

final class RoutineRunsSeenTests: XCTestCase {
    private func run(_ id: String, seenAt: Double? = nil) -> RoutineRun {
        let json = #"{"id":"\#(id)","routineId":"r","routineName":"N","botId":"b","runOn":"maus","scheduledFor":1,"status":"failed","manual":false,"createdAt":1\#(seenAt.map { ",\"seenAt\":\($0)" } ?? "")}"#
        return try! JSONDecoder().decode(RoutineRun.self, from: Data(json.utf8))
    }

    func testStampingMarksOnlyTheNamedRuns() {
        let runs = [run("a"), run("b"), run("c", seenAt: 1)]
        let stamped = RoutineRunLog.stamping(runs, with: RoutineRunsSeen(ids: ["a", "c"], count: 2, seenAt: 5))
        XCTAssertEqual(stamped.map(\.seenAt), [5, nil, 1])
    }

    func testDecodesAnAnswerWithoutIds() throws {
        let seen = try JSONDecoder().decode(RoutineRunsSeen.self, from: Data(#"{"runs":[]}"#.utf8))
        XCTAssertEqual(seen.ids, [])
        XCTAssertEqual(seen.count, 0)
    }
}
