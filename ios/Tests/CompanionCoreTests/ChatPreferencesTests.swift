// The two pieces of preference logic worth testing without a screen: how a
// transcript folds at each activity level, and how a quick-reply list
// survives a round trip through storage.
//
// Both are written against what the reader ends up seeing, not internals —
// a run collapses, a failure never does, and a corrupt store still puts
// four usable chips on the composer.
import XCTest
@testable import CompanionCore

final class ChatPreferencesTests: XCTestCase {
    private func text(_ id: String, at: Double = 1) -> Message {
        var message = Message(id: id, role: .bot, kind: .text, at: at)
        message.text = "hello"
        return message
    }

    private func activity(_ id: String, at: Double = 1, ok: Bool? = true) -> Message {
        var message = Message(id: id, role: .bot, kind: .activity, at: at)
        message.tool = ToolActivity(name: "run", ok: ok)
        return message
    }

    /// What the harness appends after every settled turn: a work receipt,
    /// decoded from the wire exactly as it arrives.
    private func digest(_ id: String, at: Double = 1) -> Message {
        let json = """
        {"id":"\(id)","role":"bot","kind":"digest","at":\(at),"text":"[digest] · tools: /bin/bash -lc 'composio search' ×1 · reply: Done."}
        """
        return try! JSONDecoder().decode(Message.self, from: Data(json.utf8))
    }

    // MARK: - Full

    func testFullDropsToolActivityAndKeepsTextInOrder() {
        let messages = [text("a"), activity("b"), activity("c"), text("d")]
        let rows = transcriptRows(messages, detail: .full)
        XCTAssertEqual(rows.map(\.id), ["a", "d"])
        XCTAssertEqual(messages.map(\.id), ["a", "b", "c", "d"], "hiding a row does not drop the stored message")
    }

    /// The phone transcript: tool Success and Error lines go, the reply and
    /// the question card stay, and a finished turn may still say "Worked for".
    func testToolActivityRowIsDroppedAndTextAndQuestionCardStay() {
        var user = Message(id: "user", role: .user, kind: .text, at: 1_000)
        user.text = "can you import this bot"
        user.attachments = [MessageImageAttachment(kind: "file", path: "export.json", mime: "application/json", name: "export-connectwise-psa.json", durationMs: nil)]

        var succeeded = activity("ok", at: 2_000)
        succeeded.tool = ToolActivity(name: "mcp_sagax-environment__run_command", ok: true)
        var failed = activity("bad", at: 3_000, ok: false)
        failed.tool = ToolActivity(name: "mcp_agents__create_bot", ok: false)

        var progress = Message(id: "progress", role: .bot, kind: .text, at: 4_000)
        progress.text = "Importing the bot"
        progress.turnId = "turn"
        var answer = Message(id: "answer", role: .bot, kind: .text, at: 44_000)
        answer.text = "The bot is ready"
        answer.turnId = "turn"
        answer.turnTerminal = true

        var question = Message(id: "ask", role: .bot, kind: .options, at: 45_000)
        var card = OptionCard(title: "Update @Connectwise PSA's profile?", subtitle: "Whose profile: @Connectwise PSA", options: ["Allow", "Deny"])
        card.requestId = "req-ask"
        card.questionRequest = QuestionRequestCardData(
            questions: [AskQuestion(question: "Whose profile?", options: [AskQuestionOption(label: "@Connectwise PSA")])]
        )
        question.card = card

        let messages = [user, succeeded, failed, progress, answer, question]
        for detail in ActivityDetail.allCases {
            let rows = transcriptRows(messages, detail: detail)
            XCTAssertEqual(rows.map(\.id), ["user", "turn.turn", "answer", "ask"], "\(detail)")
            guard case let .assistantTurn(turn) = rows[1] else { return XCTFail("the worked summary stays") }
            XCTAssertEqual(turn.label, "Worked for 43s")
            guard case let .message(kept) = rows[0] else { return XCTFail("the text stays") }
            XCTAssertEqual(kept.attachments?.first?.name, "export-connectwise-psa.json")
            guard case let .message(asked) = rows[3] else { return XCTFail("the question card stays") }
            XCTAssertEqual(asked.kind, .options)
            XCTAssertEqual(asked.card?.questions.first?.question, "Whose profile?")
        }
        XCTAssertTrue(messages.contains { isToolActivityRow($0) })
    }

