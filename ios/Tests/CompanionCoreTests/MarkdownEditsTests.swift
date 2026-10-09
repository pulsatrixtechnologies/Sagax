// The desktop's markdown-edits.test.ts, case for case, against the Swift
// port behind the iOS markdown editor.
import XCTest
@testable import CompanionCore

final class MarkdownEditsTests: XCTestCase {
    typealias E = MarkdownEdits

    /// "|" marks the caret, "[" and "]" a selection, as in the desktop tests.
    private func at(_ marked: String) -> E.TextSelection {
        let ns = marked as NSString
        let caret = ns.range(of: "|")
        if caret.location != NSNotFound {
            return E.TextSelection(doc: ns.replacingCharacters(in: caret, with: ""), caret: caret.location)
        }
        let from = ns.range(of: "[").location
        let to = ns.range(of: "]").location - 1
        let doc = marked.replacingOccurrences(of: "[", with: "", options: [], range: marked.range(of: "["))
        return E.TextSelection(doc: doc.replacingOccurrences(of: "]", with: "", options: [], range: doc.range(of: "]")), from: from, to: to)
    }

    private func show(_ state: E.TextSelection?) -> String? {
        guard let state else { return nil }
        let ns = state.doc as NSString
        let head = ns.substring(to: state.from)
        if state.from == state.to { return head + "|" + ns.substring(from: state.from) }
        return head + "[" + ns.substring(with: NSRange(location: state.from, length: state.to - state.from)) + "]" + ns.substring(from: state.to)
    }

    func testFormatPutsBlankLinesAroundHeadingsAndCode() {
        XCTAssertEqual(E.formatMarkdown("Intro\n# Title\nText\n```js\nconst a = 1;\n```\nAfter"),
                       "Intro\n\n# Title\n\nText\n\n```js\nconst a = 1;\n```\n\nAfter")
        XCTAssertEqual(E.formatMarkdown("##   Rules  \n\n* one\n+ two\n- three"), "## Rules\n\n- one\n- two\n- three")
        XCTAssertEqual(E.formatMarkdown("Steps:\n- one\n  more of one\n- two\n  - nested"), "Steps:\n\n- one\n  more of one\n- two\n  - nested")
        XCTAssertEqual(E.formatMarkdown("Year\n2. not a list"), "Year\n2. not a list")
        XCTAssertEqual(E.formatMarkdown("Do this:\n1. first\n2. second"), "Do this:\n\n1. first\n2. second")
    }

    func testFormatTrailingSpacesBlankRunsAndVerbatimBlocks() {
        XCTAssertEqual(E.formatMarkdown("line one  \nline two   \nend\t"), "line one  \nline two  \nend")
        XCTAssertEqual(E.formatMarkdown("para \nnext  \n\nlast  "), "para\nnext\n\nlast")
        XCTAssertEqual(E.formatMarkdown("\n\nA\n\n\n\nB\n\n\n"), "A\n\nB\n")
        XCTAssertEqual(E.formatMarkdown("A\n\n\nB"), "A\n\nB")
        let code = "```\n*  keep   \n\n\n# not a heading\n```"
        XCTAssertEqual(E.formatMarkdown(code), code)
        XCTAssertEqual(E.formatMarkdown("---\nname: x  \n---\n# T"), "---\nname: x  \n---\n\n# T")
        XCTAssertEqual(E.formatMarkdown("A\n\n* * *\n\nB"), "A\n\n* * *\n\nB")
        let once = E.formatMarkdown("# A\ntext\n* x\n* y\n```\ncode\n```\nend  ")
        XCTAssertEqual(E.formatMarkdown(once), once)
    }

    func testContinueList() {
        XCTAssertEqual(show(E.continueList(at("- milk|"))), "- milk\n- |")
        XCTAssertEqual(show(E.continueList(at("1. first|"))), "1. first\n2. |")
        XCTAssertEqual(show(E.continueList(at("9) nine|"))), "9) nine\n10) |")
        XCTAssertEqual(show(E.continueList(at("- [x] done|"))), "- [x] done\n- [ ] |")
        XCTAssertEqual(show(E.continueList(at("> quoted|"))), "> quoted\n> |")
        XCTAssertEqual(show(E.continueList(at("- a\n  - b|"))), "- a\n  - b\n  - |")
        XCTAssertEqual(show(E.continueList(at("- milk| and eggs"))), "- milk\n- |and eggs")
        XCTAssertEqual(show(E.continueList(at("- a\n- |"))), "- a\n|")
        XCTAssertEqual(show(E.continueList(at("- a\n  - |"))), "- a\n- |")
        XCTAssertNil(E.continueList(at("plain|")))
        XCTAssertNil(E.continueList(at("-| a")))
        XCTAssertNil(E.continueList(at("```\n- in code|")))
    }

    func testIndentList() {
        XCTAssertEqual(show(E.indentList(at("- a\n- b|"), direction: 1)), "- a\n  - b|")
        XCTAssertEqual(show(E.indentList(at("1. a\n- b|"), direction: 1)), "1. a\n   - b|")
        XCTAssertEqual(show(E.indentList(at("- a\n  - b|"), direction: -1)), "- a\n- b|")
        XCTAssertNil(E.indentList(at("text|"), direction: 1))
    }

