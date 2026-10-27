// A routine pauses itself after N failed runs in a row (RoutineAutoPause,
// desktop shared/routine-auto-pause.ts).
import XCTest
@testable import CompanionCore

final class RoutineAutoPauseTests: XCTestCase {
    private func routine(_ extra: String = "") throws -> Routine {
        let json = #"{"id":"r1","name":"Pulse","prompt":"Check","botId":"b1","runOn":"maus","enabled":true,"schedule":{"type":"interval","everyMinutes":15,"anchorAt":1},"durationMinutes":30,"nextRunAt":null,"createdAt":1,"updatedAt":1"# + extra + "}"
        return try JSONDecoder().decode(Routine.self, from: Data(json.utf8))
    }

    private func input(_ after: Int?) -> RoutineInput {
        var input = RoutineInput(name: "Pulse", prompt: "Check", botId: "b1", schedule: RoutineSchedule(type: .interval, everyMinutes: 15, anchorAt: 1))
        input.autoPauseAfter = after
        return input
    }

    func testDefaultIsFiveAndTheRoutinesOwnCountWins() throws {
        XCTAssertEqual(RoutineAutoPause.after(try routine()), 5)
        XCTAssertEqual(RoutineAutoPause.after(try routine(#","autoPauseAfter":0"#)), 0)
        XCTAssertEqual(RoutineAutoPause.after(try routine(#","autoPauseAfter":3"#)), 3)
        XCTAssertEqual(RoutineAutoPause.choices(keeping: 5), [0, 1, 2, 3, 5, 10, 20])
        XCTAssertEqual(RoutineAutoPause.choices(keeping: 7), [0, 1, 2, 3, 5, 7, 10, 20])
        XCTAssertEqual(RoutineAutoPause.optionText(0), "Never")
        XCTAssertEqual(RoutineAutoPause.pausedText(5), "Paused after 5 failures in a row")
        XCTAssertEqual(RoutineAutoPause.pausedText(1), "Paused after a failure")
    }

    func testAPausedRoutineAndItsRunDecode() throws {
        let paused = try routine(#","enabled":false,"failureStreak":5,"autoPaused":{"at":1790000000000,"failures":5,"runId":"run-5"}"#
            .replacingOccurrences(of: #","enabled":false"#, with: ""))
        XCTAssertFalse(RoutineAutoPause.isAutoPaused(paused), "still on")
        var off = paused; off.enabled = false
        XCTAssertTrue(RoutineAutoPause.isAutoPaused(off))
        XCTAssertEqual(off.autoPaused?.failures, 5)
        let run = try JSONDecoder().decode(RoutineRun.self, from: Data(#"{"id":"run-5","routineId":"r1","routineName":"Pulse","botId":"b1","runOn":"maus","scheduledFor":1,"status":"failed","manual":false,"createdAt":1,"autoPaused":{"failures":5}}"#.utf8))
        XCTAssertEqual(run.autoPaused?.failures, 5)
    }

    func testTheCardSaysItPausedAndAnOddValueCostsOnlyThatField() throws {
        let card = try JSONDecoder().decode(RoutineRunCard.self, from: Data(#"{"runId":"r","routineId":"rt","routineName":"Pulse","status":"failed","autoPausedAfter":5}"#.utf8))
        XCTAssertEqual(card.autoPausedText, "Paused after 5 failures in a row")
        let odd = try JSONDecoder().decode(RoutineRunCard.self, from: Data(#"{"runId":"r","routineId":"rt","routineName":"Pulse","status":"failed","autoPausedAfter":"x"}"#.utf8))
        XCTAssertNil(odd.autoPausedAfter)
        XCTAssertEqual(odd.status, "failed")
    }

    func testTheEditorSendsTheCountOnlyWhenItChanged() throws {
        let original = try routine()
        XCTAssertNil(RoutinePatch.body(original: original, input: input(5))["autoPauseAfter"])
        XCTAssertNil(RoutinePatch.body(original: original, input: input(nil))["autoPauseAfter"])
        XCTAssertEqual(RoutinePatch.body(original: original, input: input(0))["autoPauseAfter"] as? Int, 0)
        XCTAssertEqual(RoutinePatch.body(original: try routine(#","autoPauseAfter":3"#), input: input(5))["autoPauseAfter"] as? Int, 5)
        XCTAssertNil(RoutinePatch.createBody(input(5))["autoPauseAfter"])
        XCTAssertEqual(RoutinePatch.createBody(input(10))["autoPauseAfter"] as? Int, 10)
    }
}