    // MARK: - Hidden

    func testHiddenDropsActivityAndKeepsTheRest() {
        let messages = [text("a"), activity("b"), activity("c"), text("d")]
        XCTAssertEqual(transcriptRows(messages, detail: .hidden).map(\.id), ["a", "d"])
    }

    // The digest and compaction receipts are the harness talking about the
    // tool calls: hidden with them, but never folded into a run of them.

    func testHiddenDropsDigestAndCompactionReceiptsToo() {
        let messages = [text("a"), activity("b"), digest("c"), text("d"), compaction("e")]
        XCTAssertEqual(transcriptRows(messages, detail: .hidden).map(\.id), ["a", "d"])
    }

    func testReducedKeepsACompactionAndDropsTheToolRowsAroundIt() {
        let messages = [activity("a"), activity("b"), compaction("c"), activity("d"), activity("e")]
        let rows = transcriptRows(messages, detail: .reduced)
        XCTAssertEqual(rows.map(\.id), ["c"])
        XCTAssertEqual(rows[0].kind, .compaction)
    }

    private func compaction(_ id: String, at: Double = 1) -> Message {
        var message = Message(id: id, role: .bot, kind: .compaction, at: at)
        message.text = "[compaction] summary"
        message.compaction = Compaction(summary: "summary", tokensBefore: 10)
        return message
    }

    func testHiddenDropsFailedActivityToo() {
        let messages = [text("a"), activity("b", ok: false)]
        XCTAssertEqual(transcriptRows(messages, detail: .hidden).map(\.id), ["a"])
    }

    // MARK: - Reduced

    func testReducedDropsToolActivityInsteadOfFoldingIt() {
        let messages = [text("a"), activity("b"), activity("c"), activity("d"), text("e")]
        XCTAssertEqual(transcriptRows(messages, detail: .reduced).map(\.id), ["a", "e"])
    }

    func testReducedDropsALoneToolActivity() {
        let messages = [text("a"), activity("b"), text("c")]
        XCTAssertEqual(transcriptRows(messages, detail: .reduced).map(\.id), ["a", "c"])
    }

    func testStatusNoticeIsNeverHiddenOrFolded() {
        // "Qwen hit a rate limit and is retrying" is the answer to "is it
        // stuck?", not tool noise.
        var notice = Message(id: "n", role: .bot, kind: .activity, at: 1)
        notice.tool = ToolActivity(name: "notice: Qwen is waiting on its model", ok: true)
        let messages = [activity("a"), activity("b"), notice, activity("c"), activity("d")]
        XCTAssertEqual(transcriptRows(messages, detail: .hidden).map(\.id), ["n"])
        XCTAssertEqual(transcriptRows(messages, detail: .reduced).map(\.id), ["n"])
        XCTAssertEqual(transcriptRows(messages, detail: .full).map(\.id), ["n"])
    }

    func testAFailedToolCallIsDroppedWithTheOtherToolRows() {
        // An Error badge on a tool receipt is still a tool row. A failed
        // turn, whose name starts with "error:", is a different row and stays.
        let messages = [activity("a"), activity("b"), activity("c", ok: false), activity("d"), activity("e")]
        for detail in ActivityDetail.allCases {
            XCTAssertTrue(transcriptRows(messages, detail: detail).isEmpty, "\(detail)")
        }
        var turn = activity("err", ok: false)
        turn.tool = ToolActivity(name: "error: boom", ok: false)
        XCTAssertEqual(transcriptRows(messages + [turn], detail: .full).map(\.id), ["err"])
    }

