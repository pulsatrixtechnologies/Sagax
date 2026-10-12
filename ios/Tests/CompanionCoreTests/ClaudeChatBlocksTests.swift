// Cases copied from `shared/claude-chat-blocks.test.ts` so the phone reads
// Artifact JSON and <antArtifact> tags the same way the desktop does.
import XCTest
@testable import CompanionCore

final class ClaudeChatBlocksTests: XCTestCase {
    func testKeepsHttpsAndLoopbackHttpAndDropsTheRest() {
        XCTAssertTrue(RichBlocks.isSafeHttpUrl("https://claude.ai/code/artifact/abc"))
        XCTAssertTrue(RichBlocks.isSafeHttpUrl("http://localhost:7788/page"))
        XCTAssertFalse(RichBlocks.isSafeHttpUrl("http://example.com/x"))
        XCTAssertFalse(RichBlocks.isSafeHttpUrl("javascript:alert(1)"))
        XCTAssertFalse(RichBlocks.isSafeHttpUrl("https://user:pass@evil.test/"))
        XCTAssertFalse(RichBlocks.isSafeHttpUrl("not a url"))
        XCTAssertFalse(RichBlocks.isSafeHttpUrl("file:///tmp/x.html"))
    }

    func testReadsATitleAndARealURLFromAnArtifactFence() {
        XCTAssertEqual(
            RichBlocks.parseArtifactPage("{\"title\":\"Deck\",\"url\":\"https://claude.ai/code/artifact/1\"}"),
            ArtifactPage(title: "Deck", url: "https://claude.ai/code/artifact/1")
        )
    }

    func testAcceptsATitleOnlyCardAndRefusesHTMLChartsAndFakeURLs() {
        XCTAssertEqual(RichBlocks.parseArtifactPage("{\"title\":\"Local preview\"}"), ArtifactPage(title: "Local preview"))
        XCTAssertNil(RichBlocks.parseArtifactPage("<!DOCTYPE html><p>Hi</p>"))
        XCTAssertNil(RichBlocks.parseArtifactPage("{\"type\":\"bar\",\"title\":\"Tickets\",\"labels\":[\"Mon\"],\"series\":[{\"name\":\"A\",\"data\":[1]}]}"))
        XCTAssertEqual(RichBlocks.parseArtifactPage("{\"title\":\"X\",\"url\":\"javascript:alert(1)\"}"), ArtifactPage(title: "X"))
    }

    func testRoutesHTMLAndSVGToAWidgetMermaidToMermaidMarkdownThroughReactToACodeFence() {
        XCTAssertEqual(RichBlocks.antArtifactToMarkdown("type=\"application/vnd.sagax.cw+json\"", "{\"family\":\"ticket\"}"), "```cw\n{\"family\":\"ticket\"}\n```")
        XCTAssertEqual(RichBlocks.antArtifactToMarkdown("type=\"text/html\" title=\"Hi\"", "<p>x</p>"), "```widget\n<p>x</p>\n```")
        XCTAssertEqual(RichBlocks.antArtifactToMarkdown("type=\"image/svg+xml\"", "<svg></svg>"), "```widget\n<svg></svg>\n```")
        XCTAssertEqual(RichBlocks.antArtifactToMarkdown("type=\"application/vnd.ant.mermaid\"", "graph TD; A-->B"), "```mermaid\ngraph TD; A-->B\n```")
        XCTAssertEqual(RichBlocks.antArtifactToMarkdown("type=\"text/markdown\"", "# Hello"), "# Hello")
        XCTAssertEqual(
            RichBlocks.antArtifactToMarkdown("type=\"application/vnd.ant.react\" language=\"jsx\"", "export default function A(){return <p/>}"),
            "```jsx\nexport default function A(){return <p/>}\n```"
        )
        XCTAssertTrue(RichBlocks.antArtifactToMarkdown("type=\"application/vnd.ant.chart\"", "{\"type\":\"bar\",\"labels\":[\"A\"],\"series\":[{\"name\":\"N\",\"data\":[1]}]}").hasPrefix("```chart\n"))
    }

    func testRewritesACompleteTagAndHidesAnUnclosedOne() {
        XCTAssertTrue(RichBlocks.liftClaudeChatBlocks("See:\n<antArtifact type=\"text/html\" title=\"Box\"><p>Hi</p></antArtifact>\nDone").contains("```widget\n<p>Hi</p>\n```"))
        XCTAssertEqual(RichBlocks.liftClaudeChatBlocks("See:\n<antArtifact type=\"text/html\"><p>partial"), "See:\n")
    }

    func testLeavesTheTagInsideAFencedCodeBlock() {
        let text = "```html\n<antArtifact type=\"text/html\"><p>x</p></antArtifact>\n```"
        XCTAssertEqual(RichBlocks.liftClaudeChatBlocks(text), text)
    }
}
