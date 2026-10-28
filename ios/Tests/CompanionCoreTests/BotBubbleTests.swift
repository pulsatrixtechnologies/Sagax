import XCTest
@testable import CompanionCore

final class BotBubbleTests: XCTestCase {
    func testOffOrMissingKeepsTheSkin() throws {
        let panel = try XCTUnwrap(SkinColor(css: "#141414"))
        XCTAssertNil(BotBubble.paint(enabled: false, botColor: "green", panel: panel))
        XCTAssertNil(BotBubble.paint(enabled: true, botColor: nil, panel: panel))
        XCTAssertNil(BotBubble.paint(enabled: true, botColor: "not-a-color", panel: panel))
    }

    func testOnPaintsAReadableFillFromTheBotColor() throws {
        let panel = try XCTUnwrap(SkinColor(css: "#f6f8fb"))
        let painted = try XCTUnwrap(BotBubble.paint(enabled: true, botColor: "#facc15", panel: panel))
        XCTAssertGreaterThanOrEqual(BotAccent.contrast(painted.fill, panel), 3)
        XCTAssertGreaterThanOrEqual(BotAccent.contrast(painted.ink, painted.fill), 4.5)
        var prefs = SidebarPrefs()
        XCTAssertFalse(prefs.botBubble)
        prefs.setBotBubble(true)
        XCTAssertEqual(prefs.values[BotBubble.key], "1")
        prefs.setBotBubble(false)
        XCTAssertNil(prefs.values[BotBubble.key])
    }
}