    func testReducedDropsToolRowsOnEitherSideOfText() {
        let messages = [activity("a"), activity("b"), text("c"), activity("d"), activity("e")]
        XCTAssertEqual(transcriptRows(messages, detail: .reduced).map(\.id), ["c"])
    }

    func testARunningToolCallIsDroppedToo() {
        let messages = [activity("a"), activity("b", ok: nil)]
        XCTAssertTrue(transcriptRows(messages, detail: .full).isEmpty)
        XCTAssertTrue(transcriptRows(messages, detail: .reduced).isEmpty)
    }

    func testRowCarriesTheTimeAndSenderOfItsFirstMessage() {
        // The transcript's date separators and bubble tails read these off
        // the row rather than the message, so a run must answer for itself.
        // Opened-thread chips are not tool rows, so reduced still folds them.
        var first = activity("a", at: 500)
        first.threadRef = ThreadRef(botId: "b", threadId: "t1", title: "Opened")
        var second = activity("b", at: 900)
        second.threadRef = ThreadRef(botId: "b", threadId: "t2", title: "Opened later")
        let rows = transcriptRows([first, second], detail: .reduced)
        XCTAssertEqual(rows[0].at, 500)
        XCTAssertEqual(rows[0].kind, .activity)
        XCTAssertEqual(rows[0].role, .bot)
        XCTAssertEqual(rows[0].endAt, 900)
    }

    func testEmptyTranscriptStaysEmptyAtEveryLevel() {
        for detail in ActivityDetail.allCases {
            XCTAssertTrue(transcriptRows([], detail: detail).isEmpty)
        }
    }

    // MARK: - Quick replies

    func testDefaultsAreTheFourChipsTheComposerAlreadyShows() {
        XCTAssertEqual(QuickReply.defaults.count, 4)
        XCTAssertEqual(QuickReply.defaults.map(\.title), ["Show diff", "Run tests", "Explain steps", "What's next?"])
    }

    func testQuickRepliesSurviveARoundTrip() {
        let mine = [
            QuickReply(title: "Deploy", prompt: "Deploy to staging", icon: "paperplane"),
            QuickReply(title: "Log", prompt: "Show the last 50 log lines", icon: "doc.text"),
        ]
        XCTAssertEqual(QuickReply.decode(QuickReply.encode(mine)), mine)
    }

    func testAnEmptyStoreFallsBackToDefaults() {
        // First launch: nothing written yet.
        XCTAssertEqual(QuickReply.decode(""), QuickReply.defaults)
    }

    func testCorruptStoreFallsBackToDefaultsRatherThanNoChips() {
        // A composer with no chips is worse than a composer with the stock
        // ones, so a bad decode is not allowed to empty the row.
        XCTAssertEqual(QuickReply.decode("{not json"), QuickReply.defaults)
    }

    func testDeletingEveryChipIsRespectedRatherThanReset() {
        // Distinct from a corrupt store: an explicit empty list means the
        // user cleared the row on purpose and it must stay cleared.
        XCTAssertEqual(QuickReply.decode(QuickReply.encode([])), [])
    }

    func testEmptyQuickReplyIDFallsBackToDefaults() {
        let replies = [QuickReply(id: " ", title: "Deploy", prompt: "Deploy", icon: "paperplane")]
        XCTAssertEqual(QuickReply.decode(QuickReply.encode(replies)), QuickReply.defaults)
    }

    func testDuplicateQuickReplyIDsFallBackToDefaults() {
        let replies = [
            QuickReply(id: "same", title: "Deploy", prompt: "Deploy", icon: "paperplane"),
            QuickReply(id: "same", title: "Logs", prompt: "Show logs", icon: "doc.text"),
        ]
        XCTAssertEqual(QuickReply.decode(QuickReply.encode(replies)), QuickReply.defaults)
    }

    // MARK: - Island intro

    func testIslandIntroDefaultsToOncePerBot() {
        XCTAssertEqual(IslandIntro.oncePerBot.rawValue, "oncePerBot")
        XCTAssertEqual(IslandIntro(rawValue: "nonsense"), nil)
        XCTAssertEqual(IslandIntro.allCases.count, 3)
    }

