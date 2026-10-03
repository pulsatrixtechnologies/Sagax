// The block kinds WP14 adds to the splitter: GitHub alerts, footnotes and
// pictures, each drawn by MarkdownText the way the desktop's ChatMarkdown
// draws them (remarkCallouts, GFM footnotes, MarkdownImagePreview).
import XCTest
@testable import CompanionCore

final class MarkdownRichTests: XCTestCase {
    func testAlertMarkerTurnsTheQuoteIntoACallout() {
        XCTAssertEqual(
            Markdown.blocks("> [!WARNING] Heads up\n> First line\n> second line\n\nAfter"),
            [.callout(kind: .warning, title: "Heads up", text: "First line\nsecond line"), .paragraph("After")]
        )
        XCTAssertEqual(Markdown.blocks("> [!tip]\n> Body"), [.callout(kind: .tip, title: "", text: "Body")])
        XCTAssertEqual(Markdown.blocks("> [!danger]"), [.callout(kind: .caution, title: "", text: "")])
    }

    func testAnOrdinaryQuoteIsUnchanged() {
        XCTAssertEqual(Markdown.blocks("> plain\n> quote"), [.quote("plain"), .quote("quote")])
        XCTAssertEqual(Markdown.blocks("> text [!NOTE]"), [.quote("text [!NOTE]")])
    }

    func testFootnotesAreNumberedByFirstReferenceAndDrawnLast() {
        let blocks = Markdown.blocks("Claim[^b] and other[^a].\n\n[^a]: Source A.\n[^b]: Source B\n    continued.\n[^unused]: Never cited.")
        XCTAssertEqual(blocks, [
            .paragraph("Claim[1](sagax-footnote:1) and other[2](sagax-footnote:2)."),
            .footnotes([MarkdownFootnote(number: 1, text: "Source B continued."), MarkdownFootnote(number: 2, text: "Source A.")]),
        ])
    }

    func testAFootnoteReferenceWithoutADefinitionStaysText() {
        XCTAssertEqual(Markdown.blocks("Only[^x] text"), [.paragraph("Only[^x] text")])
        XCTAssertEqual(Markdown.blocks("Code `[^a]` and[^a]\n\n[^a]: note"), [
            .paragraph("Code `[^a]` and[1](sagax-footnote:1)"),
            .footnotes([MarkdownFootnote(number: 1, text: "note")]),
        ])
    }

    func testPicturesBecomeTheirOwnBlocks() {
        XCTAssertEqual(Markdown.blocks("![Chart](/Users/maus/chart.png)"), [
            .image(MarkdownImage(alt: "Chart", source: "/Users/maus/chart.png")),
        ])
        XCTAssertEqual(Markdown.blocks("Here: ![a](https://x.y/a.png \"t\") and then\nmore."), [
            .paragraph("Here:"),
            .image(MarkdownImage(alt: "a", source: "https://x.y/a.png")),
            .paragraph("and then more."),
        ])
        XCTAssertEqual(Markdown.blocks("[![logo](/a/logo.png)](https://example.com)"), [
            .image(MarkdownImage(alt: "logo", source: "/a/logo.png", link: "https://example.com")),
        ])
        // a link is not a picture
        XCTAssertEqual(Markdown.blocks("see [a](b) ok"), [.paragraph("see [a](b) ok")])
    }

    func testTablesRememberWhichAlignmentsWereWritten() {
        guard case let .table(table) = Markdown.blocks("| a | b | c |\n| --- | ---: | :-- |\n| 1 | 2 | 3 |").first else {
            return XCTFail("not a table")
        }
        XCTAssertEqual(table.declared, [false, true, true])
        XCTAssertFalse(table.isDeclared(0))
        XCTAssertTrue(table.isDeclared(1))
    }

    func testFencesKeepTheirLanguageForTheRichRenderers() {
        XCTAssertEqual(Markdown.blocks("```chart\n{}\n```"), [.code(language: "chart", text: "{}")])
        XCTAssertEqual(Markdown.blocks("```mermaid\ngraph TD\n```"), [.code(language: "mermaid", text: "graph TD")])
    }
}
