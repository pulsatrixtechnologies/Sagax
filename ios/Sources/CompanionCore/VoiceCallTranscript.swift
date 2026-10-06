// One voice call is many ordinary messages. The thread draws them as a
// single card. A person line with voiceCall.callId opens the call; later
// bot text stays in it until the next person line that is not that call.
import Foundation

public struct SpokenLine: Hashable, Sendable {
    public var id: String
    public var role: Message.Role
    public var name: String?
    public var text: String

    public init(id: String, role: Message.Role, name: String? = nil, text: String) {
        self.id = id
        self.role = role
        self.name = name
        self.text = text
    }
}

public struct VoiceCallCardModel: Hashable, Sendable {
    public var callId: String
    public var anchorId: String
    public var messages: [Message]

    public init(callId: String, anchorId: String, messages: [Message]) {
        self.callId = callId
        self.anchorId = anchorId
        self.messages = messages
    }
}

struct VoiceCallFoldPlan {
    var hidden: Set<String>
    var cards: [String: VoiceCallCardModel]
    var callOf: [String: String]
    var byCall: [String: VoiceCallCardModel]
}

enum VoiceMessageFold {
    case keep
    case card(VoiceCallCardModel)
    case skip
}

private func personCallId(_ message: Message) -> String? {
    guard message.role == .user, message.kind == .text, message.peerAsk == nil else { return nil }
    let callId = message.voiceCall?.callId ?? ""
    return callId.isEmpty ? nil : callId
}

private func spokenBotText(_ message: Message) -> Bool {
    guard message.role == .bot, message.kind == .text, message.peerAsk == nil else { return false }
    return !(message.text?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true)
}

func makeVoiceCallPlan(_ messages: [Message]) -> VoiceCallFoldPlan {
    var hidden = Set<String>()
    var cards: [String: VoiceCallCardModel] = [:]
    var callOf: [String: String] = [:]
    var byCall: [String: VoiceCallCardModel] = [:]
    var current: String?

    func take(_ message: Message, callId: String) {
        var card = byCall[callId] ?? VoiceCallCardModel(callId: callId, anchorId: message.id, messages: [])
        card.messages.append(message)
        byCall[callId] = card
        cards[card.anchorId] = card
        hidden.insert(message.id)
        callOf[message.id] = callId
    }

    for message in messages {
        if message.role == .user {
            guard let callId = personCallId(message) else {
                current = nil
                continue
            }
            current = callId
            if !(message.text?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true) {
                take(message, callId: callId)
            }
            continue
        }
        if let current, spokenBotText(message) { take(message, callId: current) }
    }
    return VoiceCallFoldPlan(hidden: hidden, cards: cards, callOf: callOf, byCall: byCall)
}

func foldVoiceMessage(_ message: Message, plan: VoiceCallFoldPlan, seen: inout Set<String>) -> VoiceMessageFold {
    if let direct = plan.cards[message.id], !seen.contains(direct.callId) {
        seen.insert(direct.callId)
        return .card(direct)
    }
    guard let callId = plan.callOf[message.id] else { return .keep }
    if !seen.contains(callId), let card = plan.byCall[callId] {
        seen.insert(callId)
        return .card(card)
    }
    return .skip
}

public func spokenLines(_ messages: [Message]) -> [SpokenLine] {
    var lines: [SpokenLine] = []
    for message in messages {
        guard let raw = message.text?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty,
              message.role == .user || message.role == .bot, message.kind == .text else { continue }
        if message.role == .user, message.voiceCall?.continues == true, lines.last?.role == .user {
            let previous = lines.removeLast()
            lines.append(SpokenLine(id: message.id, role: .user, name: previous.name, text: raw))
            continue
        }
        let name = message.role == .bot ? message.from?.name : nil
        lines.append(SpokenLine(id: message.id, role: message.role, name: name, text: raw))
    }
    return lines
}

public struct VoiceCallClockSpan: Hashable, Sendable {
    public var startedAt: Double
    public var endedAt: Double?

    public init(startedAt: Double, endedAt: Double?) {
        self.startedAt = startedAt
        self.endedAt = endedAt
    }
}

/// m:ss, minutes padded (`00:34`). An hour or more is h:mm:ss.
public func formatVoiceCallDuration(_ ms: Double) -> String {
    let total = max(0, Int((ms / 1000).rounded()))
    let hours = total / 3600
    let minutes = (total % 3600) / 60
    let seconds = total % 60
    let mm = String(format: "%02d", minutes)
    let ss = String(format: "%02d", seconds)
    return hours > 0 ? "\(hours):\(mm):\(ss)" : "\(mm):\(ss)"
}

public func voiceCallDurationMs(_ messages: [Message], now: Double, clock: VoiceCallClockSpan?) -> Double {
    if let clock {
        if clock.endedAt == nil { return max(0, now - clock.startedAt) }
        if let ended = clock.endedAt { return max(0, ended - clock.startedAt) }
    }
    guard let first = messages.first?.at, let last = messages.last?.at else { return 0 }
    return max(0, last - first)
}

public func voiceCallTranscriptText(_ lines: [SpokenLine], you: String, bot: String) -> String {
    lines.map { line in
        let name = line.role == .user ? you : (line.name ?? bot)
        return "\(name): \(line.text)"
    }.joined(separator: "\n")
}