    // MARK: - Digests

    // The harness writes a "[digest] · tools: … · reply: …" receipt after
    // every turn. Drawn as a bubble it was a log line under every reply;
    // dropped, the one record of what a turn touched was gone. It is its
    // own row — a chip — beside the tool chips it sums up, never among them.
    func testADigestIsItsOwnRowAtFullAndReduced() {
        let messages = [text("a"), activity("b"), digest("c"), text("d"), digest("e")]
        XCTAssertEqual(transcriptRows(messages, detail: .full).map(\.id), ["a", "c", "d", "e"])
        XCTAssertEqual(transcriptRows(messages, detail: .reduced).map(\.id), ["a", "c", "d", "e"])
    }

    func testADigestIsHiddenWithTheActivityItSummarises() {
        let messages = [text("a"), activity("b"), digest("c"), text("d"), digest("e")]
        XCTAssertEqual(transcriptRows(messages, detail: .hidden).map(\.id), ["a", "d"])
    }

    func testADigestIsNeverFoldedIntoARunOfActivity() {
        let messages = [activity("a"), activity("b"), digest("c"), activity("d"), activity("e")]
        let rows = transcriptRows(messages, detail: .reduced)
        XCTAssertEqual(rows.map(\.id), ["c"])
        guard case let .message(receipt) = rows[0] else { return XCTFail("digest should be a message row") }
        XCTAssertEqual(receipt.kind, .digest)
        XCTAssertFalse(rows.contains { if case .activityRun = $0 { return true } else { return false } })
    }

    func testVoiceCallTurnsAreOneCard() throws {
        let json = """
        [
          {"id":"u","role":"user","kind":"text","at":1000,"text":"hello there","voiceCall":{"callId":"call-1"}},
          {"id":"ask","role":"bot","kind":"options","at":2000,"text":"Allow this?"},
          {"id":"n","role":"bot","kind":"text","at":30000,"text":"working on it","turnId":"turn"},
          {"id":"b","role":"bot","kind":"text","at":35000,"text":"hi back","turnId":"turn","turnTerminal":true},
          {"id":"t","role":"user","kind":"text","at":40000,"text":"after","via":"call"}
        ]
        """
        let messages = try JSONDecoder().decode([Message].self, from: Data(json.utf8))
        XCTAssertEqual(messages[0].voiceCall?.callId, "call-1")
        let rows = transcriptRows(messages, detail: .full)
        XCTAssertEqual(rows.map(\.id), ["voice.call-1", "ask", "t"])
        guard case let .voiceCall(card) = rows[0] else { return XCTFail("one card") }
        XCTAssertEqual(spokenLines(card.messages).map(\.text), ["hello there", "working on it", "hi back"])
        XCTAssertEqual(formatVoiceCallDuration(voiceCallDurationMs(card.messages, now: 0, clock: nil)), "00:34")
        XCTAssertEqual(rosterPreview(messages, detail: .full), "after")
        XCTAssertFalse(rows.contains { if case .assistantTurn = $0 { return true } else { return false } })

        var fragment = Message(id: "f1", role: .user, kind: .text, at: 1)
        fragment.text = "hel"
        fragment.voiceCall = VoiceCallMeta(callId: "c")
        var whole = Message(id: "f2", role: .user, kind: .text, at: 2)
        whole.text = "hello"
        whole.voiceCall = VoiceCallMeta(callId: "c", continues: true)
        XCTAssertEqual(spokenLines([fragment, whole]).map(\.text), ["hello"])
        XCTAssertEqual(formatVoiceCallDuration(90_000), "01:30")
    }

    // A turn that touched nothing has nothing for the chip to open.
    func testADigestWithNothingDoneIsNotARow() {
        var quiet = digest("c")
        quiet.text = "[digest] · no tool calls · reply: Hi there."
        XCTAssertEqual(transcriptRows([text("a"), quiet], detail: .full).map(\.id), ["a"])
    }
}
