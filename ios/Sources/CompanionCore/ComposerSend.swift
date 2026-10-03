// What a send does beyond its words (feature parity matrix CO5, CO14, CO15,
// CO17, RM5): the busy-send choice (src/components/BusySendChooser.tsx,
// shared/parallel-tasks.ts), long pastes held as chips
// (src/lib/composer-attachments.ts), a failed send kept for Retry
// (Composer.tsx `retryFailedSend`), and Steer on held sends
// (src/components/ComposerQueuedMessages.tsx).
import Foundation

// MARK: - Busy send

public enum BusySendChoice {
    /// `BUSY_SEND_ORDER`: the order the chooser lists the choices in.
    public static let order: [BusySendMode] = [.steer, .parallel, .after]

    /// Words that read as a change to the running work (`STEER_HINTS`).
    static let steerHints = [
        // fr
        "arrête", "arrete", "stop", "plutôt", "plutot", "attends", "non,", "non ", "aussi", "en fait", "oublie", "change", "corrige", "continue", "au lieu",
        // en
        "instead", "wait", "also", "actually", "don't", "dont", "cancel", "rather", "keep going", "use ", "no,",
    ]

    /// `suggestBusySendMode`: a short correction reads as a steer; anything
    /// else as unrelated work, which runs in parallel.
    public static func suggest(_ text: String) -> BusySendMode {
        let words = text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !words.isEmpty else { return .steer }
        let short = words.count <= 60
        if short, steerHints.contains(where: { words.hasPrefix($0) || words.contains(" \($0)") }) { return .steer }
        return .parallel
    }

    /// `moveBusyChoice`: the next highlighted choice for an arrow key.
    public static func move(_ current: BusySendMode, by delta: Int) -> BusySendMode {
        let index = order.firstIndex(of: current) ?? 0
        let count = order.count
        return order[((index + delta) % count + count) % count]
    }

    /// `offersBusyChoice`: a one-to-one conversation that is working. A room
    /// and a voice call never ask (their words join the running turn).
    public static func offered(for chat: Chat, onCall: Bool = false) -> Bool {
        guard case let .bot(bot) = chat else { return false }
        return bot.busy == true && !onCall
    }
}

// MARK: - Long paste

/// A long paste held as a chip instead of burying the field (`PasteAttachment`).
public struct PastedText: Identifiable, Hashable, Sendable {
    /// `PASTE_CHARS` and `PASTE_LINES`.
    public static let longCharacters = 900
    public static let longLines = 12

    public let id: UUID
    public let text: String

    public init(id: UUID = UUID(), text: String) {
        self.id = id
        self.text = text
    }

    public var lines: Int { text.components(separatedBy: "\n").count }
    public var bytes: Int { text.utf8.count }

    /// `isLongPaste`.
    public static func isLong(_ text: String) -> Bool {
        text.count >= longCharacters || text.components(separatedBy: "\n").count >= longLines
    }

    /// `pasteSummary`: "14 lines, 1.2 KB".
    public var summary: String {
        "\(lines) lines, \(Self.formatSize(bytes))"
    }

    /// `formatSize`.
    public static func formatSize(_ bytes: Int) -> String {
        if bytes < 1024 { return "\(bytes) B" }
        if bytes < 1024 * 1024 { return String(format: "%.1f KB", Double(bytes) / 1024) }
        return String(format: "%.1f MB", Double(bytes) / (1024 * 1024))
    }

    /// `appendPastedText`: the chip's words moved back into the field.
    public static func appending(_ pasted: String, to text: String) -> String {
        if text.isEmpty { return pasted }
        return "\(text)\(text.hasSuffix("\n") ? "" : "\n\n")\(pasted)"
    }

    /// `composeMessage` for pasted text: the typed words, then one tagged
    /// block per paste, numbered in order.
    public static func compose(_ text: String, pastes: [PastedText]) -> String {
        var parts = [text.trimmingCharacters(in: .whitespacesAndNewlines)]
        for (index, paste) in pastes.enumerated() {
            parts.append("<pasted-text index=\"\(index + 1)\">\n\(paste.text)\n</pasted-text>")
        }
        return parts.filter { !$0.isEmpty }.joined(separator: "\n\n")
    }

    /// The pasted run when a single edit of the draft inserted a long block
    /// (the field's paste, which the phone cannot intercept): the inserted
    /// text and the draft without it. Nil for ordinary typing.
    public static func detect(old: String, new: String) -> (pasted: String, remaining: String)? {
        let a = Array(old), b = Array(new)
        guard b.count > a.count else { return nil }
        var prefix = 0
        while prefix < a.count, a[prefix] == b[prefix] { prefix += 1 }
        var suffix = 0
        while suffix < a.count - prefix, a[a.count - 1 - suffix] == b[b.count - 1 - suffix] { suffix += 1 }
        let inserted = String(b[prefix..<(b.count - suffix)])
        guard isLong(inserted) else { return nil }
        // replacing a selection keeps what was around it
        let remaining = String(b[0..<prefix]) + String(b[(b.count - suffix)...])
        return (inserted, remaining)
    }
}

