import XCTest
@testable import CompanionCore

final class PagePreviewTests: XCTestCase {
    func testOnlyTheServersOwnPreviewPathIsFramed() {
        XCTAssertEqual(PagePreview.src("/pages/preview/abcdefgh/2"), "/pages/preview/abcdefgh/2")
        XCTAssertEqual(PagePreview.src("/pages/preview/abcdefgh/2?annotate=1"), "/pages/preview/abcdefgh/2")
        for bad in [
            "https://evil.example/pages/preview/abcdefgh/2",
            "//evil.example/x",
            "javascript:alert(1)",
            "/pages/preview/../api/config",
            "/pages/frame/abcdefgh/2",
            "/pages/preview/short/2",
            "",
        ] {
            XCTAssertNil(PagePreview.src(bad), bad)
        }
    }

    func testNavigationStaysOnTheApiOrigin() throws {
        let base = try XCTUnwrap(URL(string: "https://bot.example:8799"))
        let preview = try XCTUnwrap(URL(string: "https://bot.example:8799/pages/preview/abcdefgh/2"))
        let frame = try XCTUnwrap(URL(string: "https://bot.example:8799/pages/preview-frame/abcdefgh/2"))
        XCTAssertTrue(PagePreview.allows(preview, apiBase: base))
        XCTAssertTrue(PagePreview.allows(frame, apiBase: base))
        let other = try XCTUnwrap(URL(string: "https://evil.example/pages/preview/abcdefgh/2"))
        let climb = try XCTUnwrap(URL(string: "https://bot.example:8799/pages/preview/abcdefgh/2/../../api/config"))
        let script = try XCTUnwrap(URL(string: "javascript:alert(1)"))
        XCTAssertFalse(PagePreview.allows(other, apiBase: base))
        XCTAssertFalse(PagePreview.allows(climb, apiBase: base))
        XCTAssertFalse(PagePreview.allows(script, apiBase: base))
    }
}
