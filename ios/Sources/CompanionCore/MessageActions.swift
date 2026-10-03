import Foundation

// The message actions of the desktop chat (WP1 of the feature parity matrix,
// rows CO2, MS3-MS5, MS8, MS9, MS19-MS21, RM10), as the rules they follow,
// without any view. The iPhone's long-press menu and the iPad's hover row
// read the same answers, so neither layout re-derives them.
//
// Each rule names the renderer code it mirrors.

// MARK: - Peer lines (src/lib/peer-message.ts)

/// A user-role line another bot wrote (ask_bot, delegate_bot, start_thread).
/// The field wins; rows stored before `peerAsk` existed still open with the
/// provenance note, so the note is read as the fallback.
public struct PeerLine: Equatable, Sendable {
    public enum Delivery: String, Sendable { case askBot = "ask_bot", delegateBot = "delegate_bot", startThread = "start_thread" }

    public var botId: String?
    public var name: String
    public var delivery: Delivery
    /// The words themselves, with the provenance note removed.
    public var body: String

    private static let note = try! NSRegularExpression(
        pattern: #"^\[(Message from|Delegated by|Thread opened by) @([^,\]]+), another bot in this Sagax workspace[^\]]*\]\s*"#
    )

    /// Who wrote a user-role line, when it was not the person; nil when it was.
    public static func parse(_ message: Message) -> PeerLine? {
        guard message.role == .user else { return nil }
        let text = message.text ?? ""
        let range = NSRange(text.startIndex..., in: text)
        let match = note.firstMatch(in: text, range: range)
        let noteName = match.flatMap { Range($0.range(at: 2), in: text) }.map { text[$0].trimmingCharacters(in: .whitespaces) }
        guard let name = message.peerAsk?.name ?? noteName, !name.isEmpty else { return nil }
        let kind = match.flatMap { Range($0.range(at: 1), in: text) }.map { String(text[$0]) }
        let delivery: Delivery = switch kind {
        case "Delegated by": .delegateBot
        case "Thread opened by": .startThread
        default: .askBot
        }
        let body = match.flatMap { Range($0.range, in: text) }.map { String(text[$0.upperBound...]) } ?? text
        return PeerLine(botId: message.peerAsk?.botId, name: name, delivery: delivery, body: body)
    }
}

// MARK: - Reply quote (src/lib/replies.ts, ReplyQuote.tsx)

public enum ReplyPreview {
    /// Who a quote names. The app supplies the words for "You" and
    /// "Assistant" in the reader's language.
    public enum Author: Equatable, Sendable {
        case you
        case named(String)
        case assistant
    }

    /// `replyAuthor`: a user line is yours unless a peer wrote it; a bot line
    /// is its speaker, the chat's name, or "Assistant".
    public static func author(of message: Message, fallbackName: String?) -> Author {
        if message.role == .user {
            return PeerLine.parse(message).map { .named($0.name) } ?? .you
        }
        if let name = message.from?.name, !name.isEmpty { return .named(name) }
        if let fallbackName, !fallbackName.isEmpty { return .named(fallbackName) }
        return .assistant
    }

    private static let attachmentTag = try! NSRegularExpression(
        pattern: #"<attached-(image|file)\s+path="[^"]*"(?:\s+name="[^"]*")?\s*/>"#
    )

