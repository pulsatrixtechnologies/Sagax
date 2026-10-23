import XCTest
@testable import CompanionCore

/// Pin/unpin in the sidebar. Same storage as Electron: `PATCH /api/bots/:id`
/// `{ pinned }`. A trailing swipe reveals Pin like the reference design.
final class SidebarPinningTests: XCTestCase {
    func testPinActionIsNotDrawnAtRest() {
        XCTAssertFalse(SidebarBotPinning.actionVisible(offset: 0))
        XCTAssertEqual(SidebarBotPinning.actionWidth(offset: 0), 0)
        XCTAssertTrue(SidebarBotPinning.actionVisible(offset: -30))
        XCTAssertEqual(SidebarBotPinning.actionWidth(offset: -30), 30)
        XCTAssertEqual(SidebarBotPinning.actionWidth(offset: -500), SidebarBotPinning.revealDistance)
    }

    func testAShownBotIsPinnedOnlyWhenPinnedIsTrue() throws {
        XCTAssertTrue(SidebarBotPinning.isPinned(try bot(pinned: true)))
        XCTAssertFalse(SidebarBotPinning.isPinned(try bot(pinned: false)))
        XCTAssertFalse(SidebarBotPinning.isPinned(try bot(pinned: nil)))
        XCTAssertTrue(SidebarBotPinning.isPinned(try bot(pinned: true, primary: true)))
    }

    func testATrailingSwipeRevealsPinAndAVerticalDragDoesNot() {
        XCTAssertTrue(SidebarBotPinning.swipeRevealsAction(horizontal: -48, vertical: 4))
        XCTAssertFalse(SidebarBotPinning.swipeRevealsAction(horizontal: -20, vertical: 4))
        XCTAssertFalse(SidebarBotPinning.swipeRevealsAction(horizontal: -48, vertical: 60))
        XCTAssertFalse(SidebarBotPinning.swipeRevealsAction(horizontal: 48, vertical: 0))
        XCTAssertEqual(SidebarBotPinning.clampedOffset(-200), -SidebarBotPinning.revealDistance)
        XCTAssertEqual(SidebarBotPinning.clampedOffset(20), 0)
    }

    private func bot(pinned: Bool?, primary: Bool = false) throws -> Bot {
        var json: [String: Any] = [
            "id": "ara", "threadId": "t-ara", "name": "Ara", "title": "", "description": "",
            "notifications": true, "color": "green", "unread": false,
            "modelSelection": ["instanceId": "claude", "model": "m"], "createdAt": 1,
            "chiefOfStaff": primary,
        ]
        if let pinned { json["pinned"] = pinned }
        return try JSONDecoder().decode(Bot.self, from: JSONSerialization.data(withJSONObject: json))
    }
}
