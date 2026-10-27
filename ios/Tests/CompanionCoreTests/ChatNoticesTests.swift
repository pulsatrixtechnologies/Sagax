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
}
