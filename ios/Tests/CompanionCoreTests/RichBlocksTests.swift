// The rich blocks' rules, case for case from the desktop's
// `src/lib/rich-blocks.test.ts` and `src/lib/code-block.test.ts`, so the two
// clients read the same fences the same way.
import XCTest
@testable import CompanionCore

final class RichBlocksTests: XCTestCase {
    // MARK: fence kinds

    func testFenceKindsMapTheDocumentedLanguagesCaseInsensitively() {
        XCTAssertEqual(RichBlocks.fenceKind("email"), .email)
        XCTAssertEqual(RichBlocks.fenceKind("Mail"), .email)
        XCTAssertEqual(RichBlocks.fenceKind("widget"), .widget)
        XCTAssertEqual(RichBlocks.fenceKind("chart"), .chart)
        XCTAssertEqual(RichBlocks.fenceKind("TSV"), .csv)
        XCTAssertNil(RichBlocks.fenceKind("ts"))
        XCTAssertNil(RichBlocks.fenceKind(""))
    }

    // MARK: email

    private let block = "To: Ana <ana@example.com>, bo@example.com\nCc: \"Lee, Sam\" <sam@example.com>\nSubject: Q3 renewal\n\nHi Ana,\n\n**Thanks** for the call.\n\n- Item one\n"

    func testReadsHeadersRecipientsAndBody() throws {
        let draft = try XCTUnwrap(RichBlocks.parseEmailBlock(block, lang: "email"))
        XCTAssertEqual(draft.to, ["Ana <ana@example.com>", "bo@example.com"])
        XCTAssertEqual(draft.cc, ["\"Lee, Sam\" <sam@example.com>"])
        XCTAssertEqual(draft.subject, "Q3 renewal")
        XCTAssertEqual(draft.body, "Hi Ana,\n\n**Thanks** for the call.\n\n- Item one")
    }

    func testHeaderlessEmailFenceIsABodyOnlyDraft() throws {
        let draft = try XCTUnwrap(RichBlocks.parseEmailBlock("Hello team,\nSee you soon.", lang: "email"))
        XCTAssertEqual(draft.subject, "")
        XCTAssertEqual(draft.to, [])
        XCTAssertEqual(draft.body, "Hello team,\nSee you soon.")
    }

    func testPlainFenceIsAnEmailOnlyWithSubjectAndAnotherHeader() {
        XCTAssertEqual(RichBlocks.parseEmailBlock(block, lang: "text")?.subject, "Q3 renewal")
        XCTAssertEqual(RichBlocks.parseEmailBlock(block, lang: "")?.subject, "Q3 renewal")
        XCTAssertNil(RichBlocks.parseEmailBlock("Subject: only a subject\n\nbody", lang: "text"))
        XCTAssertNil(RichBlocks.parseEmailBlock("To: a@b.c\n\nno subject", lang: ""))
        XCTAssertNil(RichBlocks.parseEmailBlock(block, lang: "python"))
        XCTAssertNil(RichBlocks.parseEmailBlock("const to = 1;\nSubject: x", lang: ""))
    }

    func testSplitsAddressListsOutsideQuotesAndBrackets() {
        XCTAssertEqual(
            RichBlocks.splitAddresses("a@b.c; \"Doe, J\" <j@d.e>,, x@y.z"),
            ["a@b.c", "\"Doe, J\" <j@d.e>", "x@y.z"]
        )
    }

    func testBuildsAMailtoURLWithEncodedFieldsAndBareAddresses() throws {
        let draft = try XCTUnwrap(RichBlocks.parseEmailBlock(block, lang: "email"))
        let (url, bodyIncluded) = RichBlocks.emailMailtoURL(draft)
        XCTAssertTrue(bodyIncluded)
        XCTAssertTrue(url.hasPrefix("mailto:ana@example.com,bo@example.com?"))
        XCTAssertTrue(url.contains("cc=sam@example.com"))
        XCTAssertTrue(url.contains("subject=Q3%20renewal"))
        XCTAssertTrue(url.contains("body=Hi%20Ana%2C%0D%0A%0D%0AThanks%20for%20the%20call."))
        let hostile = RichBlocks.emailMailtoURL(EmailDraft(to: ["a@b.c?bcc=evil@x.y"], subject: "x&bcc=evil@x.y\r\nBcc: e@x.y")).url
        XCTAssertFalse(hostile.contains("\r") || hostile.contains("\n"))
        XCTAssertFalse(hostile.contains("&bcc="))
        XCTAssertTrue(hostile.contains("a@b.c%3Fbcc%3Devil@x.y"))
    }

