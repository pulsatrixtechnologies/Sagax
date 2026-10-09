// "Seen by" and reactions on iOS (#270): the desktop's read-receipts.ts and
// reactions.ts cases, the wire and the frame.
import Foundation
import XCTest
@testable import CompanionCore

final class ReadReceiptsTests: XCTestCase {
    private func message(_ id: String, _ role: Message.Role, text: String = "x", kind: String = "text", sender: String? = nil, bot: String? = nil, at: Double = 0) throws -> Message {
        var fields = [#""id":"\#(id)""#, #""role":"\#(role.rawValue)""#, #""kind":"\#(kind)""#, #""at":\#(at)"#, #""text":"\#(text)""#]
        if let sender { fields.append(#""sender":{"name":"N \#(sender)","id":"\#(sender)"}"#) }
        if let bot { fields.append(#""from":{"botId":"\#(bot)","name":"B","color":"blue"}"#) }
        return try JSONDecoder().decode(Message.self, from: Data("{\(fields.joined(separator: ","))}".utf8))
    }

    func testDecodesReadsAndTheFrame() throws {
        let reads = try JSONDecoder().decode(ThreadReads.self, from: Data(#"{"reads":{"p_ada":{"messageId":"m2","at":5},"bad":{"x":1}},"self":"p_me"}"#.utf8))
        XCTAssertEqual(reads.reads["p_ada"], ThreadReadPosition(messageId: "m2", at: 5))
        XCTAssertNil(reads.reads["bad"])
        XCTAssertEqual(reads.selfId, "p_me")

        let frame = try JSONDecoder().decode(Frame.self, from: Data(#"{"kind":"thread.read","threadId":"t","participantId":"bot:b1","read":{"messageId":"m3","at":9}}"#.utf8))
        guard case let .threadRead(read) = frame else { return XCTFail("not a thread.read") }
        XCTAssertEqual(read.participantId, "bot:b1")
        XCTAssertEqual(ReadReceiptRules.apply(read, to: reads.reads)?["bot:b1"]?.messageId, "m3")
        let reset = try JSONDecoder().decode(Frame.self, from: Data(#"{"kind":"thread.read","threadId":"t","reset":true}"#.utf8))
        guard case let .threadRead(again) = reset else { return XCTFail("not a reset") }
        XCTAssertNil(ReadReceiptRules.apply(again, to: reads.reads), "a reset fetches again")
    }

    func testEachReaderOnceUnderTheirLastReadLineNotTheirOwn() throws {
        let order = [
            try message("m1", .user, sender: "p_ada"),
            try message("m2", .user, sender: "p_me"),
            try message("m3", .user, text: "", sender: "p_ada"),
            try message("m4", .bot, bot: "b1"),
        ]
        let reads: [String: ThreadReadPosition] = [
            "p_ada": .init(messageId: "m3", at: 30),
            "p_me": .init(messageId: "m4", at: 40),
            "bot:b1": .init(messageId: "m4", at: 20),
            "p_gone": .init(messageId: "not-loaded", at: 1),
        ]
        let rows = ReadReceiptRules.seenRows(order: order, anchorable: ReadReceiptRules.roomAnchorable, reads: reads, selfId: "P_ME")
        // Ada read up to an empty line (not a bubble) and the bot up to its
        // own line: both under m2, the earliest reader first
        XCTAssertEqual(rows["m2"]?.map(\.participantId), ["bot:b1", "p_ada"])
        XCTAssertNil(rows["m3"])
        XCTAssertNil(rows["m4"])
        XCTAssertNil(rows.values.flatMap { $0 }.first { $0.participantId == "p_me" }, "the viewer is never drawn")
    }

    func testBotSeenCaptionUntilItAnswers() throws {
        let asked = [try message("m1", .bot, bot: "b1"), try message("m2", .user, at: 1_000)]
        let reads = ["bot:b1": ThreadReadPosition(messageId: "m2", at: 100_000)]
        let place = ReadReceiptRules.botSeenCaption(order: asked, reads: reads, botId: "b1")
        XCTAssertEqual(place?.messageId, "m2")
        XCTAssertTrue(ReadReceiptRules.captionShowsTime(sentAt: 1_000, seenAt: 100_000))
        XCTAssertFalse(ReadReceiptRules.captionShowsTime(sentAt: 1_000, seenAt: 20_000))
        let answered = asked + [try message("m3", .bot, bot: "b1")]
        XCTAssertNil(ReadReceiptRules.botSeenCaption(order: answered, reads: reads, botId: "b1"))
    }

    func testFiveFacesThenMore() {
        let entries = (0..<7).map { SeenEntry(participantId: "p\($0)", at: Double($0)) }
        let split = ReadReceiptRules.faces(entries)
        XCTAssertEqual(split.shown.count, 5)
        XCTAssertEqual(split.more, 2)
    }

    func testReactionChipsInLandingOrderWithTheViewer() throws {
        let json = #"""
        [{"emoji":"🎉","actors":[{"id":"bot:b1","kind":"bot","name":"Scout"}],"at":20},
         {"emoji":"👍","actors":[{"id":"p_me","kind":"person","name":"Me"},{"id":"p_ada","kind":"person","name":"Ada"}],"at":10},
         {"emoji":"❤️","by":"user"}]
        """#
        let reactions = try JSONDecoder().decode([Reaction].self, from: Data(json.utf8))
        let me = ReactionRules.selfIds(readSelf: "P_me", viewerId: nil, personalServer: false)
        let chips = ReactionRules.chips(reactions, selfIds: me)
        XCTAssertEqual(chips.map(\.emoji), ["👍", "🎉", "❤️"])
        XCTAssertEqual(chips[0].count, 2)
        XCTAssertTrue(chips[0].mine)
        XCTAssertFalse(chips[1].mine)
        XCTAssertFalse(chips[2].mine, "the legacy owner is the viewer only on a personal server")
        XCTAssertTrue(ReactionRules.chips(reactions, selfIds: ReactionRules.selfIds(readSelf: nil, viewerId: nil, personalServer: true))[2].mine)
        XCTAssertEqual(ReactionRules.actorLabel(chips[0].actors[0], selfIds: me), .you)
        XCTAssertEqual(ReactionRules.actorLabel(chips[1].actors[0], selfIds: me), .name("Scout"))
        XCTAssertEqual(ReactionRules.actorLabel(ReactionActor(id: "bot:x", kind: "bot", name: nil), selfIds: me), .aBot)
        XCTAssertEqual(ReactionRules.actorLabel(ReactionActor(id: "p_x", kind: "person", name: ""), selfIds: me), .someone)
    }

    func testQuickReactionsAndOneEmoji() {
        XCTAssertEqual(ReactionRules.quick, ["👍", "❤️", "😂", "🎉", "👀", "🙏", "✅", "❌"])
        XCTAssertEqual(ReactionRules.emoji(from: " 🦊 "), "🦊")
        XCTAssertEqual(ReactionRules.emoji(from: "👍🏽"), "👍🏽")
        XCTAssertEqual(ReactionRules.emoji(from: "❤️"), "❤️")
        XCTAssertNil(ReactionRules.emoji(from: "ab"))
        XCTAssertNil(ReactionRules.emoji(from: "a"))
        XCTAssertNil(ReactionRules.emoji(from: "🦊🦊"))
        XCTAssertNil(ReactionRules.emoji(from: "1"))
    }
}
