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
