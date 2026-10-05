// WP1 message actions: the rules the long-press menu and the iPad hover row
// share (MessageActions.swift), and the requests they send. Each expectation
// is the renderer's (src/lib/replies.ts, src/lib/mentions.ts,
// src/components/ChatView.tsx, GroupView.tsx, src/lib/tts).
import Foundation
import XCTest
@testable import CompanionCore

private final class ActionRequestStub: URLProtocol {
    static var responseBody = Data("{}".utf8)
    static var statusCode = 200
    static var captured: [(URLRequest, Data?)] = []

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        var body = request.httpBody
        if body == nil, let stream = request.httpBodyStream {
            stream.open()
            var data = Data()
            var buffer = [UInt8](repeating: 0, count: 1_024)
            while stream.hasBytesAvailable {
                let count = stream.read(&buffer, maxLength: buffer.count)
                if count <= 0 { break }
                data.append(buffer, count: count)
            }
            stream.close()
            body = data
        }
        Self.captured.append((request, body))
        let response = HTTPURLResponse(
            url: request.url!, statusCode: Self.statusCode, httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Self.responseBody)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

final class MessageActionsTests: XCTestCase {
    private var session: URLSession!
    private var client: CompanionClient!

    override func setUp() {
        super.setUp()
        ActionRequestStub.captured = []
        ActionRequestStub.statusCode = 200
        ActionRequestStub.responseBody = Data("{}".utf8)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ActionRequestStub.self]
        session = URLSession(configuration: configuration)
        client = CompanionClient(
            connection: Connection(name: "Mac", host: "127.0.0.1", port: 8810),
            token: "paired-token",
            session: session
        )
    }

    override func tearDown() {
        session.invalidateAndCancel()
        super.tearDown()
    }

    private func message(_ id: String, _ role: Message.Role, _ text: String?, kind: Message.Kind = .text) -> Message {
        var message = Message(id: id, role: role, kind: kind, at: 1)
        message.text = text
        return message
    }

