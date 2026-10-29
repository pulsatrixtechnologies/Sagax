// One error per bot and cause in a thread (FailureDedup, desktop
// shared/failure-dedup.ts `repeatedFailureIds`).
import XCTest
@testable import CompanionCore

final class FailureDedupTests: XCTestCase {
    private func failed(_ id: String, _ cause: String, bot: String? = nil) -> Message {
        var message = Message(id: id, role: .bot, kind: .activity, at: 0)
        message.tool = ToolActivity(name: "error: \(cause)", ok: false)
        if let bot { message.from = Sender(botId: bot, name: bot, color: "blue") }
        return message
    }

    private func access(_ id: String, reason: String = "no_access", engine: String = "Claude", bot: String = "ada") -> Message {
        var message = Message(id: id, role: .bot, kind: .access, at: 0)
        message.access = AccessCard(reason: reason, engine: engine, botId: bot, ownerPrincipalId: "owner")
        return message
    }

    private func reply(_ id: String, bot: String? = nil) -> Message {
        var message = Message(id: id, role: .bot, kind: .text, at: 0)
        message.text = "hello"
        if let bot { message.from = Sender(botId: bot, name: bot, color: "blue") }
        return message
    }

    private func user(_ id: String) -> Message {
        var message = Message(id: id, role: .user, kind: .text, at: 0)
        message.text = "again"
        return message
    }

    func testRepeatHiddenLastKept() {
        let messages = [
            user("u1"), failed("e1", "The local model is not responding."),
            user("u2"), failed("e2", "The local model   is not\nresponding."),
            user("u3"), failed("e3", "The local model is not responding."),
        ]
        XCTAssertEqual(FailureDedup.repeatedIds(messages, threadBotId: "ada"), ["e1", "e2"])
    }

    func testAccessCardRepeatHidden() {
        let messages = [access("a1"), user("u1"), access("a2")]
        XCTAssertEqual(FailureDedup.repeatedIds(messages, threadBotId: "ada"), ["a1"])
    }

    func testReplyInBetweenResets() {
        let messages = [
            failed("e1", "Offline."), access("a1"),
            reply("r1"),
            failed("e2", "Offline."), access("a2"),
        ]
        XCTAssertEqual(FailureDedup.repeatedIds(messages, threadBotId: "ada"), [])
    }

    func testAnotherBotsReplyDoesNotReset() {
        let messages = [
            failed("e1", "Offline.", bot: "ada"),
            reply("r1", bot: "grace"),
            failed("e2", "Offline.", bot: "ada"),
        ]
        XCTAssertEqual(FailureDedup.repeatedIds(messages), ["e1"])
    }

    func testDifferentBotsAndCausesKept() {
        let messages = [
            failed("e1", "Offline.", bot: "ada"),
            failed("e2", "Offline.", bot: "grace"),
            failed("e3", "Rate limited.", bot: "ada"),
            access("a1", engine: "Claude"),
            access("a2", engine: "Codex"),
            access("a3", reason: "key_refused", engine: "Claude"),
        ]
        XCTAssertEqual(FailureDedup.repeatedIds(messages, threadBotId: "ada"), [])
    }

    func testThreadBotStandsInForAMissingSender() {
        let messages = [failed("e1", "Offline."), failed("e2", "Offline.", bot: "ada")]
        XCTAssertEqual(FailureDedup.repeatedIds(messages, threadBotId: "ada"), ["e1"])
    }

    func testOnlyFailedErrorRowsCount() {
        var ok = Message(id: "t1", role: .bot, kind: .activity, at: 0)
        ok.tool = ToolActivity(name: "error: Offline.", ok: true)
        var tool = Message(id: "t2", role: .bot, kind: .activity, at: 0)
        tool.tool = ToolActivity(name: "run_command", ok: false)
        XCTAssertNil(FailureDedup.key(ok))
        XCTAssertNil(FailureDedup.key(tool))
        XCTAssertNil(FailureDedup.key(user("u1")))
        XCTAssertEqual(FailureDedup.repeatedIds([ok, ok, tool, tool]), [])
    }

    func testTranscriptDrawsOnlyTheLastRepeat() {
        let messages = [
            user("u1"), failed("e1", "Offline."),
            user("u2"), failed("e2", "Offline."),
        ]
        let ids = transcriptRows(messages, detail: .full, threadBotId: "ada").compactMap { row -> String? in
            if case let .message(message) = row { return message.id }
            return nil
        }
        XCTAssertEqual(ids, ["u1", "u2", "e2"])
    }

    // A turn the engine flagged after it answered stored its reply as the
    // cause: that row is never drawn, the reply with its table is the answer.
    func testFailedRowRepeatingTheReplyIsHidden() {
        let table = "Everyone answered. Five bots synced their rules:\n\n| Bot | Status |\n|---|---|\n| Alpha | ok |\n| Beta | ok |"
        var answer = Message(id: "r1", role: .bot, kind: .text, at: 0)
        answer.text = table
        XCTAssertEqual(FailureDedup.repeatedIds([user("u1"), answer, failed("e1", table)], threadBotId: "ada"), ["e1"])
        let account = String(table.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ").prefix(90)) + "… No tool calls were seen before it stopped."
        XCTAssertEqual(FailureDedup.repeatedIds([user("u1"), answer, failed("e2", account)], threadBotId: "ada"), ["e2"])
    }

    func testRealFailureWithoutReplyKeepsItsCard() {
        let messages = [user("u1"), reply("r1"), user("u2"), failed("e1", "Claude is overloaded right now. Try again in a few minutes.")]
        XCTAssertTrue(FailureDedup.repeatedIds(messages, threadBotId: "ada").isEmpty)
    }
}
