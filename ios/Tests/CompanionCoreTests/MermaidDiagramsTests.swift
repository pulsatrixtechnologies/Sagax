import XCTest
@testable import CompanionCore

/// Cases follow `src/lib/diagram-view.test.ts` where the desktop has them.
final class MermaidDiagramsTests: XCTestCase {
    typealias M = MermaidDiagrams

    func testFenceLanguage() {
        XCTAssertTrue(M.isMermaid("mermaid"))
        XCTAssertTrue(M.isMermaid(" Mermaid \n"))
        XCTAssertFalse(M.isMermaid("mmd"))
        XCTAssertFalse(M.isMermaid(nil))
    }

    func testSvgSizeReadsTheViewBoxFirst() {
        let svg = #"<svg id="a" width="100%" style="max-width: 320px;" viewBox="-8 -8 320.5 140" xmlns="http://www.w3.org/2000/svg"><g/></svg>"#
        XCTAssertEqual(M.svgSize(svg), .init(width: 320.5, height: 140))
        XCTAssertEqual(M.svgSize(#"<svg viewBox="0,0,10,20">"#), .init(width: 10, height: 20))
    }

    func testSvgSizeFallsBackToPlainWidthAndHeight() {
        XCTAssertEqual(M.svgSize(#"<svg width="200px" height="80">"#), .init(width: 200, height: 80))
        XCTAssertNil(M.svgSize(#"<svg width="100%" height="80">"#))
        XCTAssertNil(M.svgSize(#"<svg viewBox="0 0 0 10">"#))
        XCTAssertNil(M.svgSize("<div>no svg</div>"))
    }

    func testInlineSizeNeverUpscales() {
        let size = M.inlineSize(natural: .init(width: 200, height: 100), containerWidth: 600, maxHeight: 500)
        XCTAssertEqual(size, .init(width: 200, height: 100, scale: 1, cramped: false))
    }

    func testInlineSizeFitsTheColumnWidth() {
        let size = M.inlineSize(natural: .init(width: 800, height: 400), containerWidth: 400, maxHeight: 500)
        XCTAssertEqual(size.width, 400)
        XCTAssertEqual(size.height, 200)
        XCTAssertEqual(size.scale, 0.5)
        XCTAssertTrue(size.cramped)
    }

    func testInlineSizeRespectsTheHeightCap() {
        let size = M.inlineSize(natural: .init(width: 300, height: 1200), containerWidth: 400, maxHeight: 480)
        XCTAssertEqual(size.height, 480)
        XCTAssertEqual(size.width, 120)
        XCTAssertEqual(size.scale, 0.4)
    }

    func testInlineSizeOfAnEmptyDiagram() {
        XCTAssertEqual(M.inlineSize(natural: .init(width: 0, height: 10), containerWidth: 400, maxHeight: 400).width, 0)
    }

    func testMaxHeightIsSixtyPercentOfTheWindow() {
        XCTAssertEqual(M.inlineMaxHeight(viewportHeight: 1000), 600)
        XCTAssertEqual(M.inlineMaxHeight(viewportHeight: 852), 511)
        XCTAssertEqual(M.inlineMaxHeight(viewportHeight: 200), 200)
        XCTAssertEqual(M.inlineMaxHeight(viewportHeight: nil), 560)
        XCTAssertEqual(M.inlineMaxHeight(viewportHeight: 0), 560)
    }

    func testPagesNeverReachTheNetwork() {
        for scripts in [true, false] {
            let csp = M.csp(scripts: scripts)
            XCTAssertTrue(csp.hasPrefix("default-src 'none';"))
            XCTAssertTrue(csp.contains("connect-src 'none'"))
            XCTAssertFalse(csp.contains("http"))
        }
        XCTAssertTrue(M.csp(scripts: false).contains("script-src 'none'"))
        let display = M.displayPage(svg: "<svg viewBox=\"0 0 1 1\"></svg>", dark: true, zoomable: false)
        XCTAssertTrue(display.contains("script-src 'none'"))
        XCTAssertFalse(display.contains("<script"))
    }

    func testRenderPageCarriesTheSourceAsAString() {
        let code = "graph TD\n  A[\"</script><img src=x>\"] --> B"
        let page = M.renderPage(code: code, dark: false, fontSize: 14)
        XCTAssertFalse(page.contains("</script><img"))
        XCTAssertTrue(page.contains(#"<\/script><img src=x>"#))
        XCTAssertTrue(page.contains(#""securityLevel":"strict""#))
        XCTAssertTrue(page.contains(#""theme":"default""#))
        XCTAssertTrue(M.renderPage(code: "graph TD", dark: true, fontSize: 14).contains(#""theme":"dark""#))
    }

    func testConfigIsValidJSON() throws {
        let json = M.configJSON(dark: true, fontSize: 99)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any])
        XCTAssertEqual(object["securityLevel"] as? String, "strict")
        XCTAssertEqual((object["themeVariables"] as? [String: String])?["fontSize"], "40px")
        XCTAssertEqual((object["flowchart"] as? [String: Bool])?["useMaxWidth"], true)
    }

    func testJsonStringEscapesLineSeparators() throws {
        let encoded = M.jsonString("a\u{2028}b\"c\n")
        XCTAssertEqual(encoded, "\"a\\u2028b\\\"c\\n\"")
    }

    func testOnlyTheFirstLoadIsAllowed() {
        XCTAssertTrue(M.allowsNavigation(to: URL(string: "about:blank"), isInitialLoad: true))
        XCTAssertTrue(M.allowsNavigation(to: nil, isInitialLoad: true))
        XCTAssertFalse(M.allowsNavigation(to: URL(string: "https://example.com"), isInitialLoad: true))
        XCTAssertFalse(M.allowsNavigation(to: URL(string: "about:blank"), isInitialLoad: false))
    }
}
