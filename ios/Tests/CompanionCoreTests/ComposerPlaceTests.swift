import Foundation
import XCTest
@testable import CompanionCore

final class ComposerPlaceTests: XCTestCase {
    private let client = CompanionClient(connection: Connection(name: "Test", host: "127.0.0.1", port: 8810), token: "t")

    func testApprovalLevelFollowsTheSavedModeThenTheLegacyMirror() {
        XCTAssertEqual(ApprovalLevel.of(approvalMode: "edits", autoApprove: true), .edits)
        XCTAssertEqual(ApprovalLevel.of(approvalMode: nil, autoApprove: true), .auto)
        XCTAssertEqual(ApprovalLevel.of(approvalMode: "someday", autoApprove: nil), .ask)
        XCTAssertEqual(ApprovalLevel.offered, [.ask, .edits, .auto])
    }

    func testEffectivePlacePinsOverTheBotExceptOff() {
        XCTAssertEqual(WorkPlace.effective(botComputer: nil, taskSurface: nil), "auto")
        XCTAssertEqual(WorkPlace.effective(botComputer: "cloud", taskSurface: "vm"), "vm")
        XCTAssertEqual(WorkPlace.effective(botComputer: "off", taskSurface: "vm"), "off")
    }

    func testTaskPatchesCarryOnlyTheirField() throws {
        let mode = try client.updateTaskRequest(botId: "b1", threadId: "t1", body: ["approvalMode": ApprovalLevel.edits.rawValue])
        XCTAssertEqual(mode.httpMethod, "PATCH")
        XCTAssertEqual(mode.url?.path, "/api/bots/b1/tasks/t1")
        let body = try JSONSerialization.jsonObject(with: mode.httpBody ?? Data()) as? [String: Any]
        XCTAssertEqual(body?.count, 1)
        XCTAssertEqual(body?["approvalMode"] as? String, "edits")
        XCTAssertThrowsError(try client.updateTaskRequest(botId: "../x", threadId: "t1", body: [:]))
    }

    func testTaskSurfaceDecodes() throws {
        let task = try JSONDecoder().decode(BotTask.self, from: Data(#"{"threadId":"t","title":"x","createdAt":1,"surface":"vm"}"#.utf8))
        XCTAssertEqual(task.surface, "vm")
    }
}

final class ModelSuggestionsTests: XCTestCase {
    private func option(_ id: String) -> ModelOption {
        try! JSONDecoder().decode(ModelOption.self, from: Data(#"{"id":"\#(id)","label":"Model \#(id)"}"#.utf8))
    }

    func testSuggestedPutsCurrentThenDefaultThenOrderUpToFive() {
        let options = ["a", "b", "c", "d", "e", "f", "g"].map(option)
        XCTAssertEqual(ModelSuggestions.suggested(options, defaultId: "c", currentId: "f").map(\.id), ["f", "c", "a", "b", "d"])
        XCTAssertEqual(ModelSuggestions.suggested(options, defaultId: "a", currentId: nil, limit: 2).map(\.id), ["a", "b"])
    }

    func testFilterMatchesEveryWord() {
        let options = ["sonnet-5", "opus-5"].map(option)
        XCTAssertEqual(ModelSuggestions.filter(options, query: "model opus").map(\.id), ["opus-5"])
        XCTAssertEqual(ModelSuggestions.filter(options, query: " ").count, 2)
    }
}

/// 2026-10-26 (one approval level): each of the four levels says that the
/// bot's rules come first, and Full access that Ask and Deny still hold.
final class ApprovalLevelDetailTests: XCTestCase {
    func testEveryLevelSaysRulesComeFirst() {
        for level in [ApprovalLevel.ask, .edits, .auto, .full] {
            XCTAssertTrue(level.detail.contains("Your rules"), "\(level)")
        }
        XCTAssertTrue(ApprovalLevel.full.detail.contains("\"Deny\" refuses, even here"))
        XCTAssertTrue(ApprovalLevel.ask.detail.contains("\"Allow automatically\" goes without a card"))
        XCTAssertEqual(ApprovalLevel.custom.detail, "Uses permissions defined in config.toml")
    }
}
