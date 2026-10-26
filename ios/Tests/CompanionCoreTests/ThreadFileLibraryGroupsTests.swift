// The Library tab's grouping of a conversation's files: pinned on top, then
// this week, then older, newest first (`src/lib/library-items.ts`).
import XCTest
@testable import CompanionCore

final class ThreadFileLibraryGroupsTests: XCTestCase {
    private let day = 24.0 * 3_600_000
    private let now = 1_800_000_000_000.0

    private func file(_ id: String, daysAgo: Double, pinned: Bool = false) -> ThreadFile {
        ThreadFile(id: id, source: .written, name: "\(id).md", at: now - daysAgo * day, pinned: pinned)
    }

    func testSplitsTheWeekFromOlderNewestFirst() {
        let groups = ThreadFileRules.libraryGroups([file("c", daysAgo: 12), file("a", daysAgo: 1), file("b", daysAgo: 3)], now: now)
        XCTAssertEqual(groups.pinned, [])
        XCTAssertEqual(groups.thisWeek.map(\.id), ["a", "b"])
        XCTAssertEqual(groups.older.map(\.id), ["c"])
    }

    func testPinnedFilesComeFirstWhateverTheirAgeAndAreNotListedAgain() {
        let groups = ThreadFileRules.libraryGroups([file("a", daysAgo: 1), file("old", daysAgo: 40, pinned: true), file("new", daysAgo: 0.5, pinned: true)], now: now)
        XCTAssertEqual(groups.pinned.map(\.id), ["new", "old"])
        XCTAssertEqual(groups.thisWeek.map(\.id), ["a"])
        XCTAssertEqual(groups.older, [])
    }

    func testTheSevenDayEdgeIsOlderAndNothingIsEmpty() {
        let groups = ThreadFileRules.libraryGroups([file("edge", daysAgo: 7), file("in", daysAgo: 6.99)], now: now)
        XCTAssertEqual(groups.thisWeek.map(\.id), ["in"])
        XCTAssertEqual(groups.older.map(\.id), ["edge"])
        XCTAssertEqual(ThreadFileRules.libraryGroups([], now: now), ThreadFileLibraryGroups(pinned: [], thisWeek: [], older: []))
    }
}
