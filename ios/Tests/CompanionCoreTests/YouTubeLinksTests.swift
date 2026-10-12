import XCTest
@testable import CompanionCore

final class YouTubeLinksTests: XCTestCase {
    func testVideoIdFromWatchAndShortLinks() {
        XCTAssertEqual(YouTubeLinks.videoId(from: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ")
        XCTAssertEqual(YouTubeLinks.videoId(from: "https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ")
        XCTAssertEqual(YouTubeLinks.videoId(from: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"), "dQw4w9WgXcQ")
    }

    func testIdsInMarkdownParagraph() {
        let ids = YouTubeLinks.ids(in: "Regarde https://youtu.be/dQw4w9WgXcQ et [lien](https://www.youtube.com/watch?v=abcdefghijk)")
        XCTAssertEqual(ids, ["dQw4w9WgXcQ", "abcdefghijk"])
    }

    func testStandaloneParagraph() {
        XCTAssertTrue(YouTubeLinks.isStandaloneParagraph("https://youtu.be/dQw4w9WgXcQ", videoId: "dQw4w9WgXcQ"))
        XCTAssertFalse(YouTubeLinks.isStandaloneParagraph("Voir https://youtu.be/dQw4w9WgXcQ", videoId: "dQw4w9WgXcQ"))
    }
}
