// Confidential threads ("Fil confidentiel"): the flag decodes, the
// classification banner shows exactly on a confidential thread and has no
// way to be dismissed, the thread menu offers the one-way switch only on an
// ordinary bot thread, and the requests carry what the server expects.
import Foundation
import XCTest
@testable import CompanionCore

final class ConfidentialThreadTests: XCTestCase {
    private static let botJSON = #"""
    {"id":"bot-1","threadId":"t-1","name":"Ara","title":"","description":"","notifications":true,
    "color":"purple","unread":false,"pinned":false,"modelSelection":{"instanceId":"claude","model":"default"},
    "createdAt":1,
    "tasks":[{"threadId":"t-1","title":"Secret","createdAt":1,"confidential":true},
             {"threadId":"t-2","title":"Ordinary","createdAt":2}]}
    """#

    private func bot() throws -> Bot {
        try JSONDecoder().decode(Bot.self, from: Data(Self.botJSON.utf8))
    }

    private func client() -> CompanionClient {
        CompanionClient(connection: Connection(name: "Mac", host: "127.0.0.1", port: 8810), token: "paired-token")
    }

    private func body(_ request: URLRequest) throws -> [String: Any] {
        let data = try XCTUnwrap(request.httpBody)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    func testDecodesTheFlag() throws {
        let tasks = try XCTUnwrap(try bot().tasks)
        XCTAssertTrue(tasks[0].isConfidential)
        XCTAssertEqual(tasks[0].confidential, true)
        XCTAssertFalse(tasks[1].isConfidential, "absent means an ordinary thread")
        XCTAssertNil(tasks[1].confidential)
    }

    func testBannerShowsExactlyOnAConfidentialThread() throws {
        var live = try bot()
        XCTAssertTrue(ConfidentialBanner.shows(for: .bot(live)), "the selected thread t-1 is confidential")
        XCTAssertTrue(ConfidentialBanner.shows(for: live.tasks![0]))
        live.threadId = "t-2"
        XCTAssertFalse(ConfidentialBanner.shows(for: .bot(live)))
        XCTAssertFalse(ConfidentialBanner.shows(for: live.tasks![1]))
        XCTAssertFalse(ConfidentialBanner.shows(for: nil as BotTask?))
    }

    func testBannerIsNeverDismissibleAndReservesItsHeight() {
        XCTAssertFalse(ConfidentialBanner.isDismissible)
        XCTAssertGreaterThan(ConfidentialBanner.height, 0)
        XCTAssertEqual(ConfidentialBanner.accessibilityKey, "Fil confidentiel : ce fil n'est ni mémorisé, ni exporté, ni partagé")
        XCTAssertEqual(ConfidentialBanner.symbol, "lock.fill")
    }

    func testMenuOffersTheOneWaySwitchOnlyOnAnOrdinaryBotThread() throws {
        let tasks = try XCTUnwrap(try bot().tasks)
        let ordinary = ThreadMenuPlan(task: tasks[1], ownerIsBot: true, folders: [], generatedTitles: false, canDelete: true)
        XCTAssertTrue(ordinary.shows(.makeConfidential))
        XCTAssertEqual(ordinary.more.last, .delete, "Delete stays last")
        let confidential = ThreadMenuPlan(task: tasks[0], ownerIsBot: true, folders: [], generatedTitles: false, canDelete: true)
        XCTAssertFalse(confidential.shows(.makeConfidential), "no way back, and nothing to switch on")
        let room = ThreadMenuPlan(task: tasks[1], ownerIsBot: false, folders: [], generatedTitles: false, canDelete: true)
        XCTAssertFalse(room.shows(.makeConfidential), "rooms are never confidential")
    }

    func testMakeConfidentialRequestConfirmsAndNeverSendsFalse() throws {
        let request = try client().makeConfidentialRequest(botId: "bot-1", threadId: "t-2")
        XCTAssertEqual(request.httpMethod, "PATCH")
        XCTAssertEqual(request.url?.path, "/api/bots/bot-1/tasks/t-2")
        let sent = try body(request)
        XCTAssertEqual(sent["confidential"] as? Bool, true)
        XCTAssertEqual(sent["confirmConfidential"] as? Bool, true)
        XCTAssertEqual(sent.count, 2)
        XCTAssertThrowsError(try client().makeConfidentialRequest(botId: "../x", threadId: "t-2"))
    }

    func testCreateRequestCarriesTheChoice() throws {
        let confidential = try body(client().createTaskRequest(botId: "bot-1", folderId: nil, confidential: true))
        XCTAssertEqual(confidential["confidential"] as? Bool, true)
        let ordinaryUnderDefault = try body(client().createTaskRequest(
            botId: "bot-1", folderId: nil,
            confidential: NewThreadChoice.ordinary(orgDefaultConfidential: true).confidential))
        XCTAssertEqual(ordinaryUnderDefault["confidential"] as? Bool, false, "an ordinary thread is asked for explicitly")
        let plain = try body(client().createTaskRequest(
            botId: "bot-1", folderId: nil,
            confidential: NewThreadChoice.ordinary(orgDefaultConfidential: false).confidential))
        XCTAssertNil(plain["confidential"], "no default, nothing said")
        XCTAssertEqual(NewThreadChoice.confidentialThread.confidential, true)
    }

    func testConfigCarriesTheOrganizationDefault() throws {
        let on = try JSONDecoder().decode(ThreadTitleFeature.self, from: Data(#"{"confidentialThreadsByDefault":true}"#.utf8))
        XCTAssertTrue(on.confidentialByDefault)
        let absent = try JSONDecoder().decode(ThreadTitleFeature.self, from: Data("{}".utf8))
        XCTAssertFalse(absent.confidentialByDefault)
    }
}