    /// `replySnippet`: citations read as their quote, attachment tags as a
    /// word, whitespace folded, and at most `limit` characters with an
    /// ellipsis.
    public static func snippet(
        _ text: String,
        limit: Int = 160,
        imageLabel: String = "[image]",
        fileLabel: String = "[file]"
    ) -> String {
        let cited = Citations.previewText(text)
        let mutable = NSMutableString(string: cited)
        let matches = attachmentTag.matches(in: cited, range: NSRange(location: 0, length: mutable.length))
        for match in matches.reversed() {
            let kind = mutable.substring(with: match.range(at: 1))
            mutable.replaceCharacters(in: match.range, with: kind == "image" ? imageLabel : fileLabel)
        }
        let clean = (mutable as String)
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        guard clean.count > limit else { return clean }
        let cut = String(clean.prefix(max(0, limit - 1)))
        return cut.replacingOccurrences(of: #"\s+$"#, with: "", options: .regularExpression) + "…"
    }

    /// The text a quote previews: a peer's words without the note.
    public static func source(of message: Message) -> String {
        PeerLine.parse(message)?.body ?? message.text ?? ""
    }
}

// MARK: - Citations (src/lib/citations.ts, preview only)

public enum Citations {
    private static let marker = try! NSRegularExpression(pattern: #"<!--omb-citation-v1:([A-Za-z0-9_-]{1,100000})-->"#)

    private struct Payload: Decodable {
        var quote: String
        var comment: String?
    }

    /// `citationPreviewText`: a message that quotes another reads as its own
    /// words, then each quote ("quote — comment"). Text without a citation
    /// comes back unchanged.
    public static func previewText(_ text: String) -> String {
        let ns = text as NSString
        var display = ""
        var quotes: [String] = []
        var cursor = 0
        for match in marker.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
            guard match.range.location >= cursor,
                  let payload = decode(ns.substring(with: match.range(at: 1)))
            else { continue }
            let block = ns.substring(with: match.range) + "\n" + fallback(payload)
            guard ns.substring(from: match.range.location).hasPrefix(block) else { continue }
            display += ns.substring(with: NSRange(location: cursor, length: match.range.location - cursor))
            cursor = match.range.location + (block as NSString).length
            quotes.append(payload.comment.map { "\(payload.quote) — \($0)" } ?? payload.quote)
        }
        guard !quotes.isEmpty else { return text }
        display += ns.substring(from: cursor)
        let trimmed = display.trimmingCharacters(in: .whitespacesAndNewlines)
        return ([trimmed] + quotes).filter { !$0.isEmpty }.joined(separator: " ")
    }

    private static func fallback(_ payload: Payload) -> String {
        let quote = payload.quote.split(separator: "\n", omittingEmptySubsequences: false).map { "> \($0)" }.joined(separator: "\n")
        return "> Quoted message:\n\(quote)" + (payload.comment.map { "\n\nComment:\n\($0)" } ?? "")
    }

    private static func decode(_ value: String) -> Payload? {
        var base = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while base.count % 4 != 0 { base += "=" }
        guard let data = Data(base64Encoded: base) else { return nil }
        return try? JSONDecoder().decode(Payload.self, from: data)
    }
}

// MARK: - Long user messages (ChatView.tsx USER_COLLAPSE_*)

public enum MessageCollapse {
    public static let characterLimit = 600
    public static let lineLimit = 8
    /// The collapsed height of the desktop (`max-h-40`), in points.
    public static let collapsedHeight: Double = 160

    /// A user line longer than 600 characters or 8 lines starts collapsed.
    public static func isLong(_ visibleText: String) -> Bool {
        visibleText.count > characterLimit
            || visibleText.split(separator: "\n", omittingEmptySubsequences: false).count > lineLimit
    }
}

// MARK: - Mentions (src/lib/mentions.ts, shared/mention-boundary.ts)

public struct MentionPeer: Hashable, Sendable {
    public var name: String
    public var hidden: Bool
    /// A palette name (`MausColors`); anything else draws the neutral tint.
    public var color: String?

    public init(name: String, hidden: Bool = false, color: String? = nil) {
        self.name = name
        self.hidden = hidden
        self.color = color
    }
}

public struct MentionRange: Hashable, Sendable {
    /// Offsets in Characters of the scanned string, `@` included.
    public var start: Int
    public var end: Int
    /// The peer's palette name, nil for @everyone or an unknown colour.
    public var colorName: String?

    /// The palette hex (`#RRGGBB`) the desktop tints with.
    public var colorHex: String? { colorName.flatMap { MausColors.hex[$0] } }
}

public enum Mentions {
    /// `(`, `*`, `_`, `~`, `[`, `{`, `<`, quotes and the CJK openers: a tag
    /// may follow these, while `/@bot` stays a URL path.
    private static let openers: Set<Character> = [
        "(", "*", "_", "~", "[", "{", "<", "'", "\"",
        "\u{2018}", "\u{201C}", "\u{3008}", "\u{300A}", "\u{300C}", "\u{300E}", "\u{3010}", "\u{FF08}",
    ]

    static func isBoundary(_ chars: [Character], at index: Int) -> Bool {
        guard index > 0 else { return true }
        let before = chars[index - 1]
        return before.isWhitespace || openers.contains(before)
    }

