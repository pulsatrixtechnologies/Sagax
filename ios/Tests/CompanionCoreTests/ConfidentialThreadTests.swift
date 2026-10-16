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

    // MARK: Surfaces outside the chat (security review S5)

    private func hydratedFleet() throws -> CompanionState {
        let url = try XCTUnwrap(Bundle.module.url(forResource: "updates-fleet", withExtension: "json", subdirectory: "Fixtures")
            ?? Bundle.module.url(forResource: "updates-fleet", withExtension: "json"))
        let fleet = try JSONDecoder().decode(Fleet.self, from: try Data(contentsOf: url))
        var state = CompanionState()
        state.hydrate(fleet)
        return state
    }

    /// Marks the thread of the first bot update confidential; returns its id.
    private func confidentialize(_ state: inout CompanionState) throws -> String {
        let update = try XCTUnwrap(state.updates.first { $0.chat.isBot && !$0.line.isEmpty })
        let threadId = update.chat.threadId
        let botIndex = try XCTUnwrap(state.bots.firstIndex { $0.tasks?.contains { $0.threadId == threadId } == true })
        let taskIndex = try XCTUnwrap(state.bots[botIndex].tasks?.firstIndex { $0.threadId == threadId })
        state.bots[botIndex].tasks?[taskIndex].confidential = true
        state.bots[botIndex].tasks?[taskIndex].title = "SECRET-TITLE-123"
        return threadId
    }

    func testWidgetSnapshotLeavesOutAConfidentialThread() throws {
        var state = try hydratedFleet()
        let before = state.updates.count
        let threadId = try confidentialize(&state)
        let secretLine = try XCTUnwrap(state.updates.first { $0.chat.threadId == threadId }?.line)
        XCTAssertTrue(state.isConfidentialThread(threadId))
        XCTAssertTrue(state.updates.first { $0.chat.threadId == threadId }?.isConfidential == true)

        let snapshot = state.widgetSnapshot(connectionID: "computer-1") { _ in "idle" }
        XCTAssertFalse(snapshot.rows.contains { $0.chat.threadId == threadId }, "no row for a confidential thread")
        XCTAssertEqual(snapshot.rows.count, before - 1, "every other update stays")

        // Nothing of it in the file the widget process reads: neither its
        // words nor its title on another row's bot record.
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let written = String(decoding: try encoder.encode(snapshot), as: UTF8.self)
        XCTAssertFalse(written.contains("SECRET-TITLE-123"))
        XCTAssertFalse(written.contains("\"\(threadId)\""), "not even its id")
        if secretLine.count > 8 { XCTAssertFalse(written.contains(secretLine)) }
    }

    func testLiveActivityContentIsRedacted() throws {
        var state = try hydratedFleet()
        let threadId = try confidentialize(&state)
        let update = try XCTUnwrap(state.updates.first { $0.chat.threadId == threadId })
        let text = ConfidentialRedaction.liveActivity(for: update, botName: update.chat.name)
        XCTAssertEqual(text.headline, "Fil confidentiel")
        XCTAssertEqual(text.line, "")
        XCTAssertNil(text.card, "an ask in a confidential thread is answered in the chat only")

        let ordinary = try XCTUnwrap(state.updates.first { !$0.isConfidential && $0.chat.isBot })
        let shown = ConfidentialRedaction.liveActivity(for: ordinary, botName: "Ara")
        XCTAssertTrue(shown.headline.hasPrefix("Ara "))
        XCTAssertEqual(shown.card, ordinary.card)
    }

    func testDeviceNotificationsAndShareSheetCarryOnlyThePlaceholder() throws {
        XCTAssertEqual(ConfidentialRedaction.notificationBody("the secret plan", confidential: true), "Fil confidentiel")
        XCTAssertEqual(ConfidentialRedaction.notificationBody("hello", confidential: false), "hello")
        var live = try bot()
        XCTAssertEqual(ConfidentialRedaction.shareSubtitle(for: live), "Bot · Fil confidentiel")
        live.threadId = "t-2"
        XCTAssertEqual(ConfidentialRedaction.shareSubtitle(for: live), "Bot · Ordinary")
        XCTAssertFalse(live.withoutConfidentialTasks().tasks!.contains { $0.isConfidential })
    }
}

