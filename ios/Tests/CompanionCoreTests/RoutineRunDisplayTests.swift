// The run's words on the phone (2026-10-29), as the desktop says them
// (src/lib/routine-display.ts): a preview without a table's pipes, the
// state in the task sheet's words, how long it took, and the logs' period
// and routine filters (a deleted routine's runs stay, #1567).
import XCTest
@testable import CompanionCore

final class RoutineRunDisplayTests: XCTestCase {
    private func run(_ id: String, _ status: String, routine: String = "r1", bot: String = "b1", createdAt: Double = 1, output: String? = nil) -> RoutineRun {
        RoutineRun(id: id, routineId: routine, routineName: "Routine \(routine)", botId: bot, runOn: "maus",
                   scheduledFor: createdAt, status: status, manual: false, output: output, createdAt: createdAt)
    }

    func testPreviewDropsTablePipesAndMarks() {
        XCTAssertEqual(run("1", "completed", output: "| Area | Open |\n| --- | ---: |\n| Inbox | 4 |").previewLine, "Area · Open")
        XCTAssertEqual(run("2", "completed", output: "\n**Three items** today.").previewLine, "Three items today.")
        XCTAssertNil(run("3", "completed").previewLine)
    }

    func testStatusInTaskSheetWords() {
        XCTAssertEqual(run("1", "missed").activityStatus, .failed)
        XCTAssertEqual(run("2", "cancelled").activityStatus, .stopped)
        XCTAssertEqual(run("3", "completed").activityStatus, .finished)
        XCTAssertEqual(run("4", "waiting").activityStatus, .waiting)
    }

    func testElapsed() {
        var done = run("1", "completed")
        done.startedAt = 1_000
        done.finishedAt = 241_000
        XCTAssertEqual(done.elapsedMs(now: 999_999), 240_000)
        var live = run("2", "running")
        live.startedAt = 1_000
        XCTAssertEqual(live.elapsedMs(now: 61_000), 60_000)
        XCTAssertNil(run("3", "queued").elapsedMs(now: 5))
    }

    func testPeriodAndRoutineChoices() {
        let now = 100 * 86_400_000.0
        let runs = [run("1", "completed", createdAt: now - 3_600_000), run("2", "failed", routine: "gone", bot: "b2", createdAt: now - 10 * 86_400_000)]
        XCTAssertEqual(RoutineRunLog.narrowed(runs, botId: nil, period: .day, now: now).map(\.id), ["1"])
        XCTAssertEqual(RoutineRunLog.narrowed(runs, botId: nil, period: .month, now: now).map(\.id), ["1", "2"])
        XCTAssertEqual(RoutineRunLog.narrowed(runs, botId: "b2", period: .all, now: now).map(\.id), ["2"])
        XCTAssertEqual(RoutineRunLog.routineChoices(runs).map(\.id), ["gone", "r1"])
    }

    func testDecodesCostAndQuiet() throws {
        let json = #"{"id":"x","routineId":"r","routineName":"R","botId":"b","runOn":"maus","scheduledFor":1,"status":"completed","manual":false,"createdAt":1,"cost":0.042,"quiet":true}"#
        let decoded = try JSONDecoder().decode(RoutineRun.self, from: Data(json.utf8))
        XCTAssertEqual(decoded.cost, 0.042)
        XCTAssertEqual(decoded.quiet, true)
    }
}
