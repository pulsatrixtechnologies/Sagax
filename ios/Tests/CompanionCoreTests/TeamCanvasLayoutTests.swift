import XCTest
@testable import CompanionCore

final class TeamCanvasLayoutTests: XCTestCase {
    private func bot(_ id: String, chief: Bool = false) -> Bot {
        var bot = Bot(id: id, threadId: "t-\(id)", name: id, title: "", description: "", notifications: true, color: "blue",
                      unread: false, modelSelection: ModelSelection(instanceId: "i", model: "m"), createdAt: 0)
        bot.chiefOfStaff = chief
        return bot
    }

    func testSizesFollowTeamCanvas() {
        let flat = TeamMapSection(key: "a", name: "A", chiefs: [], members: [bot("1"), bot("2")])
        XCTAssertEqual(TeamCanvasLayout.size(flat).width, 276)
        XCTAssertEqual(TeamCanvasLayout.size(flat).height, 64 + 20 + 2 * 142 - 16)
        let tiered = TeamMapSection(key: "b", name: "B", chiefs: [bot("c", chief: true)], members: [bot("3"), bot("4"), bot("5")])
        XCTAssertEqual(TeamCanvasLayout.size(tiered).width, 236 * 2 + 40 + 40)
        XCTAssertEqual(TeamCanvasLayout.size(tiered).height, 64 + 20 + 3 * 142 - 16)
        let empty = TeamMapSection(key: "e", name: "E", chiefs: [], members: [])
        XCTAssertEqual(TeamCanvasLayout.size(empty).height, 64 + 20 + 126)
    }

    func testTwoColumnsAndFit() {
        let sections = (0..<3).map { TeamMapSection(key: "\($0)", name: "\($0)", chiefs: [], members: [bot("b\($0)")]) }
        let tiles = TeamCanvasLayout.layout(sections)
        XCTAssertEqual(tiles.map(\.x), [40, 40 + 276 + 56, 40])
        XCTAssertEqual(tiles[2].y, 40 + 210 + 56)
        let view = TeamCanvasLayout.fit(tiles, width: 1086, height: 900)
        XCTAssertEqual(view.scale, 1)
        let small = TeamCanvasLayout.fit(tiles, width: 200, height: 200)
        XCTAssertEqual(small.scale, 0.3, accuracy: 0.0001)
        let zoomed = TeamCanvasLayout.zoom(TeamCanvasLayout.View(x: 0, y: 0, scale: 1), to: 9, at: (100, 100))
        XCTAssertEqual(zoomed.scale, 1.5)
        XCTAssertEqual(zoomed.x, -50)
    }
}