    static func continues(_ character: Character?) -> Bool {
        guard let character else { return false }
        return character == "_" || character.unicodeScalars.contains {
            CharacterSet.letters.contains($0) || CharacterSet.decimalDigits.contains($0)
                || CharacterSet.nonBaseCharacters.contains($0)
        }
    }

    /// `mentionRanges`: word-start, longest-name matches of the peers the
    /// reader can see, and @everyone where the room allows it.
    public static func ranges(in text: String, peers: [MentionPeer], everyone: Bool = false) -> [MentionRange] {
        let candidates = peers
            .filter { !$0.hidden && !$0.name.trimmingCharacters(in: .whitespaces).isEmpty }
            .sorted { $0.name.count > $1.name.count }
        let chars = Array(text)
        var ranges: [MentionRange] = []
        var at = 0
        while at < chars.count {
            defer { at += 1 }
            guard chars[at] == "@", isBoundary(chars, at: at) else { continue }
            let rest = chars[(at + 1)...]
            func matches(_ name: String) -> Bool {
                let nameChars = Array(name)
                guard rest.count >= nameChars.count else { return false }
                let slice = String(rest.prefix(nameChars.count))
                guard slice.lowercased() == name.lowercased() else { return false }
                let next = rest.dropFirst(nameChars.count).first
                return !continues(next)
            }
            let all = everyone && matches("everyone")
            let peer = all ? nil : candidates.first { matches($0.name) }
            guard all || peer != nil else { continue }
            let length = all ? 8 : peer!.name.count
            let name = all ? nil : peer?.color.flatMap { MausColors.hex[$0] != nil ? $0 : nil }
            ranges.append(MentionRange(start: at, end: at + length + 1, colorName: name))
            at += length
        }
        return ranges
    }
}

// MARK: - Routed by (GroupView.tsx RoutedByLine)

public extension RoutedBy {
    /// The decision model's confidence as a whole percent, clamped to 0...100.
    var percent: Int { Int((min(1, max(0, probability)) * 100).rounded()) }
}

// MARK: - Which actions a message offers (ChatView.tsx Bubble, GroupView.tsx)

public enum MessageActionRules {
    /// `lastBotTextId`: the newest bot text line. Regenerate hangs on it.
    public static func lastBotTextId(in messages: [Message]) -> String? {
        messages.last { $0.role == .bot && $0.kind == .text }?.id
    }

    /// `regenerate`: the newest user text line the person wrote (not a
    /// peer's), re-sent with the same words through the edit route, so the
    /// old answer stays reachable with ‹ ›. Nil when there is none to fork,
    /// or when it carries attachments the edit route cannot rebuild.
    public static func regenerateSource(in messages: [Message], pendingId: String? = nil) -> Message? {
        guard let last = messages.last(where: { $0.role == .user && $0.kind == .text && PeerLine.parse($0) == nil }),
              let text = last.text, !text.isEmpty, last.id != pendingId
        else { return nil }
        let attached = AttachedMessageContent.parse(text)
        guard attached.attachments.isEmpty, last.webhookContent == nil else { return nil }
        return last
    }

    /// Regenerate shows on the newest bot text line of a bot chat whose turn
    /// is over, when a user line exists to fork.
    public static func canRegenerate(_ message: Message, in messages: [Message], busy: Bool, pendingId: String? = nil) -> Bool {
        !busy && message.id == lastBotTextId(in: messages) && regenerateSource(in: messages, pendingId: pendingId) != nil
    }

    /// Reply and pin take text lines, as on the desktop (both sides).
    public static func canQuote(_ message: Message) -> Bool { message.kind == .text }

    /// Speak reads a bot's own text, never a peer's relayed line.
    public static func canSpeak(_ message: Message) -> Bool {
        message.role == .bot && message.kind == .text && !(message.text ?? "").isEmpty
    }

    /// View source toggles a bot reply between markdown and its source.
    public static func canViewSource(_ message: Message) -> Bool {
        message.role == .bot && !(message.text ?? "").isEmpty
    }
}

// MARK: - Pinned banner (ChatView.tsx PinnedBanner)

public struct PinnedPreview: Equatable, Sendable {
    public var messageId: String
    public var author: ReplyPreview.Author
    /// One line: citations as their quote, whitespace folded.
    public var text: String

