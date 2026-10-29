import XCTest
@testable import CompanionCore

/// The default theme of bot content on the phone (2026-10-28): a widget
/// carries the desktop's kit in the skin's colors, a page preview sends the
/// skin's tokens.
final class ContentThemeTests: XCTestCase {
    func testAWidgetCarriesTheKitInTheSkinsColors() {
        let doc = RichBlocks.widgetDocument("<div class=\"card\"></div>", dark: true, tokens: ["--color-ink": "#eef2fb", "--color-panel": "#060f20"])
        XCTAssertTrue(doc.contains("<style id=\"sagax-kit\">"))
        for name in [".card{", ".stat-card{", ".bar-chart{", ".badge-success{", ".list{"] {
            XCTAssertTrue(doc.contains(name), name)
        }
        XCTAssertTrue(doc.contains("--foreground:#eef2fb"))
        XCTAssertTrue(doc.contains("--card:#060f20"))
        XCTAssertFalse(doc.contains("SAGAXTOKEN_"), "every placeholder is filled")
    }

    func testItFollowsLightAndDark() {
        let light = RichBlocks.widgetDocument("", dark: false)
        let dark = RichBlocks.widgetDocument("", dark: true)
        XCTAssertTrue(light.contains("color-scheme:light"))
        XCTAssertTrue(light.contains("--foreground:#161616"))
        XCTAssertTrue(dark.contains("color-scheme:dark"))
        XCTAssertTrue(dark.contains("--foreground:#f5f5f5"))
    }

    func testAnUnsafeTokenNeverReachesTheStyle() {
        let doc = RichBlocks.widgetDocument("", dark: true, tokens: ["--color-ink": "red}</style><script>x()</script>", "--color-panel": "url(https://evil.test)"])
        XCTAssertFalse(doc.contains("evil.test"))
        XCTAssertFalse(doc.contains("x()"))
        XCTAssertTrue(doc.contains("--foreground:#f5f5f5"))
    }

    func testTheSkinTravelsWithThePreviewAddress() throws {
        let skin = try XCTUnwrap(ContentTheme.skinParam(["--color-ink": "#eef2fb", "--code-color-scheme": "dark", "--evil": "x"]))
        XCTAssertNotNil(skin.range(of: #"^[A-Za-z0-9_-]+$"#, options: .regularExpression))
        var b64 = skin.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while b64.count % 4 != 0 { b64 += "=" }
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: try XCTUnwrap(Data(base64Encoded: b64))) as? [String: String])
        XCTAssertEqual(json, ["--color-ink": "#eef2fb", "--code-color-scheme": "dark"])
        XCTAssertEqual(PageViewRules.previewSrc("/pages/preview/abcdefgh/2", bare: true, theme: .dark, y: 3, skin: skin),
                       "/pages/preview/abcdefgh/2?bare=1&theme=dark&skin=\(skin)&y=3")
        // without a theme, no skin
        XCTAssertEqual(PageViewRules.previewSrc("/pages/preview/abcdefgh/2", bare: true, theme: nil, y: nil, skin: skin), "/pages/preview/abcdefgh/2?bare=1")
    }

    func testAPaletteGivesTheDesktopTokens() {
        let tokens = SkinPalette.black.contentTokens
        XCTAssertEqual(tokens["--code-color-scheme"], "dark")
        for name in WidgetKitGenerated.tokenNames where name != "--identity-purple" {
            XCTAssertNotNil(ContentTheme.safeTokenValue(tokens[name]), name)
        }
    }
}
