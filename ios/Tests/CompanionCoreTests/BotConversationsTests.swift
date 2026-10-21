import XCTest
@testable import CompanionCore

final class BotConversationsTests: XCTestCase {
    private func row(_ id: String, at: Double, direction: String = "out") -> BotConversation {
        BotConversation(threadId: id, otherBotId: "b", otherName: "Bravo", direction: direction, startedAt: at)
    }

    func testDecodesTheServerRow() throws {
        let json = #"{"threadId":"t","otherBotId":"b","otherName":"Bravo","direction":"in","kind":"pair","updatedAt":5,"running":true}"#
        let value = try JSONDecoder().decode(BotConversation.self, from: Data(json.utf8))
        XCTAssertEqual(value.running, true)
        XCTAssertEqual(value.at, 5)
        XCTAssertNil(value.destinationBotId)
    }

    func testAnchorsSitBeforeTheNextRowOrAfterTheLast() {
        let a = BotConversations.anchors([row("x", at: 15), row("y", at: 99)], rowStarts: [10, 20, 30], hasMore: false)
        XCTAssertEqual(a.before[1]?.map(\.threadId), ["x"])
        XCTAssertEqual(a.after.map(\.threadId), ["y"])
    }

    func testOlderThanTheWindowIsLeftOutWhileEarlierPagesRemain() {
        let a = BotConversations.anchors([row("x", at: 1)], rowStarts: [10], hasMore: true)
        XCTAssertTrue(a.before.isEmpty && a.after.isEmpty)
    }

    func testLinesCreditEachBotAndSkipTools() {
        var user = Message(id: "1", role: .user, kind: .text, at: 1); user.text = "Hi"
        var reply = Message(id: "2", role: .bot, kind: .text, at: 2); reply.text = "Hello"
        var tool = Message(id: "3", role: .bot, kind: .activity, at: 3); tool.text = "x"
        let out = BotConversations.lines([user, reply, tool], selfId: "a", selfName: "Alpha", row: row("t", at: 0))
        XCTAssertEqual(out.map(\.speakerName), ["Alpha", "Bravo"])
        let back = BotConversations.lines([user, reply], selfId: "a", selfName: "Alpha", row: row("t", at: 0, direction: "in"))
        XCTAssertEqual(back.map(\.speakerName), ["Bravo", "Alpha"])
    }
}