    func testLeavesALongBodyOutOfTheMailtoURL() {
        let (url, bodyIncluded) = RichBlocks.emailMailtoURL(EmailDraft(to: ["a@b.c"], subject: "Long", body: String(repeating: "word ", count: 2000)))
        XCTAssertFalse(bodyIncluded)
        XCTAssertLessThanOrEqual(url.count, RichBlocks.mailtoMaxLength)
        XCTAssertFalse(url.contains("body="))
    }

    func testStripsMarkdownForThePlainTextCopy() {
        XCTAssertEqual(
            RichBlocks.emailPlainBody("**Bold** and _it_ [site](https://x.y) `code`\n## Head"),
            "Bold and _it_ site (https://x.y) code\nHead"
        )
        XCTAssertEqual(
            RichBlocks.emailPlainText(EmailDraft(to: ["a@b.c"], subject: "Hi", body: "Body")),
            "To: a@b.c\nSubject: Hi\n\nBody"
        )
    }

    // MARK: widgets

    func testWidgetsGetScriptsOnlyAndNoNetwork() {
        XCTAssertEqual(RichBlocks.widgetSandbox, "allow-scripts")
        for directive in ["default-src 'none'", "connect-src 'none'", "frame-src 'none'", "form-action 'none'", "base-uri 'none'", "img-src data: blob:"] {
            XCTAssertTrue(RichBlocks.widgetCSP.contains(directive), directive)
        }
        XCTAssertNil(RichBlocks.widgetCSP.range(of: #"https?:|\*"#, options: .regularExpression))
    }

    func testCSPComesBeforeAnyWidgetByte() throws {
        let doc = RichBlocks.widgetDocument("<meta http-equiv=\"refresh\" content=\"0;url=https://evil.test\"><script>fetch(\"https://evil.test\")</script>", dark: false)
        let csp = try XCTUnwrap(doc.range(of: "Content-Security-Policy"))
        let evil = try XCTUnwrap(doc.range(of: "evil.test"))
        XCTAssertLessThan(csp.lowerBound, evil.lowerBound)
        XCTAssertLessThan(try XCTUnwrap(doc.range(of: "<body>")).lowerBound, evil.lowerBound)
        XCTAssertTrue(doc.contains("color-scheme:light"))
        XCTAssertTrue(RichBlocks.widgetDocument("", dark: true).contains("color-scheme:dark"))
    }

    func testClampsReportedHeightsAndIgnoresGarbage() {
        XCTAssertEqual(RichBlocks.clampWidgetHeight(10.0), RichBlocks.widgetMinHeight)
        XCTAssertEqual(RichBlocks.clampWidgetHeight(1e9), RichBlocks.widgetMaxHeight)
        XCTAssertEqual(RichBlocks.clampWidgetHeight(321.4), 321)
        XCTAssertNil(RichBlocks.clampWidgetHeight("400"))
        XCTAssertNil(RichBlocks.clampWidgetHeight(Double.nan))
    }

    // MARK: tables

    func testParsesCSVWithQuotesTSVAndSemicolons() {
        XCTAssertEqual(
            RichBlocks.parseDelimited("name,note\n\"Doe, J\",\"said \"\"hi\"\"\"\nx,y"),
            [["name", "note"], ["Doe, J", "said \"hi\""], ["x", "y"]]
        )
        XCTAssertEqual(RichBlocks.parseDelimited("a\tb\n1\t2"), [["a", "b"], ["1", "2"]])
        XCTAssertEqual(RichBlocks.parseDelimited("a;b\n1;2"), [["a", "b"], ["1", "2"]])
        XCTAssertEqual(RichBlocks.parseDelimited("a,b\n1,2\n3,4", maxRows: 2).count, 2)
    }

    func testReadsNumbersTheWayPeopleWriteThem() {
        XCTAssertEqual(RichBlocks.parseNumeric("1,234.50"), 1234.5)
        XCTAssertEqual(RichBlocks.parseNumeric("$12"), 12)
        XCTAssertEqual(RichBlocks.parseNumeric("-3.5%"), -3.5)
        XCTAssertEqual(RichBlocks.parseNumeric("(40)"), -40)
        XCTAssertEqual(RichBlocks.parseNumeric("−2"), -2)
        XCTAssertEqual(RichBlocks.parseNumeric("12 CAD"), 12)
        XCTAssertEqual(RichBlocks.parseNumeric("1e3"), 1000)
        XCTAssertNil(RichBlocks.parseNumeric("v1.2"))
        XCTAssertNil(RichBlocks.parseNumeric("2024-01-02"))
        XCTAssertNil(RichBlocks.parseNumeric(""))
    }

    func testFindsNumericColumnsIgnoringEmptyCells() {
        XCTAssertEqual(RichBlocks.numericColumns([["a", "1", ""], ["b", "", "x"], ["c", "3", ""]], width: 3), [false, true, false])
    }

    func testSortsNumbersNumericallyTextNaturallyAndSinksEmpties() {
        let rows = [["b", "10"], ["a", "9"], ["c", ""], ["item 10", "1"], ["item 2", "2"]]
        XCTAssertEqual(RichBlocks.visibleRowOrder(rows, sort: RichSort(column: 1, direction: .asc), numeric: [false, true]), [3, 4, 1, 0, 2])
        XCTAssertEqual(RichBlocks.visibleRowOrder(rows, sort: RichSort(column: 1, direction: .desc), numeric: [false, true]), [0, 1, 4, 3, 2])
        XCTAssertEqual(RichBlocks.visibleRowOrder(rows, sort: RichSort(column: 0, direction: .asc)), [1, 0, 2, 4, 3])
        XCTAssertEqual(RichBlocks.visibleRowOrder(rows, query: "ITEM"), [3, 4])
        XCTAssertEqual(RichBlocks.compareCells("", "a", numeric: false), 1)
    }

    func testHeaderTapCyclesAscendingDescendingOff() {
        XCTAssertEqual(RichBlocks.nextSort(nil, column: 2), RichSort(column: 2, direction: .asc))
        XCTAssertEqual(RichBlocks.nextSort(RichSort(column: 2, direction: .asc), column: 2), RichSort(column: 2, direction: .desc))
        XCTAssertNil(RichBlocks.nextSort(RichSort(column: 2, direction: .desc), column: 2))
        XCTAssertEqual(RichBlocks.nextSort(RichSort(column: 1, direction: .desc), column: 2), RichSort(column: 2, direction: .asc))
    }

    func testCopiesRFC4180CSVAndNeutralizesFormulas() {
        XCTAssertEqual(
            RichBlocks.tableToCSV(header: ["a", "b"], rows: [["x, y", "q\"t"], ["=HYPERLINK(\"http://e\")", "-5"]]),
            "a,b\r\n\"x, y\",\"q\"\"t\"\r\n\"'=HYPERLINK(\"\"http://e\"\")\",-5"
        )
        XCTAssertEqual(RichBlocks.tableToCSV(header: ["n"], rows: [["@SUM(A1)"], ["+1"]]), "n\r\n'@SUM(A1)\r\n+1")
    }

    func testCopiesGFMMarkdownWithAlignmentAndEscapedPipes() {
        XCTAssertEqual(
            RichBlocks.tableToMarkdown(header: ["Name", "Qty"], rows: [["a|b", "3"]], align: [nil, .right]),
            "| Name | Qty |\n| --- | ---: |\n| a\\|b | 3 |"
        )
    }

    // MARK: charts

    private func spec(_ code: String, file: StaticString = #filePath, line: UInt = #line) throws -> ChartSpec {
        switch RichBlocks.parseChartSpec(code) {
        case let .success(spec): return spec
        case let .failure(error):
            XCTFail(error.reason, file: file, line: line)
            throw error
        }
    }

    func testReadsLabelsPlusSeriesJSON() throws {
        let chart = try spec(#"{"type":"line","title":"Load","labels":["a","b"],"series":[{"name":"cpu","data":[1,"2"]}]}"#)
        XCTAssertEqual(chart.type, .line)
        XCTAssertEqual(chart.title, "Load")
        XCTAssertEqual(chart.labels, ["a", "b"])
        XCTAssertEqual(chart.series, [ChartSeries(name: "cpu", values: [1, 2])])
    }

    func testReadsRowObjectJSONAndChartJSDatasets() throws {
        XCTAssertEqual(try spec(#"{"x":"m","y":["a"],"data":[{"m":"Jan","a":3},{"m":"Feb","a":null}]}"#).series[0].values, [3, nil])
        XCTAssertEqual(try spec(#"{"type":"doughnut","labels":["x","y"],"datasets":[{"label":"n","data":[2,3]}]}"#).type, .pie)
        // without x and y the first key is the label column, in document order
        let ordered = try spec(#"{"data":[{"zone":"East","sales":4,"cost":1},{"zone":"West","sales":5,"cost":2}]}"#)
        XCTAssertEqual(ordered.labels, ["East", "West"])
        XCTAssertEqual(ordered.series.map(\.name), ["sales", "cost"])
    }

    func testReadsCSVWithAnOptionalTypeLine() throws {
        let chart = try spec("type: area\nmonth,in,out\nJan,1,2\nFeb,3,4")
        XCTAssertEqual(chart.type, .area)
        XCTAssertEqual(chart.xLabel, "month")
        XCTAssertEqual(chart.series.map(\.name), ["in", "out"])
    }

    func testCapsSeriesAtEightAndFoldsExtraPieSlicesIntoOther() throws {
        let wide = "{\"labels\":[\"a\"],\"series\":[" + (0..<10).map { "{\"name\":\"s\($0)\",\"data\":[\($0 + 1)]}" }.joined(separator: ",") + "]}"
        let chart = try spec(wide)
        XCTAssertEqual(chart.series.count, 8)
        XCTAssertEqual(chart.truncatedSeries, 2)
        let pie = try spec(#"{"type":"pie","labels":["a","b","c","d","e","f","g","h","i","j"],"series":[{"name":"n","data":[1,2,3,4,5,6,7,8,9,10]}]}"#)
        XCTAssertEqual(pie.labels.count, 8)
        XCTAssertEqual(pie.labels.last, "Other")
        XCTAssertEqual(pie.series[0].values.last!, 1 + 2 + 3)
    }

    func testReportsUnusableInputInsteadOfDrawing() {
        for code in ["{not json", #"{"labels":["a"],"series":[{"data":["x"]}]}"#, "", "[1,2]"] {
            if case .success = RichBlocks.parseChartSpec(code) { XCTFail("drew \(code)") }
        }
    }

    func testMakesRoundTicksAndCompactLabels() {
        XCTAssertEqual(RichBlocks.niceTicks(0, 87), [0, 20, 40, 60, 80, 100])
        XCTAssertGreaterThan(RichBlocks.niceTicks(5, 5).count, 1)
        XCTAssertEqual(RichBlocks.formatTick(12_500), "12.5k")
        XCTAssertEqual(RichBlocks.formatTick(3_000_000), "3M")
        XCTAssertEqual(RichBlocks.formatTick(0.25), "0.25")
    }

    func testChartTableIsTheXLabelThenOneColumnPerSeries() throws {
        let chart = try spec("month,in,out\nJan,1,2.5\nFeb,,4")
        let table = RichBlocks.chartTable(chart)
        XCTAssertEqual(table.header, ["month", "in", "out"])
        XCTAssertEqual(table.rows, [["Jan", "1", "2.5"], ["Feb", "", "4"]])
        XCTAssertEqual(table.align, [nil, .right, .right])
    }

    // MARK: markdown extras

    func testParsesGitHubAlertMarkersAndAliases() {
        XCTAssertEqual(RichBlocks.parseCalloutMarker("[!WARNING] Heads up")?.kind, .warning)
        XCTAssertEqual(RichBlocks.parseCalloutMarker("[!WARNING] Heads up")?.title, "Heads up")
        XCTAssertEqual(RichBlocks.parseCalloutMarker("[!note]\nbody")?.kind, .note)
        XCTAssertEqual(RichBlocks.parseCalloutMarker("[!note]\nbody")?.title, "")
        XCTAssertEqual(RichBlocks.parseCalloutMarker("[!danger]")?.kind, .caution)
        XCTAssertNil(RichBlocks.parseCalloutMarker("[!UNKNOWN]"))
        XCTAssertNil(RichBlocks.parseCalloutMarker("text [!NOTE]"))
    }

    func testSlugsHeadingsInAnyScript() {
        XCTAssertEqual(RichBlocks.headingSlug("Set up: the *fast* way!"), "set-up-the-fast-way")
        XCTAssertEqual(RichBlocks.headingSlug("مرحبا بالعالم"), "مرحبا-بالعالم")
        XCTAssertEqual(RichBlocks.headingSlug("!!!"), "section")
    }

    func testFindsAFenceTheMessageHasNotClosedYet() {
        XCTAssertEqual(RichBlocks.unclosedFenceOffset("a\n```js\nx\n```\nb"), -1)
        let text = "intro\n```widget\n<div>"
        XCTAssertEqual(RichBlocks.unclosedFenceOffset(text), 6)
        XCTAssertEqual(RichBlocks.unclosedFenceOffset("~~~\nx\n~~~\n````chart\n{"), 10)
    }

    func testWidensBubblesForTablesAndRichFencesOnly() {
        XCTAssertTrue(RichBlocks.prefersWideBubble("| a | b |\n| --- | --- |\n| 1 | 2 |"))
        XCTAssertTrue(RichBlocks.prefersWideBubble("```chart\n{}\n```"))
        XCTAssertFalse(RichBlocks.prefersWideBubble("```js\nx\n```\nplain prose"))
    }

    func testAcceptsRasterDataURLsOnly() {
        XCTAssertTrue(RichBlocks.isInlineRasterDataURL("data:image/png;base64,iVBORw0KGgo="))
        XCTAssertFalse(RichBlocks.isInlineRasterDataURL("data:image/svg+xml;base64,PHN2Zz4="))
        XCTAssertFalse(RichBlocks.isInlineRasterDataURL("data:text/html;base64,PHNjcmlwdD4="))
        XCTAssertFalse(RichBlocks.isInlineRasterDataURL("data:image/png,<svg onload=alert(1)>"))
        XCTAssertNotNil(RichBlocks.inlineRasterData("data:image/png;base64,iVBORw0KGgo="))
    }

    func testImageSourcesSortedByWhatLoadingThemCosts() {
        XCTAssertTrue(RichBlocks.isExternalImageSource("https://x.y/a.png"))
        XCTAssertTrue(RichBlocks.isExternalImageSource("//x.y/a.png"))
        XCTAssertTrue(RichBlocks.isExternalImageSource("https:\\\\x.y\\a.png"))
        XCTAssertFalse(RichBlocks.isExternalImageSource("/Users/maus/a.png"))
        XCTAssertEqual(RichBlocks.markdownImageName("/a/b/chart%20one.png", alt: ""), "chart one.png")
        XCTAssertEqual(RichBlocks.markdownImageName("/a/b.png", alt: " Sales "), "Sales")
        XCTAssertEqual(RichBlocks.markdownImageOpenURL("//x.y/a.png")?.absoluteString, "https://x.y/a.png")
        XCTAssertNil(RichBlocks.markdownImageOpenURL("/Users/a.png"))
    }

    // MARK: code blocks (src/lib/code-block.test.ts)

    func testCodeBlockLabelsExtensionsAndLineCounts() {
        XCTAssertEqual(CodeBlocks.languageDisplayName("ts"), "TypeScript")
        XCTAssertEqual(CodeBlocks.languageDisplayName("py"), "Python")
        XCTAssertEqual(CodeBlocks.languageDisplayName(""), "Code")
        XCTAssertEqual(CodeBlocks.languageDisplayName(nil), "Code")
        XCTAssertEqual(CodeBlocks.languageDisplayName("zig"), "Zig")
        XCTAssertEqual(CodeBlocks.snippetFileName("python"), "snippet.py")
        XCTAssertEqual(CodeBlocks.snippetFileName("ts"), "snippet.ts")
        XCTAssertEqual(CodeBlocks.snippetFileName(nil), "snippet.txt")
        XCTAssertEqual(CodeBlocks.snippetFileName("Dockerfile"), "dockerfile")
        XCTAssertEqual(CodeBlocks.snippetFileName("a very long language"), "snippet.txt")
        XCTAssertEqual(CodeBlocks.countLines("console.log(1);"), 1)
        XCTAssertEqual(CodeBlocks.countLines("a\nb\n"), 3)
        XCTAssertEqual(CodeBlocks.countLines(""), 0)
    }

    // MARK: turn access (src/lib/perspicax-org.ts turnAccessLabel)

    func testTurnAccessLabelNamesWhoPaid() {
        XCTAssertEqual(DigestAccess(via: "org-key", payer: "organization").label(viewerPrincipalId: "p1"), .orgKey)
        XCTAssertEqual(DigestAccess(via: "server", payer: "organization").label(viewerPrincipalId: nil), .server)
        XCTAssertEqual(DigestAccess(via: "owner-key", payer: "owner", routine: true).label(viewerPrincipalId: "p1"), .ownerCredentials)
        XCTAssertEqual(DigestAccess(via: "subscription", payer: "speaker", payerPrincipalId: "P1").label(viewerPrincipalId: "p1"), .yourSubscription)
        XCTAssertEqual(DigestAccess(via: "subscription", payer: "speaker", payerPrincipalId: "p2").label(viewerPrincipalId: "p1"), .speakerSubscription)
        XCTAssertEqual(DigestAccess(via: "speaker-key", payer: "speaker", payerPrincipalId: "p1").label(viewerPrincipalId: "p1"), .yourKey)
        XCTAssertEqual(DigestAccess(via: "speaker-key", payer: "speaker", payerPrincipalId: "p1").label(viewerPrincipalId: nil), .speakerKey)
    }

    func testDigestMessagesDecodeTheirAccess() throws {
        let json = #"{"id":"d1","role":"bot","kind":"digest","at":1,"text":"[digest] · tools: shell ×1","digest":{"turnId":"t","botId":"b","threadId":"th","at":1,"durationMs":5,"tools":[],"memory":[],"reply":"","hookCoverage":"full","access":{"via":"subscription","payer":"speaker","payerPrincipalId":"p1"}}}"#
        let message = try JSONDecoder().decode(Message.self, from: Data(json.utf8))
        XCTAssertEqual(message.digest?.access?.via, "subscription")
        XCTAssertEqual(message.digest?.access?.payerPrincipalId, "p1")
    }

    /// Paid-with stays visible when tool chips are hidden, and keeps a
    /// digest that touched nothing.
    func testTurnAccessKeepsTheDigestRowWhenChipsAreHidden() throws {
        let paid = try JSONDecoder().decode(Message.self, from: Data(#"{"id":"d1","role":"bot","kind":"digest","at":1,"text":"[digest] · no tool calls","digest":{"access":{"via":"org-key","payer":"organization"}}}"#.utf8))
        let plain = try JSONDecoder().decode(Message.self, from: Data(#"{"id":"d2","role":"bot","kind":"digest","at":2,"text":"[digest] · tools: shell ×1"}"#.utf8))
        let rows = transcriptRows([paid, plain], detail: .hidden)
        XCTAssertEqual(rows.map(\.id), ["d1"])
        XCTAssertEqual(transcriptRows([paid, plain], detail: .full).map(\.id), ["d1", "d2"])
    }
}
