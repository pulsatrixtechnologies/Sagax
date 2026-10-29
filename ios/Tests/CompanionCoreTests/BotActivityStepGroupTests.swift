import XCTest
@testable import CompanionCore

/// The task sheet's steps and sub-agents read like the desktop's
/// (src/lib/activity-step-groups.ts, src/components/task/SubagentList.tsx).
final class BotActivityStepGroupTests: XCTestCase {
    private func routine(_ id: String, ok: Bool?, where place: BotActivityStep.Where = .server) -> BotActivityStep {
        BotActivityStep(id: id, name: "mcp__agents__run_routine_action", summary: "Next routine action", ok: ok, where: place)
    }

    func testTheSameStepRepeatedReadsOnceWithACountAndAFailureStaysApart() {
        let steps = (0..<12).map { routine("r\($0)", ok: true) } + [routine("rf", ok: false), routine("r12", ok: true)]
        let groups = BotActivityStepGroup.groups(steps)
        XCTAssertEqual(groups.map(\.count), [12, 1, 1])
        XCTAssertEqual(groups.map(\.phase), [.done, .failed, .done])
        XCTAssertEqual(groups[0].summary, "Next routine action")
    }

    func testARunningStepASubagentOrAnotherPlaceNeverMerges() {
        let steps = [
            routine("a", ok: true), routine("b", ok: nil), routine("c", ok: nil),
            BotActivityStep(id: "s", name: "Agent", ok: true, subagent: .init(description: "draft", prompt: nil, type: nil, result: nil)),
            BotActivityStep(id: "s1", name: "Read", ok: true, parentId: "s"),
            BotActivityStep(id: "s2", name: "Read", ok: true, parentId: "s"),
            routine("d", ok: true, where: .server), routine("e", ok: true, where: .computer),
        ]
        let groups = BotActivityStepGroup.groups(steps)
        XCTAssertEqual(groups.map(\.id), ["a", "b", "c", "s", "d", "e"])
        XCTAssertTrue(groups[3].subagent)
        XCTAssertEqual(groups[3].substeps.map(\.count), [2])
    }

    func testThePlaceIsMarkedOnceThenOnlyWhenItChanges() {
        let steps = [
            BotActivityStep(id: "1", name: "Read", ok: true, where: .server),
            routine("2", ok: true), routine("3", ok: true, where: .computer), routine("4", ok: false, where: .computer),
        ]
        XCTAssertEqual(BotActivityStepGroup.groups(steps).map(\.placeChanged), [true, false, true, false])
    }

    func testTheWaitingSubagentComesFirst() {
        let items = [
            BotActivityItem(id: "1", kind: .subagent, botId: "a", title: "Done", status: .finished, startedAt: 0, updatedAt: 9),
            BotActivityItem(id: "2", kind: .subagent, botId: "b", title: "Running", status: .running, startedAt: 0, updatedAt: 5),
            BotActivityItem(id: "3", kind: .subagent, botId: "c", title: "Waiting", status: .waiting, startedAt: 0, updatedAt: 1),
            BotActivityItem(id: "4", kind: .subagent, botId: "d", title: "Failed", status: .failed, startedAt: 0, updatedAt: 2),
        ]
        XCTAssertEqual(BotActivitySubagents.sorted(items).map(\.id), ["3", "2", "4", "1"])
    }

    /// A conversation's entry is its newest turn (2026-10-29): a retried
    /// request says so, and the thread's own title rides along.
    func testARetriedRequestSaysSoAndKeepsTheThreadTitle() throws {
        let json = #"{"id":"thread:t","kind":"session","botId":"b","title":"Hand the review to the team","threadTitle":"hello","retry":true,"status":"running","startedAt":1}"#
        let item = try JSONDecoder().decode(BotActivityItem.self, from: Data(json.utf8))
        XCTAssertEqual(item.threadTitle, "hello")
        XCTAssertEqual(item.shownTitle(retryWord: "Retry"), "Retry · Hand the review to the team")
        let plain = BotActivityItem(id: "x", botId: "b", title: "list my routines", status: .running, startedAt: 0)
        XCTAssertEqual(plain.shownTitle(retryWord: "Retry"), "list my routines")
    }
}