    private func json(_ data: Data?) -> [String: Any] {
        (data.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]) ?? [:]
    }

    // MARK: Reply

    func testSendCarriesReplyToIdOnBotAndRoomRoutes() async throws {
        ActionRequestStub.responseBody = Data(#"{"ok":true}"#.utf8)
        try await client.send(
            text: "Oui", to: .bot(id: "bot-1", threadId: "thread-1"), sendId: "send-reply-0000001",
            options: SendOptions(replyToId: "m-7")
        )
        try await client.send(
            text: "Oui", to: .room(id: "group-1", threadId: "gthread-1"), sendId: "send-reply-0000002",
            options: SendOptions(replyToId: "m-8")
        )
        XCTAssertEqual(ActionRequestStub.captured.count, 2)
        let (botRequest, botBody) = ActionRequestStub.captured[0]
        XCTAssertEqual(botRequest.httpMethod, "POST")
        XCTAssertEqual(botRequest.url?.path, "/api/bots/bot-1/messages")
        XCTAssertEqual(json(botBody)["replyToId"] as? String, "m-7")
        XCTAssertEqual(json(botBody)["threadId"] as? String, "thread-1")
        let (roomRequest, roomBody) = ActionRequestStub.captured[1]
        XCTAssertEqual(roomRequest.url?.path, "/api/groups/group-1/messages")
        XCTAssertEqual(json(roomBody)["replyToId"] as? String, "m-8")
    }

    func testSendWithoutReplyLeavesTheFieldOut() async throws {
        try await client.send(text: "Oui", to: .bot(id: "bot-1", threadId: "thread-1"), sendId: "send-reply-0000003")
        XCTAssertNil(json(ActionRequestStub.captured.first?.1)["replyToId"])
    }

    func testReplyIdDecodesFromTheWire() throws {
        let data = Data(#"{"id":"m-2","role":"user","kind":"text","at":5,"text":"Ok","replyToId":"m-1","steered":true}"#.utf8)
        let decoded = try JSONDecoder().decode(Message.self, from: data)
        XCTAssertEqual(decoded.replyToId, "m-1")
        XCTAssertEqual(decoded.steered, true)
    }

    func testReplyAuthorFollowsReplyAuthor() {
        XCTAssertEqual(ReplyPreview.author(of: message("u", .user, "salut"), fallbackName: "Ara"), .you)
        XCTAssertEqual(ReplyPreview.author(of: message("b", .bot, "salut"), fallbackName: "Ara"), .named("Ara"))
        XCTAssertEqual(ReplyPreview.author(of: message("b", .bot, "salut"), fallbackName: nil), .assistant)
        var room = message("r", .bot, "salut")
        room.from = Sender(botId: "b2", name: "Helix", color: "blue")
        XCTAssertEqual(ReplyPreview.author(of: room, fallbackName: "Ara"), .named("Helix"))
        let peer = message("p", .user, "[Message from @Chief, another bot in this Sagax workspace, sent with ask_bot] Fais ceci")
        XCTAssertEqual(ReplyPreview.author(of: peer, fallbackName: "Ara"), .named("Chief"))
        XCTAssertEqual(ReplyPreview.source(of: peer), "Fais ceci")
    }

    func testSnippetFoldsTagsAndWhitespaceAndCuts() {
        let tagged = "Voici\n\n<attached-image path=\"/tmp/a.png\" name=\"a.png\"/> et <attached-file path=\"/tmp/b.pdf\"/>  fin"
        XCTAssertEqual(ReplyPreview.snippet(tagged, imageLabel: "[image]", fileLabel: "[fichier]"), "Voici [image] et [fichier] fin")
        let long = String(repeating: "a", count: 200)
        let cut = ReplyPreview.snippet(long)
        XCTAssertEqual(cut.count, 160)
        XCTAssertTrue(cut.hasSuffix("…"))
        XCTAssertEqual(ReplyPreview.snippet("court"), "court")
    }

    func testCitationPreviewReadsTheQuote() throws {
        let payload = try JSONSerialization.data(withJSONObject: ["quote": "la ligne", "comment": "pourquoi ?"])
        let encoded = payload.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        let text = "Regarde\n<!--omb-citation-v1:\(encoded)-->\n> Quoted message:\n> la ligne\n\nComment:\npourquoi ?"
        XCTAssertEqual(Citations.previewText(text), "Regarde la ligne — pourquoi ?")
        XCTAssertEqual(Citations.previewText("rien"), "rien")
    }

    // MARK: Collapse, mentions, routed by

    func testLongUserMessagesCollapseLikeTheDesktop() {
        XCTAssertFalse(MessageCollapse.isLong(String(repeating: "x", count: 600)))
        XCTAssertTrue(MessageCollapse.isLong(String(repeating: "x", count: 601)))
        XCTAssertFalse(MessageCollapse.isLong(Array(repeating: "l", count: 8).joined(separator: "\n")))
        XCTAssertTrue(MessageCollapse.isLong(Array(repeating: "l", count: 9).joined(separator: "\n")))
    }

    func testMentionRangesMatchLongestNamesAtWordStarts() {
        let peers = [MentionPeer(name: "Ara", color: "purple"), MentionPeer(name: "Ara Bis", color: "blue"), MentionPeer(name: "Lux", hidden: true)]
        let text = "@Ara Bis et (@ara), pas a@Ara ni @Arabe ni @Lux, @everyone"
        let ranges = Mentions.ranges(in: text, peers: peers, everyone: true)
        let words = ranges.map { String(Array(text)[$0.start..<$0.end]) }
        XCTAssertEqual(words, ["@Ara Bis", "@ara", "@everyone"])
        XCTAssertEqual(ranges[0].colorHex, MausColors.hex["blue"])
        XCTAssertEqual(ranges[1].colorHex, MausColors.hex["purple"])
        XCTAssertNil(ranges[2].colorHex)
        XCTAssertTrue(Mentions.ranges(in: "@everyone", peers: [], everyone: false).isEmpty)
    }

    func testRoutedByPercentIsClamped() {
        XCTAssertEqual(RoutedBy(provider: "jev", probability: 0.824).percent, 82)
        XCTAssertEqual(RoutedBy(provider: "jev", probability: 1.7).percent, 100)
        XCTAssertEqual(RoutedBy(provider: "jev", probability: -1).percent, 0)
    }

    // MARK: Regenerate

    func testRegenerateForksTheLastUserLineOnTheLastReplyOnly() {
        let messages = [
            message("u1", .user, "Premier"),
            message("b1", .bot, "Réponse un"),
            message("u2", .user, "Deuxième"),
            message("b2", .bot, "Réponse deux"),
        ]
        XCTAssertEqual(MessageActionRules.lastBotTextId(in: messages), "b2")
        XCTAssertEqual(MessageActionRules.regenerateSource(in: messages)?.id, "u2")
        XCTAssertTrue(MessageActionRules.canRegenerate(messages[3], in: messages, busy: false))
        XCTAssertFalse(MessageActionRules.canRegenerate(messages[1], in: messages, busy: false))
        XCTAssertFalse(MessageActionRules.canRegenerate(messages[3], in: messages, busy: true))
        XCTAssertFalse(MessageActionRules.canRegenerate(messages[3], in: messages, busy: false, pendingId: "u2"))
    }

    func testRegenerateSkipsPeerLinesAndRefusesAttachments() {
        let peer = message("p", .user, "[Delegated by @Chief, another bot in this Sagax workspace] Tâche")
        let withFile = message("u", .user, "Voir\n<attached-file path=\"/tmp/x.pdf\" name=\"x.pdf\"/>")
        XCTAssertEqual(MessageActionRules.regenerateSource(in: [message("u0", .user, "Base"), message("b", .bot, "R"), peer])?.id, "u0")
        XCTAssertNil(MessageActionRules.regenerateSource(in: [withFile, message("b", .bot, "R")]))
    }

    func testActionAvailabilityByKind() {
        XCTAssertTrue(MessageActionRules.canQuote(message("a", .user, "x")))
        XCTAssertFalse(MessageActionRules.canQuote(message("a", .bot, "x", kind: .activity)))
        XCTAssertTrue(MessageActionRules.canSpeak(message("a", .bot, "x")))
        XCTAssertFalse(MessageActionRules.canSpeak(message("a", .user, "x")))
        XCTAssertFalse(MessageActionRules.canSpeak(message("a", .bot, "")))
        XCTAssertTrue(MessageActionRules.canViewSource(message("a", .bot, "**x**")))
        XCTAssertFalse(MessageActionRules.canViewSource(message("a", .user, "**x**")))
    }

    // MARK: Pin

    func testPinnedPreviewResolvesTextLinesOnly() {
        var messages = [message("u1", .user, "Garde  ceci\nen tête"), message("b1", .bot, "Réponse")]
        messages.append(message("t1", .bot, nil, kind: .activity))
        let pin = PinnedPreview.resolve("u1", in: messages, fallbackName: "Ara")
        XCTAssertEqual(pin, PinnedPreview(messageId: "u1", author: .you, text: "Garde ceci en tête"))
        XCTAssertEqual(PinnedPreview.resolve("b1", in: messages, fallbackName: "Ara")?.author, .named("Ara"))
        XCTAssertNil(PinnedPreview.resolve("t1", in: messages, fallbackName: "Ara"))
        XCTAssertNil(PinnedPreview.resolve("gone", in: messages, fallbackName: "Ara"))
        XCTAssertNil(PinnedPreview.resolve(nil, in: messages, fallbackName: "Ara"))
    }

    func testPinRequestsPatchTheThreadOrTheRoom() throws {
        let pin = try client.setPinnedMessageRequest(botId: "bot-1", threadId: "thread-1", messageId: "m-3")
        XCTAssertEqual(pin.httpMethod, "PATCH")
        XCTAssertEqual(pin.url?.path, "/api/bots/bot-1/tasks/thread-1")
        XCTAssertEqual(json(pin.httpBody)["pinnedMessageId"] as? String, "m-3")
        XCTAssertEqual(json(pin.httpBody).count, 1)

        let unpin = try client.setPinnedMessageRequest(botId: "bot-1", threadId: "thread-1", messageId: nil)
        XCTAssertEqual(json(unpin.httpBody)["pinnedMessageId"] as? String, "")

        let room = try client.setPinnedMessageRequest(groupId: "group-1", messageId: "m-4")
        XCTAssertEqual(room.url?.path, "/api/groups/group-1")
        XCTAssertEqual(json(room.httpBody)["pinnedMessageId"] as? String, "m-4")

        XCTAssertThrowsError(try client.setPinnedMessageRequest(botId: "bot-1", threadId: "thread-1", messageId: "../x"))
    }

    func testBotPinPrefersTheShownTask() throws {
        let data = Data(#"""
        {"id":"bot-1","threadId":"t2","name":"Ara","title":"","description":"","notifications":true,"color":"purple",
         "unread":false,"modelSelection":{"instanceId":"claude","model":"default"},"createdAt":1,"pinnedMessageId":"mirror",
         "tasks":[{"threadId":"t1","title":"Un","createdAt":1,"pinnedMessageId":"m1"},{"threadId":"t2","title":"Deux","createdAt":2}]}
        """#.utf8)
        var bot = try JSONDecoder().decode(Bot.self, from: data)
        XCTAssertNil(bot.pinnedMessageIdForShownThread, "the shown task has no pin, whatever the mirror says")
        bot.threadId = "t1"
        XCTAssertEqual(bot.pinnedMessageIdForShownThread, "m1")
        bot.tasks = nil
        XCTAssertEqual(bot.pinnedMessageIdForShownThread, "mirror")
    }

    // MARK: Speak

    func testSpeechRequestsAndPreparationDecoding() throws {
        let prepare = try client.prepareSpeechRequest(text: "Bonjour", voiceId: "voice-1")
        XCTAssertEqual(prepare.url?.path, "/api/tts/prepare")
        XCTAssertEqual(json(prepare.httpBody)["voiceId"] as? String, "voice-1")
        let speak = try client.speechRequest(text: "Bonjour", voiceId: nil)
        XCTAssertEqual(speak.url?.path, "/api/tts/speak")
        XCTAssertNil(json(speak.httpBody)["voiceId"])
        XCTAssertEqual(json(speak.httpBody)["text"] as? String, "Bonjour")

        let ready = try JSONDecoder().decode(SpeechPreparation.self, from: Data(#"{"ready":true,"utterances":["Un.","Deux."]}"#.utf8))
        XCTAssertEqual(ready, SpeechPreparation(ready: true, utterances: ["Un.", "Deux."]))
        let none = try JSONDecoder().decode(SpeechPreparation.self, from: Data(#"{"ready":false}"#.utf8))
        XCTAssertEqual(none, SpeechPreparation(ready: false, utterances: []))
    }

    func testPrepareSpeechCallsTheComputer() async throws {
        ActionRequestStub.responseBody = Data(#"{"ready":true,"utterances":["Bonjour."]}"#.utf8)
        let prepared = try await client.prepareSpeech(text: "Bonjour", voiceId: nil)
        XCTAssertTrue(prepared.ready)
        XCTAssertEqual(ActionRequestStub.captured.first?.0.httpMethod, "POST")
    }
}
