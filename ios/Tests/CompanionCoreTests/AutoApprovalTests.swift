// 2026-10-28: an ask answered with no card stays in a row's details, a
// waiting card names the "Ask first" rule that held it, and the level a
// conversation really runs at is the server's, beside the bot's setting.
import XCTest
@testable import CompanionCore

final class AutoApprovalTests: XCTestCase {
    private func card(_ extra: String) throws -> OptionCard {
        try JSONDecoder().decode(OptionCard.self, from: Data(#"{"title":"Approval needed","subtitle":"","options":[],"requestId":"r","tool":"mcp__desk__view_tickets"\#(extra)}"#.utf8))
    }

    private func bot(_ extra: String) throws -> Bot {
        try JSONDecoder().decode(Bot.self, from: Data(#"""
        {"id":"b1","threadId":"t1","name":"Nova","title":"","description":"","notifications":true,"color":"purple","unread":false,"modelSelection":{"instanceId":"e","model":"m"},"createdAt":1,"approvalMode":"ask"\#(extra)}
        """#.utf8))
    }

    func testAnAlwaysAllowOrTheAutomaticReviewIsAQuietReceipt() throws {
        XCTAssertTrue(ApprovalReceiptRules.isQuiet(try card(#","answered":"allow","alwaysAllowed":"mcp:desk__view_tickets""#)))
        XCTAssertTrue(ApprovalReceiptRules.isQuiet(try card(#","answered":"allow","ruleSaved":{"id":"r1","behavior":"allow","description":"View tickets"}"#)))
        XCTAssertTrue(ApprovalReceiptRules.isQuiet(try card(#","answered":"allow","answeredBy":{"via":"auto-review"}"#)))
    }

    func testAPersonsOwnAnswerKeepsItsPill() throws {
        XCTAssertFalse(ApprovalReceiptRules.isQuiet(try card(#","answered":"allow""#)))
        XCTAssertFalse(ApprovalReceiptRules.isQuiet(try card(#","answered":"deny","ruleSaved":{"id":"r1","behavior":"deny","description":"x"}"#)))
        XCTAssertFalse(ApprovalReceiptRules.isQuiet(try card(#","answered":"allow","alwaysAllowed":"mcp:a__b","expired":true"#)))
        XCTAssertFalse(ApprovalReceiptRules.isQuiet(try card(#","answered":"allow","alwaysAllowed":"mcp:a__b","undone":true"#)))
    }

    func testAWaitingCardNamesTheAskFirstRuleThatHeldIt() throws {
        let own = try XCTUnwrap(ApprovalReceiptRules.heldByRule(try card(#","heldRule":{"description":"View tickets"}"#)))
        XCTAssertEqual(own, HeldByRule(org: false, words: "View tickets"))
        let org = try XCTUnwrap(ApprovalReceiptRules.heldByRule(try card(#","customRule":{"id":"orule_1","when":"anything that sends mail","behavior":"ask","botId":null,"outcome":"held","org":true}"#)))
        XCTAssertEqual(org, HeldByRule(org: true, words: "anything that sends mail"))
        XCTAssertNil(ApprovalReceiptRules.heldByRule(try card("")))
        XCTAssertNil(ApprovalReceiptRules.heldByRule(try card(#","customRule":{"id":"c1","when":"x","behavior":"allow","botId":null,"outcome":"approved"}"#)))
    }

    func testAToolRowCarriesWhatAnsweredItsAsk() throws {
        let tool = try JSONDecoder().decode(ToolActivity.self, from: Data(#"{"name":"mcp__desk__view_tickets","ok":true,"autoApproval":{"source":"full-access"}}"#.utf8))
        XCTAssertEqual(tool.autoApproval, ToolAutoApproval(source: "full-access"))
        XCTAssertEqual(AutoApprovalReason.of(source: tool.autoApproval?.source), .full)
        XCTAssertEqual(AutoApprovalReason.of(source: "owner-rule"), .rule)
        XCTAssertEqual(AutoApprovalReason.of(source: "perspicax-read"), .trusted)
        XCTAssertEqual(AutoApprovalReason.of(source: "something-new"), .other)
        let plain = try JSONDecoder().decode(ToolActivity.self, from: Data(#"{"name":"Read","ok":true}"#.utf8))
        XCTAssertNil(plain.autoApproval)
    }

    func testTheBotSettingAndTheConversationLevelAreTheServers() throws {
        let differs = try bot(#","approvalSetting":"full","approvalApplied":{"mode":"ask","reason":"engine"}"#)
        XCTAssertEqual(differs.approvalSettingMode, "full")
        XCTAssertEqual(differs.appliedLevelNote, AppliedApprovalLevel(mode: "ask", reason: "engine"))
        let words = StepWords(locale: Locale(identifier: "en")) { key in
            ["approvalApplied.line": "This conversation runs at {level}: {reason}.", "approvalApplied.level.ask": "Ask for approval",
             "approvalApplied.reason.engine": "an engine change asked again in this conversation"][key]
        }
        XCTAssertEqual(AppliedLevelWords.line(try XCTUnwrap(differs.appliedLevelNote), words: words),
                       "This conversation runs at Ask for approval: an engine change asked again in this conversation.")
        XCTAssertEqual(AppliedLevelWords.reasonKey("member-policy"), "approvalApplied.reason.memberPolicy")
        // an older server: the record's level, and no note
        let older = try bot("")
        XCTAssertEqual(older.approvalSettingMode, "ask")
        XCTAssertNil(older.appliedLevelNote)
        // the open conversation keeps the server's note; another one has none
        XCTAssertEqual(differs.projected(forThread: "t1")?.appliedLevelNote?.mode, "ask")
        var withTask = differs
        withTask.tasks = try JSONDecoder().decode([BotTask].self, from: Data(#"[{"threadId":"t2","title":"Other","createdAt":1}]"#.utf8))
        XCTAssertNil(withTask.projected(forThread: "t2")?.appliedLevelNote)
    }
}
