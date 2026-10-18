import Foundation
import XCTest
@testable import CompanionCore

/// Report on a bot's reply (App Store guideline 1.2): who can be reported,
/// and an email that carries only what the person chose.
final class MessageReportTests: XCTestCase {
    private func message(_ json: String) throws -> Message {
        try JSONDecoder().decode(Message.self, from: Data(json.utf8))
    }

    func testOnlyABotsReplyCanBeReported() throws {
        let bots: Set<String> = ["demo-pixel"]
        let isBot: (String) -> Bool = { bots.contains($0) }
        XCTAssertTrue(MessageReport.canReport(try message(#"{"id":"a","role":"bot","kind":"text","at":1,"text":"hi"}"#), isBot: isBot))
        XCTAssertFalse(MessageReport.canReport(try message(#"{"id":"b","role":"user","kind":"text","at":1,"text":"hi"}"#), isBot: isBot), "your own line")
        XCTAssertTrue(MessageReport.canReport(try message(#"{"id":"c","role":"bot","kind":"text","at":1,"text":"hi","from":{"botId":"demo-pixel","name":"Pixel","color":"purple"}}"#), isBot: isBot), "a bot in a room")
        XCTAssertFalse(MessageReport.canReport(try message(#"{"id":"d","role":"bot","kind":"text","at":1,"text":"hi","from":{"botId":"person-sam","name":"Sam","color":"teal"}}"#), isBot: isBot), "a person in a room")
    }

    func testTheEmailCarriesTheIdAndOnlyWhatWasChosen() throws {
        var draft = MessageReport.Draft(messageId: "pixel-2", reason: .misleading, reasonLabel: "Wrong or misleading", note: "  ", includedText: nil, app: "Sagax iOS 0.5.19 (48)", demo: true)
        XCTAssertTrue(draft.body.contains("Message id: pixel-2"))
        XCTAssertTrue(draft.body.contains("[misleading]"))
        XCTAssertTrue(draft.body.contains("(demo)"))
        XCTAssertFalse(draft.body.contains("Note:"), "an empty note is left out")
        XCTAssertFalse(draft.body.contains("Reply:"), "the reply's words only when chosen")

        draft.note = "It invented a date & a + sign"
        draft.includedText = String(repeating: "x", count: 4_000)
        XCTAssertTrue(draft.body.contains("Note:\nIt invented a date & a + sign"))
        XCTAssertTrue(draft.body.contains("Reply:\n" + String(repeating: "x", count: MessageReport.maxIncludedCharacters)))
        XCTAssertFalse(draft.body.contains(String(repeating: "x", count: MessageReport.maxIncludedCharacters + 1)))

        let url = try XCTUnwrap(draft.mailURL)
        XCTAssertEqual(url.scheme, "mailto")
        XCTAssertTrue(url.absoluteString.hasPrefix("mailto:hello@pulsatrix.ca?"))
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        XCTAssertEqual(items.first { $0.name == "subject" }?.value, draft.subject)
        XCTAssertEqual(items.first { $0.name == "body" }?.value, draft.body, "& and + survive the link")
        XCTAssertTrue(draft.plainText.hasPrefix("To: hello@pulsatrix.ca\n"))
    }
}
