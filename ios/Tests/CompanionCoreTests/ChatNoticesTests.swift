// The technical notices the chat never draws (ChatNotices, desktop
// shared/chat-notices.ts). Fixtures/chat-notices.json is the desktop's list;
// shared/chat-notices.test.ts keeps it in step with the TypeScript.
import XCTest
@testable import CompanionCore

final class ChatNoticesTests: XCTestCase {
    private struct Fixture: Decodable {
        let hiddenPrefixes: [String]
        let shown: [String]
        let hidden: [String]
        let visible: [String]
    }

    private func fixture() throws -> Fixture {
        let url = try XCTUnwrap(
            Bundle.module.url(forResource: "chat-notices", withExtension: "json", subdirectory: "Fixtures")
                ?? Bundle.module.url(forResource: "chat-notices", withExtension: "json")
        )
        return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    }

    private func activity(_ id: String, _ name: String, at: Double) -> Message {
        var message = Message(id: id, role: .bot, kind: .activity, at: at)
        message.tool = ToolActivity(name: name, ok: true)
        return message
    }

    private func text(_ id: String, at: Double) -> Message {
        var message = Message(id: id, role: .bot, kind: .text, at: at)
        message.text = "hello"
        return message
    }

    func testRulesAreTheDesktopList() throws {
        let list = try fixture()
        XCTAssertEqual(ChatNotices.hiddenPrefixes, list.hiddenPrefixes)
        XCTAssertEqual(ChatNotices.shown, list.shown)
        for name in list.hidden { XCTAssertTrue(ChatNotices.isTechnical(name), name) }
        for name in list.visible + list.shown { XCTAssertFalse(ChatNotices.isTechnical(name), name) }
    }

    /// No technical notice leaves a row in the chat, at any detail level,
    /// and none becomes a step of the run either.
    func testTechnicalNoticesLeaveNoRow() throws {
        let list = try fixture()
        var messages = [text("before", at: 1)]
        for (index, name) in list.hidden.enumerated() {
            messages.append(activity("n\(index)", name, at: Double(index + 2)))
        }
        messages.append(text("after", at: 100))
        for detail in ActivityDetail.allCases {
            let rows = transcriptRows(messages, detail: detail)
            XCTAssertEqual(rows.map(\.id), ["before", "after"], "\(detail)")
        }
    }

    func testWhatAsksSomethingOfThePersonStays() throws {
        let list = try fixture()
        for (index, name) in list.shown.enumerated() {
            let rows = transcriptRows([activity("s\(index)", name, at: 1)], detail: .hidden)
            XCTAssertEqual(rows.map(\.id), ["s\(index)"], name)
        }
    }

    func testStoppedAndHarnessFoldLeaveNoRow() {
        var fold = Message(id: "fold", role: .bot, kind: .compaction, at: 2)
        fold.compaction = Compaction(summary: "s", tokensBefore: 10, by: "harness")
        var asked = Message(id: "asked", role: .bot, kind: .compaction, at: 3)
        asked.compaction = Compaction(summary: "s", tokensBefore: 10)
        let messages = [text("a", at: 1), fold, activity("stop", "error: turn stopped", at: 4), asked]
        XCTAssertEqual(transcriptRows(messages, detail: .full).map(\.id), ["a", "asked"])
    }

    func testPreviewLooksPastATechnicalNotice() {
        XCTAssertTrue(isHiddenStatusNotice(activity("n", "notice: Workspace: In the cloud", at: 1)))
        XCTAssertFalse(isHiddenStatusNotice(activity("t", "run", at: 1)))
    }

    /// A usage-limit switch is transparent (#1668 / #1698): desktop
    /// `isHiddenStatusActivity` leaves switched and back out of the chat,
    /// including older `recovery:` rows; a wait stays as its own status row.
    func testUsageLimitSwitchLeavesNoRow() {
        func limitRow(_ id: String, _ name: String, _ limit: LimitFailoverLine) -> Message {
            var message = activity(id, name, at: 1)
            message.tool?.limitFailover = limit
            return message
        }
        let switched = LimitFailoverLine(kind: "switched", from: "Claude", to: "Codex", resetsAt: 0)
        let back = LimitFailoverLine(kind: "back", engine: "Claude")
        let waiting = LimitFailoverLine(kind: "waiting", from: "Claude", resetsAt: 0)
        let switchedNotice = limitRow(
            "n1",
            "notice: Limit reached on Claude: continuing on Codex until it resets (around 2:05 PM).",
            switched
        )
        let switchedRecovery = limitRow(
            "r1",
            "recovery: Limit reached on Claude: continuing on Codex until it resets (around 2:05 PM).",
            switched
        )
        let backRecovery = limitRow(
            "r2",
            "recovery: Claude's limit has reset: back on Claude.",
            back
        )
        let waitingRecovery = limitRow(
            "w1",
            "recovery: Limit reached on Claude and no other engine is available: your message will be sent again when it resets (around 2:05 PM).",
            waiting
        )

        XCTAssertTrue(isHiddenStatusNotice(switchedNotice))
        XCTAssertTrue(isHiddenStatusNotice(switchedRecovery))
        XCTAssertTrue(isHiddenStatusNotice(backRecovery))
        XCTAssertFalse(isHiddenStatusNotice(waitingRecovery))
        XCTAssertTrue(isStatusNotice(waitingRecovery))
        XCTAssertFalse(isToolActivityRow(waitingRecovery))

        for detail in ActivityDetail.allCases {
            let rows = transcriptRows([
                text("before", at: 1),
                switchedNotice,
                switchedRecovery,
                backRecovery,
                waitingRecovery,
                text("after", at: 100),
            ], detail: detail)
            XCTAssertEqual(rows.map(\.id), ["before", "w1", "after"], "\(detail)")
        }
    }

    func testLimitFailoverDecodesOnToolActivity() throws {
        let message = try JSONDecoder().decode(Message.self, from: Data(#"""
        {"id":"l","role":"bot","kind":"activity","at":1,
         "tool":{"name":"recovery: Limit reached on Claude: continuing on Codex until it resets (around 2:05 PM).",
                 "ok":true,
                 "limitFailover":{"kind":"switched","from":"Claude","to":"Codex","resetsAt":0}}}
        """#.utf8))
        XCTAssertEqual(message.tool?.limitFailover?.kind, "switched")
        XCTAssertEqual(message.tool?.limitFailover?.from, "Claude")
        XCTAssertEqual(message.tool?.limitFailover?.to, "Codex")
        XCTAssertTrue(isHiddenStatusNotice(message))
    }
}