// MARK: - Failed send

/// A send the computer refused or never answered (`FailedComposerSend`):
/// shown above the field with Retry and Dismiss. Retry sends exactly this
/// again: the same words, attachments, quote and busy choice.
public struct FailedSend: Identifiable, Hashable, Sendable {
    public let id: UUID
    /// What the person wrote (the banner's quote).
    public var text: String
    /// The text as sent, with pastes and thread links folded in.
    public var requestText: String
    public var attachments: [PendingMessageAttachment]
    public var replyToId: String?
    public var busyMode: BusySendMode?
    public var goal: Bool
    public var threadId: String
    public var error: String

    public init(
        id: UUID = UUID(),
        text: String,
        requestText: String,
        attachments: [PendingMessageAttachment] = [],
        replyToId: String? = nil,
        busyMode: BusySendMode? = nil,
        goal: Bool = false,
        threadId: String,
        error: String
    ) {
        self.id = id
        self.text = text
        self.requestText = requestText
        self.attachments = attachments
        self.replyToId = replyToId
        self.busyMode = busyMode
        self.goal = goal
        self.threadId = threadId
        self.error = error
    }

    /// The banner's quote: the words, or "attachment" for a send without any.
    public var quote: String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    public var options: SendOptions {
        SendOptions(replyToId: replyToId, busyMode: busyMode, goal: goal)
    }
}

// MARK: - Steer held sends

public enum QueueSteer {
    /// `composerCanSteerQueuedMessages`: Steer is offered while the
    /// conversation works, has held sends and no approval waits.
    public static func available(busy: Bool, queued: Int, approvalPending: Bool) -> Bool {
        busy && !approvalPending && queued > 0
    }

    /// The label on the head row: one held send steers alone; a bot's
    /// queue steers all of them at once, a room's the next one.
    public enum Label: Hashable, Sendable {
        case steer, steerAll, steerNext, steering
    }

    public static func label(count: Int, isRoom: Bool, steering: Bool) -> Label {
        if steering { return .steering }
        if count > 1 { return isRoom ? .steerNext : .steerAll }
        return .steer
    }

    /// What pressing Steer does (`steerQueued`): an engine that steers live
    /// folds the words in through the queue's steer route; one that cannot
    /// ends the running turn so the queue starts next.
    public enum Action: Hashable, Sendable {
        case steerRoute
        case interrupt
    }

    /// `canSteer` is unknown (nil) until the engine list is read: the
    /// route then decides (it answers `queued` when the engine cannot).
    public static func action(canSteer: Bool?) -> Action {
        canSteer == false ? .interrupt : .steerRoute
    }
}

/// The steer route's answer (`POST .../queue/:q/steer`).
public struct QueueSteerResult: Decodable, Hashable, Sendable {
    public var ok: Bool?
    /// The words joined the running turn.
    public var steered: Bool?
    /// The engine could not take them: they stay held.
    public var queued: Bool?
    public var threadId: String?
    public var messages: [Message]?
    /// The held entries the steer carried (a room's coalesced burst too).
    public var queueIds: [String]?

    public init(ok: Bool? = true, steered: Bool? = nil, queued: Bool? = nil, threadId: String? = nil, messages: [Message]? = nil, queueIds: [String]? = nil) {
        self.ok = ok
        self.steered = steered
        self.queued = queued
        self.threadId = threadId
        self.messages = messages
        self.queueIds = queueIds
    }

    private enum CodingKeys: String, CodingKey { case ok, steered, queued, threadId, messages, queueIds }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        ok = try? c.decodeIfPresent(Bool.self, forKey: .ok)
        steered = try? c.decodeIfPresent(Bool.self, forKey: .steered)
        queued = try? c.decodeIfPresent(Bool.self, forKey: .queued)
        threadId = try? c.decodeIfPresent(String.self, forKey: .threadId)
        messages = ((try? c.decodeIfPresent([Lossy<Message>].self, forKey: .messages)) ?? nil)?.compactMap(\.value)
        queueIds = try? c.decodeIfPresent([String].self, forKey: .queueIds)
    }
}

// MARK: - Engine capabilities

/// What an engine instance can do, as `GET /api/instances` reports it.
public struct EngineAbilities: Decodable, Hashable, Sendable {
    public var images: Bool?
    /// Mounts the agents tools (`/learn`, `/setup`).
    public var agentsMcp: Bool?
    /// Takes words into a running turn (live steer).
    public var queueing: Bool?

    public init(images: Bool? = nil, agentsMcp: Bool? = nil, queueing: Bool? = nil) {
        self.images = images
        self.agentsMcp = agentsMcp
        self.queueing = queueing
    }
}