    /// The pin resolved against the loaded transcript. A pin that no longer
    /// resolves (edited away, deleted, not loaded) or names a non-text line
    /// draws nothing.
    public static func resolve(_ pinnedId: String?, in messages: [Message], fallbackName: String?) -> PinnedPreview? {
        guard let pinnedId, !pinnedId.isEmpty,
              let pinned = messages.first(where: { $0.id == pinnedId }), pinned.kind == .text
        else { return nil }
        let text = Citations.previewText(ReplyPreview.source(of: pinned))
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        guard !text.isEmpty else { return nil }
        return PinnedPreview(
            messageId: pinned.id,
            author: ReplyPreview.author(of: pinned, fallbackName: fallbackName),
            text: text
        )
    }
}

// MARK: - Bot thread pin

public extension Bot {
    /// The message pinned to the shown thread: the task's own pin, or the
    /// bot's mirror of its active task when the computer sent no tasks.
    var pinnedMessageIdForShownThread: String? {
        if let task = tasks?.first(where: { $0.threadId == threadId }) { return task.pinnedMessageId }
        return pinnedMessageId
    }
}

// MARK: - Requests

/// `POST /api/tts/prepare`: whether the computer can speak, and the text cut
/// into the utterances it will render (`src/lib/tts`).
public struct SpeechPreparation: Decodable, Equatable, Sendable {
    public var ready: Bool
    public var utterances: [String]

    private enum CodingKeys: String, CodingKey { case ready, utterances }

    public init(ready: Bool, utterances: [String]) {
        self.ready = ready
        self.utterances = utterances
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        ready = try values.decodeIfPresent(Bool.self, forKey: .ready) ?? false
        utterances = try values.decodeIfPresent([String].self, forKey: .utterances) ?? []
    }
}

public extension CompanionClient {
    /// `PATCH /api/bots/:id/tasks/:threadId {pinnedMessageId}`: one pin per
    /// thread; nil sends "" which clears it.
    func setPinnedMessageRequest(botId: String, threadId: String, messageId: String?) throws -> URLRequest {
        guard Self.validRouteID(botId), Self.validRouteID(threadId) else { throw APIError.badURL }
        if let messageId, !Self.validRouteID(messageId) { throw APIError.badURL }
        return try makeRequest("PATCH", "/api/bots/\(botId)/tasks/\(threadId)", body: ["pinnedMessageId": messageId ?? ""])
    }

    /// `PATCH /api/groups/:id {pinnedMessageId}`: one pin per room, the
    /// desktop's `patchGroup`.
    func setPinnedMessageRequest(groupId: String, messageId: String?) throws -> URLRequest {
        guard Self.validRouteID(groupId) else { throw APIError.badURL }
        if let messageId, !Self.validRouteID(messageId) { throw APIError.badURL }
        return try makeRequest("PATCH", "/api/groups/\(groupId)", body: ["pinnedMessageId": messageId ?? ""])
    }

    func setPinnedMessage(botId: String, threadId: String, messageId: String?) async throws {
        try await send(setPinnedMessageRequest(botId: botId, threadId: threadId, messageId: messageId))
    }

    func setPinnedMessage(groupId: String, messageId: String?) async throws -> Room {
        try await send(setPinnedMessageRequest(groupId: groupId, messageId: messageId), as: GroupResponse.self).group
    }

    func prepareSpeechRequest(text: String, voiceId: String?) throws -> URLRequest {
        var body: [String: Any] = ["text": text]
        if let voiceId, !voiceId.isEmpty { body["voiceId"] = voiceId }
        return try makeRequest("POST", "/api/tts/prepare", body: body)
    }

    func speechRequest(text: String, voiceId: String?) throws -> URLRequest {
        var body: [String: Any] = ["text": text]
        if let voiceId, !voiceId.isEmpty { body["voiceId"] = voiceId }
        var request = try makeRequest("POST", "/api/tts/speak", body: body)
        // A long utterance takes the provider a while to render.
        request.timeoutInterval = 60
        return request
    }

    /// Whether the computer's voice can read this, and its utterances.
    func prepareSpeech(text: String, voiceId: String?) async throws -> SpeechPreparation {
        try await send(prepareSpeechRequest(text: text, voiceId: voiceId), as: SpeechPreparation.self)
    }

    /// One utterance rendered by the computer's voice provider (audio bytes).
    func speech(text: String, voiceId: String?) async throws -> Data {
        let (data, response) = try await perform(speechRequest(text: text, voiceId: voiceId))
        try Self.check(response, data)
        return data
    }
}