    func testPaste() {
        XCTAssertEqual(E.linkFromPaste(selected: "the docs", pasted: "https://example.com/a"), "[the docs](https://example.com/a)")
        XCTAssertEqual(E.linkFromPaste(selected: "the docs", pasted: " https://example.com/a \n"), "[the docs](https://example.com/a)")
        XCTAssertNil(E.linkFromPaste(selected: "", pasted: "https://example.com"))
        XCTAssertNil(E.linkFromPaste(selected: "docs", pasted: "not a url"))
        XCTAssertNil(E.linkFromPaste(selected: "https://a.example", pasted: "https://b.example"))
        XCTAssertNil(E.linkFromPaste(selected: "two\nlines", pasted: "https://example.com"))
        XCTAssertEqual(E.tableFromTsv("Name\tRole\nAda\tLead\nBob\t\n"), "| Name | Role |\n| --- | --- |\n| Ada | Lead |\n| Bob |  |")
        XCTAssertEqual(E.tableFromTsv("a\tb\tc\nx|y\t1"), "| a | b | c |\n| --- | --- | --- |\n| x\\|y | 1 |  |")
        XCTAssertNil(E.tableFromTsv("one line\twith tab"))
        XCTAssertNil(E.tableFromTsv("a\tb\nno tab here"))
        XCTAssertNil(E.tableFromTsv("plain\ntext"))
    }

    func testToolbarEdits() {
        XCTAssertEqual(show(E.toggleWrap(at("say [hello ]now"), marker: "**", placeholder: "bold")), "say **[hello]** now")
        XCTAssertEqual(show(E.toggleWrap(at("say **[hello]** now"), marker: "**", placeholder: "bold")), "say [hello] now")
        XCTAssertEqual(show(E.toggleWrap(at("x|"), marker: "**", placeholder: "bold")), "x**[bold]**")
        XCTAssertEqual(show(E.toggleCode(at("[a\nb]"), placeholder: "code")), "```\n[a\nb]\n```")
        XCTAssertEqual(E.toggleLinePrefix(at("[one\ntwo]"), kind: .numbered).doc, "1. one\n2. two")
        XCTAssertEqual(E.toggleLinePrefix(at("[- one\n- two]"), kind: .bullet).doc, "one\ntwo")
        XCTAssertEqual(E.toggleLinePrefix(at("[- one\n- two]"), kind: .task).doc, "- [ ] one\n- [ ] two")
        XCTAssertEqual(show(E.toggleLinePrefix(at("item|"), kind: .bullet)), "- item|")
        XCTAssertEqual(E.cycleHeading(at("Title|")).doc, "# Title")
        XCTAssertEqual(E.cycleHeading(at("## Title|")).doc, "### Title")
        XCTAssertEqual(E.cycleHeading(at("### Title|")).doc, "Title")
        XCTAssertEqual(show(E.insertLink(at("see [docs]"), textPlaceholder: "link text")), "see [docs]([https://])")
        XCTAssertEqual(show(E.insertLink(at("[https://x.example]"), textPlaceholder: "link text")), "[[link text]](https://x.example)")
        XCTAssertEqual(E.insertTable(at("Intro|"), column: { "Column \($0)" }).doc, "Intro\n\n| Column 1 | Column 2 |\n| --- | --- |\n|  |  |\n")
        XCTAssertEqual(show(E.insertCodeBlock(at("Intro|"))), "Intro\n\n```\n|\n```\n")
        XCTAssertEqual(E.toggleTask("- [ ] milk", at: 3), "- [x] milk")
        XCTAssertEqual(E.toggleTask("- [x] milk", at: 3), "- [ ] milk")
        XCTAssertNil(E.toggleTask("milk", at: 1))
    }

    func testAutoPairs() {
        XCTAssertEqual(show(E.autoPair(at("a |"), char: "(")), "a (|)")
        XCTAssertEqual(show(E.autoPair(at("a [b]"), char: "[")), "a [[b]]")
        XCTAssertEqual(show(E.autoPair(at("(a|)"), char: ")")), "(a)|")
        XCTAssertEqual(show(E.autoPair(at("say |"), char: "`")), "say `|`")
        XCTAssertNil(E.autoPair(at("|"), char: "*"))
        XCTAssertNil(E.autoPair(at("snake|"), char: "_"))
        XCTAssertEqual(show(E.autoPair(at("very |"), char: "*")), "very *|*")
        XCTAssertEqual(show(E.deletePair(at("(|)"))), "|")
        XCTAssertNil(E.deletePair(at("(a|)")))
    }

    func testCounts() {
        XCTAssertEqual(E.countWords("# Title\n\n- one two\n- **three**"), 4)
        XCTAssertEqual(E.countWords(""), 0)
        XCTAssertEqual(E.countCharacters("ab😀"), 3)
    }

    func testOffsetsAreUTF16SoEmojiDoNotShiftTheCaret() {
        // "😀" is two UTF-16 units: the caret after it is offset 4 in "- 😀|"
        let state = E.TextSelection(doc: "- 😀", caret: 4)
        XCTAssertEqual(E.continueList(state)?.doc, "- 😀\n- ")
        XCTAssertEqual(E.continueList(state)?.from, 7)
    }

    func testMinimalChange() {
        let change = E.minimalChange("hello world", "hello brave world")
        XCTAssertEqual(change.from, 6)
        XCTAssertEqual(change.to, 6)
        XCTAssertEqual(change.insert, "brave ")
        let none = E.minimalChange("abc", "abc")
        XCTAssertEqual(none.from, 3)
        XCTAssertEqual(none.insert, "")
        // an emoji swapped for another shares its high surrogate: the whole pair goes
        let emoji = E.minimalChange("a😀b", "a😃b")
        XCTAssertEqual(emoji.from, 1)
        XCTAssertEqual(emoji.to, 3)
        XCTAssertEqual(emoji.insert, "😃")
        let appended = E.minimalChange("a😀", "a😀x")
        XCTAssertEqual(appended.from, 3)
        XCTAssertEqual(appended.insert, "x")
    }
}

