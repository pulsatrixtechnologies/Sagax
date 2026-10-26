// The Library tab's model: files and artifacts in one list, pinned on top,
// then this week, then older, newest first (`src/lib/library-items.ts`); the
// artifact reads and pin; the document an artifact runs in.
import XCTest
@testable import CompanionCore

final class LibraryModelTests: XCTestCase {
    private let day = 24.0 * 3_600_000
    private let now = 1_800_000_000_000.0

    private func file(_ id: String, daysAgo: Double, pinned: Bool = false) -> ThreadFile {
        ThreadFile(id: id, source: .written, name: "\(id).md", at: now - daysAgo * day, pinned: pinned)
    }

    private func artifact(_ id: String, daysAgo: Double, favorite: Bool = false) -> BotArtifact {
        BotArtifact(id: id, title: id, favorite: favorite, updatedAt: now - daysAgo * day)
    }

    func testMixesFilesAndArtifactsByPeriodNewestFirst() {
        let groups = LibraryRules.groups(
            files: [file("c", daysAgo: 12), file("a", daysAgo: 1)],
            artifacts: [artifact("art_2", daysAgo: 20), artifact("art_1", daysAgo: 0.5)],
            now: now
        )
        XCTAssertEqual(groups.pinned, [])
        XCTAssertEqual(groups.thisWeek.map(\.id), ["artifact:art_1", "file:a"])
        XCTAssertEqual(groups.older.map(\.id), ["file:c", "artifact:art_2"])
    }

    func testPinnedFilesAndArtifactsComeFirstAndAreNotListedAgain() {
        let groups = LibraryRules.groups(
            files: [file("a", daysAgo: 1), file("old", daysAgo: 40, pinned: true)],
            artifacts: [artifact("art_1", daysAgo: 30, favorite: true)],
            now: now
        )
        XCTAssertEqual(groups.pinned.map(\.id), ["artifact:art_1", "file:old"])
        XCTAssertEqual(groups.thisWeek.map(\.id), ["file:a"])
        XCTAssertEqual(groups.older, [])
    }

    func testTheSevenDayEdgeIsOlderAndNothingIsEmpty() {
        let groups = LibraryRules.groups(files: [file("edge", daysAgo: 7), file("in", daysAgo: 6.99)], artifacts: [], now: now)
        XCTAssertEqual(groups.thisWeek.map(\.id), ["file:in"])
        XCTAssertEqual(groups.older.map(\.id), ["file:edge"])
        XCTAssertTrue(LibraryRules.groups(files: [], artifacts: [], now: now).isEmpty)
    }

    func testArtifactSummaryDecodesAndFlagsAProblem() throws {
        let json = #"{"id":"art_0000001","botId":"bot-1","title":"Queue","favorite":true,"updatedAt":5,"refresh":{"state":"paused","failures":3}}"#
        let item = try JSONDecoder().decode(BotArtifact.self, from: Data(json.utf8))
        XCTAssertEqual(item.title, "Queue")
        XCTAssertTrue(item.favorite)
        XCTAssertTrue(item.needsAttention)
        let bare = try JSONDecoder().decode(BotArtifact.self, from: Data(#"{"id":"art_0000002"}"#.utf8))
        XCTAssertFalse(bare.favorite)
        XCTAssertFalse(bare.needsAttention)
    }

    func testTheOpenedDocumentCarriesItsHtmlAndLastData() {
        let body = #"{"artifact":{"id":"art_0000001","title":"Queue","html":"<p>hi</p>","data":{"at":9,"value":{"open":3}}}}"#
        let document = BotArtifactDocument.parse(Data(body.utf8))
        XCTAssertEqual(document?.html, "<p>hi</p>")
        XCTAssertEqual(document?.dataJSON, #"{"open":3}"#)
        XCTAssertEqual(document?.dataAt, 9)
        XCTAssertNil(BotArtifactDocument.parse(Data(#"{"artifact":{"title":"x"}}"#.utf8)))
        XCTAssertNil(BotArtifactDocument.parse(Data(#"{"artifact":{"html":"x"}}"#.utf8))?.dataJSON)
    }

    func testTheArtifactRunsInTheWidgetSandboxWithItsDataAndNoWayOutOfTheScriptTag() {
        let document = RichBlocks.artifactDocument(html: "<p>x</p>", dataJSON: #"{"a":"</script><b>"}"#, dataAt: 7, dark: true)
        XCTAssertTrue(document.contains("Content-Security-Policy"))
        XCTAssertTrue(document.contains(#"data:{"a":"\u003c/script\u003e\u003cb\u003e"}"#))
        XCTAssertTrue(document.contains("updatedAt:7"))
        XCTAssertTrue(document.contains("<p>x</p>"))
        XCTAssertTrue(RichBlocks.artifactDocument(html: "", dataJSON: nil, dataAt: nil, dark: false).contains("data:null"))
    }
}
