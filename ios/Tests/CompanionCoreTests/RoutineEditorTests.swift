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

    // MARK: Cron editor (cron-editor.ts)

    func testPresetsReadAsMonthlyYearlyOrCustom() {
        XCTAssertEqual(RoutineCronEditor.choice(for: .cron(expression: "0 9 1 * *", timeZone: "UTC")), .monthly)
        XCTAssertEqual(RoutineCronEditor.choice(for: .cron(expression: "30 8 L * *", timeZone: "UTC")), .monthly)
        XCTAssertEqual(RoutineCronEditor.choice(for: .cron(expression: "0 9 15 6 *", timeZone: "UTC")), .yearly)
        XCTAssertEqual(RoutineCronEditor.choice(for: .cron(expression: "2 7 1-7 * 1", timeZone: "UTC")), .cron)
        let draft = RoutineCronEditor.draft(for: .cron(expression: "5 7 L 3 *", timeZone: "Europe/Paris"), at: Date())
        XCTAssertEqual(draft, RoutineCronDraft(expression: "5 7 L 3 *", timeZone: "Europe/Paris", day: "L", month: "3", time: "07:05"))
    }

    func testMonthlyAndYearlyBuildTheirExpression() {
        var draft = RoutineCronDraft(expression: "", timeZone: "UTC", day: "15", month: "6", time: "08:30")
        let after = iso("2026-10-03T12:00:00Z")
        XCTAssertEqual(RoutineCronEditor.value(choice: .monthly, draft: draft, after: after).schedule,
                       .cron(expression: "30 8 15 * *", timeZone: "UTC"))
        let yearly = RoutineCronEditor.value(choice: .yearly, draft: draft, after: after)
        XCTAssertEqual(yearly.schedule, .cron(expression: "30 8 15 6 *", timeZone: "UTC"))
        XCTAssertEqual(isoList(yearly.runs), ["2027-06-15T08:30:00Z", "2028-06-15T08:30:00Z", "2029-06-15T08:30:00Z"])
        draft.expression = "0 9 31 2 *"
        XCTAssertEqual(RoutineCronEditor.value(choice: .cron, draft: draft, after: after).error,
                       "This cron expression has no future runs. Choose dates that exist.")
    }

    func testAnUntouchedCronIsKeptByteForByte() {
        let original = RoutineSchedule.cron(expression: "2  7 1-7 * 1", timeZone: "America/Toronto")
        let value = RoutineCronEditor.value(
            choice: .cron, draft: RoutineCronEditor.draft(for: original, at: Date()), after: Date(), unchanged: original
        )
        XCTAssertEqual(value.schedule, original)
        XCTAssertEqual(value.runs.count, 3)
    }

    // MARK: The schedule form

    func testRecurrenceIsReadFromTheSchedule() {
        let at = iso("2026-10-05T13:00:00Z") // a Monday in Toronto
        let calendar = montreal
        XCTAssertEqual(RoutineScheduleForm.recurrence(for: nil, at: at, calendar: calendar), .none)
        XCTAssertEqual(RoutineScheduleForm.recurrence(for: .daily(time: "09:00", weekdays: [0, 1, 2, 3, 4, 5, 6]), at: at, calendar: calendar), .daily)
        XCTAssertEqual(RoutineScheduleForm.recurrence(for: .daily(time: "09:00", weekdays: [1, 2, 3, 4, 5]), at: at, calendar: calendar), .weekdays)
        XCTAssertEqual(RoutineScheduleForm.recurrence(for: .daily(time: "09:00", weekdays: [1]), at: at, calendar: calendar), .weekly)
        XCTAssertEqual(RoutineScheduleForm.recurrence(for: .daily(time: "09:00", weekdays: [2]), at: at, calendar: calendar), .custom)
        XCTAssertEqual(RoutineScheduleForm.recurrence(for: .cron(expression: "0 9 1 * *", timeZone: "UTC"), at: at, calendar: calendar), .monthly)
        XCTAssertEqual(RoutineScheduleForm.recurrence(for: .cron(expression: "0 9 1 1 *", timeZone: "UTC"), at: at, calendar: calendar), .yearly)
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
        ]
        for schedule in schedules {
            let form = RoutineScheduleForm(schedule: schedule, seedAt: iso("2026-10-05T11:00:00Z"), now: now, calendar: montreal)
            let saved = try form.schedule(savedAt: now)
            XCTAssertTrue(RoutinePatch.sameSchedule(saved, schedule), "\(schedule) became \(saved)")
        }
    }

    func testWeeklyUsesTheStartDay() throws {
        var form = RoutineScheduleForm(schedule: nil, seedAt: iso("2026-10-07T13:00:00Z"), now: iso("2026-10-03T12:00:00Z"), calendar: montreal)
        form.select(.weekly)
        XCTAssertEqual(try form.schedule(savedAt: Date()), .daily(time: "09:00", weekdays: [3]))
        form.select(.custom)
        form.toggleWeekday(3) // the last day stays
        XCTAssertEqual(form.weekdays, [3])
        form.toggleWeekday(5)
        XCTAssertEqual(try form.schedule(savedAt: Date()).weekdays, [3, 5])
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
        let body = request.url?.path.hasSuffix("seen-all") == true ? #"{"runs":[\#(run)]}"# : #"{"run":\#(run)}"#
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
        XCTAssertEqual(all.count, 1)
        XCTAssertEqual(RunCallStub.requests.map { "\($0.httpMethod ?? "") \($0.url?.path ?? "")" }, [
            "POST /api/routine-runs/run-1/cancel", "POST /api/routine-runs/run-1/seen", "POST /api/routine-runs/seen-all",
        ])
    }
}
