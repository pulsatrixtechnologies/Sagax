import Foundation
import XCTest
@testable import CompanionCore

/// 2026-10-29 ("we are in a unified chat"): a run's Continue in the
/// conversation opens the bot's one conversation, never the run's own task
/// nor an older version's results thread (desktop
/// `continueRoutineRunInConversation`, src/state/routine-run-open.test.ts).
final class RoutineContinueTests: XCTestCase {
    private func task(_ json: String) throws -> BotTask {
        try JSONDecoder().decode(BotTask.self, from: Data(json.utf8))
    }

    private func run(results: String?) throws -> RoutineRun {
        let field = results.map { #","resultsThreadId":"\#($0)""# } ?? ""
        return try JSONDecoder().decode(RoutineRun.self, from: Data(#"{"id":"run-1","routineId":"r1","routineName":"Drafts","botId":"b","runOn":"maus","scheduledFor":1,"status":"completed","manual":false,"createdAt":1,"threadId":"exec"\#(field)}"#.utf8))
    }

    private func bot() throws -> Bot {
        Bot(id: "b", threadId: "chat", name: "Scout", title: "Researcher",
            description: "", notifications: true, color: "green", unread: false,
            modelSelection: ModelSelection(instanceId: "engine", model: "default"), createdAt: 1,
            tasks: [
                try task(#"{"threadId":"old","title":"","createdAt":1}"#),
                try task(#"{"threadId":"chat","title":"","createdAt":2}"#),
                try task(#"{"threadId":"exec","title":"Drafts · Oct 29","createdAt":3,"routineRunId":"run-1"}"#),
                try task(#"{"threadId":"results","title":"Drafts · Results","createdAt":0,"routineResults":true}"#),
            ])
    }

    func testContinueOpensTheTopicTheReportWentTo() throws {
        let target = RoutineResults.conversationTarget(for: try run(results: "old"), bots: [try bot()])
        XCTAssertEqual(target?.threadId, "old")
    }

    func testAnOldResultsThreadOrTheRunsTaskOpensTheConversation() throws {
        XCTAssertEqual(RoutineResults.conversationTarget(for: try run(results: "results"), bots: [try bot()])?.threadId, "chat")
        XCTAssertEqual(RoutineResults.conversationTarget(for: try run(results: "exec"), bots: [try bot()])?.threadId, "chat")
        XCTAssertEqual(RoutineResults.conversationTarget(for: try run(results: nil), bots: [try bot()])?.threadId, "chat")
    }
}
