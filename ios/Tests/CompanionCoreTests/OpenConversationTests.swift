import XCTest
@testable import CompanionCore

/// The open conversation leaves the screen when it disappears or the person
/// closes it (bug 2026-10-15: a closed direct conversation stayed open with
/// its composer while the sidebar listed nothing).
final class OpenConversationTests: XCTestCase {
    private func fleet() throws -> Fleet {
        let url = try XCTUnwrap(
            Bundle.module.url(forResource: "bots-paged", withExtension: "json", subdirectory: "Fixtures")
                ?? Bundle.module.url(forResource: "bots-paged", withExtension: "json")
        )
        return try JSONDecoder().decode(Fleet.self, from: try Data(contentsOf: url))
    }

    private func dmWithGreg() throws -> Room {
        var room = try XCTUnwrap(try fleet().groups.first)
        room.id = "dm-greg"; room.dm = nil; room.peopleDm = true; room.humanIds = ["pr_me", "pr_Greg"]
        return room
    }

    func testARoomDeletedWhileOpenIsNoLongerPresent() throws {
        let room = try dmWithGreg()
        var state = CompanionState()
        state.rooms = [room]
        XCTAssertTrue(OpenConversation.present(.room(room), in: state))
        state.apply(.roomDeleted(groupId: room.id))
        XCTAssertFalse(OpenConversation.present(.room(room), in: state))
    }

    func testABotDeletedWhileOpenIsNoLongerPresent() throws {
        let bot = try XCTUnwrap(try fleet().bots.first)
        var state = CompanionState()
        state.bots = [bot]
        XCTAssertTrue(OpenConversation.present(.bot(bot), in: state))
        state.bots = []
        XCTAssertFalse(OpenConversation.present(.bot(bot), in: state))
    }

    func testClosingTheOpenDirectConversationLeavesIt() throws {
        let room = try dmWithGreg()
        let closed = SidebarHidden.default.hiding(.person, "pr_greg", at: 1)
        XCTAssertTrue(OpenConversation.newlyHidden(.room(room), previous: .default, next: closed))
        // already closed (an explicit pick from search): another change keeps it
        let more = closed.hiding(.group, "other", at: 2)
        XCTAssertFalse(OpenConversation.newlyHidden(.room(room), previous: closed, next: more))
        // reopened: not hidden
        XCTAssertFalse(OpenConversation.newlyHidden(.room(room), previous: closed, next: .default))
    }

    func testHidingTheOpenRoomOrBotLeavesIt() throws {
        var room = try dmWithGreg()
        room.peopleDm = nil
        XCTAssertTrue(OpenConversation.newlyHidden(.room(room), previous: .default, next: SidebarHidden.default.hiding(.group, room.id, at: 1)))
        XCTAssertFalse(OpenConversation.newlyHidden(.room(room), previous: .default, next: SidebarHidden.default.hiding(.person, "pr_greg", at: 1)),
                       "a person key only closes a direct conversation")
        let bot = try XCTUnwrap(try fleet().bots.first)
        XCTAssertTrue(OpenConversation.newlyHidden(.bot(bot), previous: .default, next: SidebarHidden.default.hiding(.bot, bot.id, at: 1)))
    }
}
