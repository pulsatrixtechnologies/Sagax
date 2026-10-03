// What a live call does with the conversation around it: the desktop's
// LiveCall (src/components/voice-mode/LiveCall.tsx) and, for rooms,
// GroupCallView, as pure state so every rule is unit-tested.
//
// The BOT answers, never the voice: every accepted turn is an ordinary
// message through the normal send route (the bot's engine, instructions,
// memory, tools, approvals, the transcript in the thread). The call only
// hears and reads the bot's own words aloud:
//
// - Everything already in the thread when the call starts has been read or
//   ignored: a call never opens by reciting the backlog.
// - The answer is spoken while it streams (sentence by sentence); its
//   settled message speaks only what the stream had not reached.
// - A barge-in cuts the answer: the rest of it, and the settled message of
//   that turn, are never spoken (and the transcript marks them interrupted).
// - An approval is asked aloud and answered yes or no; anything else is
//   "is that a yes or a no?", never consent. A question card is answered
//   with the next words said.
// - While the bot works with nothing to say, a narrated tool step is read.
import Foundation

/// A sentence the call says on its own, worded by the app (localized).
public enum CallPrompt: Equatable, Sendable {
    public enum ApprovalKind: Equatable, Sendable { case command, skill, routine, profile }
    case approval(requester: String, kind: ApprovalKind, tool: String, title: String, detail: String, updating: Bool)
    case question(requester: String, subtitle: String, options: [String])
    case yesOrNo
    case skillReview
    case approvalFailed
}

public struct CallConversation: Sendable {
    public enum UtteranceAction: Equatable, Sendable {
        /// answer the approval card
        case decide(requestId: String, allow: Bool)
        /// answer the question card with these words
        case answer(requestId: String, messageId: String, text: String)
        /// say this (not a decision)
        case say(CallPrompt)
        /// a new turn for the bot (a room: already routed)
        case send(String)
        /// a room whose turns go to named members: nobody was named
        case needsName
    }

    public enum SettleAction: Equatable, Sendable {
        case say(CallPrompt, speakerId: String?)
        /// the rest of an answer (what the stream had not spoken)
        case replyDone(String, speakerId: String?)
        /// a whole reply in a room, queued after the others
        case reply(String, speakerId: String?)
        /// a narrated tool step while the bot works
        case narrate(String, speakerId: String?)
    }

    private struct AskedApproval: Sendable { var requestId: String; var skill: Bool; var submitted: Bool }
    private struct AskedQuestion: Sendable { var requestId: String; var messageId: String }

    private var spoken: Set<String>
    private var askedApproval: AskedApproval?
    private var askedQuestion: AskedQuestion?
    /// after a barge-in: the old turn's words are not spoken (until a new answer)
    private var dropOldReply = false
    /// the streamed block that was cut: ignored until the stream starts over
    private var dropStream: String?
    /// answers cut by the person (the transcript marks them)
    public private(set) var interrupted: Set<String> = []
    /// the cut answers' words the person never heard, by reply id
    public private(set) var unheard: [String: String] = [:]
    /// the last cut's unheard words: they go on the reply it cut, once settled
    private var lastCutUnheard: String?
    /// a room: every member's reply is spoken in turn, nothing streams
    public let room: Bool

    public init(existing: [Message], room: Bool = false) {
        spoken = Set(existing.map(\.id))
        self.room = room
    }

    // MARK: - Cards

    public static func pendingApproval(_ messages: [Message]) -> Message? {
        messages.first {
            $0.kind == .options && $0.card?.requestId != nil && $0.card?.tool != nil
                && $0.card?.answered == nil && $0.card?.dismissed != true
        }
    }

    public static func pendingQuestion(_ messages: [Message]) -> Message? {
        messages.first {
            $0.kind == .options && $0.card?.requestId != nil && $0.card?.tool == nil
                && $0.card?.answered == nil && $0.card?.dismissed != true
        }
    }

    /// An approval being answered by voice keeps its turn: no interrupt then.
    public func mayInterruptBot(busy: Bool) -> Bool { askedApproval == nil && busy }

    public var awaitingDecision: Bool { askedApproval != nil || askedQuestion != nil }

    // MARK: - The stream

    /// The live text to feed the call's reply, or nil (cut, or nothing).
    public mutating func stream(_ live: String?) -> String? {
        guard !room else { return nil }
        guard let live, !live.isEmpty else {
            dropStream = nil
            return nil
        }
        // the cut block keeps streaming until the server stops it: not spoken
        if let cut = dropStream {
            if live.count >= cut.count && live.hasPrefix(String(cut.prefix(16))) { return nil }
            dropStream = nil
        }
        if dropOldReply { return nil }
        return live
    }

    /// The bot's speech was cut: the rest of that answer is not spoken.
    public mutating func speechCancelled(currentStream: String?, cut: PlaybackCut? = nil) {
        if let unheard = cut?.unheard, !unheard.isEmpty { lastCutUnheard = unheard }
        dropOldReply = true
        dropStream = currentStream ?? ""
    }

    /// The bot's running turn is being stopped: what it still streams is
    /// never spoken.
    public mutating func botInterrupted(currentStream: String?) {
        dropStream = currentStream ?? ""
    }

    // MARK: - What the person said

    public mutating func utterance(_ said: String, memberNames: [String] = [], mentionsOnly: Bool = false) -> UtteranceAction {
        if let open = askedApproval, !open.submitted {
            if CallAnswers.isYes(said) || CallAnswers.isNo(said) {
                let allow = CallAnswers.isYes(said)
                if allow && open.skill { return .say(.skillReview) }
                askedApproval?.submitted = true
                return .decide(requestId: open.requestId, allow: allow)
            }
            return .say(.yesOrNo)
        }
        if let question = askedQuestion {
            askedQuestion = nil
            return .answer(requestId: question.requestId, messageId: question.messageId, text: said)
        }
        // a new turn: what the interrupted answer had left is never spoken
        dropOldReply = false
        guard room else { return .send(said) }
        let routed = GroupCallRouting.route(said, memberNames: memberNames)
        if mentionsOnly && !routed.addressed { return .needsName }
        return .send(routed.text)
    }

    /// The decision could not be saved: ask again.
    public mutating func decisionFailed(requestId: String) -> CallPrompt? {
        guard askedApproval?.requestId == requestId else { return nil }
        askedApproval?.submitted = false
        return .approvalFailed
    }

    // MARK: - Settled messages

    /// What to say for messages that settled since the last call.
    /// `thinking`: the call rests in its thinking phase (narration allowed);
    /// `playerBusy`: something is already being said.
    public mutating func settle(messages: [Message], botName: String, thinking: Bool, playerBusy: Bool) -> [SettleAction] {
        let approval = Self.pendingApproval(messages)
        let question = Self.pendingQuestion(messages)
        if let asked = askedApproval, approval?.card?.requestId != asked.requestId { askedApproval = nil }
        if let asked = askedQuestion, question?.card?.requestId != asked.requestId { askedQuestion = nil }
        if let approval, let card = approval.card, let requestId = card.requestId, askedApproval?.requestId != requestId {
            let skill = card.skillRequest != nil
            askedApproval = AskedApproval(requestId: requestId, skill: skill, submitted: false)
            spoken.insert(approval.id)
            let requester = approval.from?.name ?? botName
            let kind: CallPrompt.ApprovalKind = skill ? .skill : .command
            return [.say(.approval(
                requester: requester, kind: kind, tool: card.tool ?? "", title: card.title,
                detail: card.subtitle, updating: card.skillRequest?.action == "update"
            ), speakerId: approval.from?.botId)]
        }
        if let question, let card = question.card, let requestId = card.requestId, askedQuestion?.requestId != requestId {
            askedQuestion = AskedQuestion(requestId: requestId, messageId: question.id)
            spoken.insert(question.id)
            let requester = question.from?.name ?? botName
            return [.say(.question(requester: requester, subtitle: card.subtitle, options: card.options), speakerId: question.from?.botId)]
        }
        let fresh = messages.filter { !spoken.contains($0.id) }
        guard !fresh.isEmpty else { return [] }
        for message in fresh { spoken.insert(message.id) }
        let lastUser = messages.lastIndex { $0.role == .user } ?? -1
        let replies = fresh.filter { $0.role == .bot && $0.kind == .text && !($0.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        var out: [SettleAction] = []
        for reply in replies {
            if room {
                out.append(.reply(reply.text ?? "", speakerId: reply.from?.botId))
                continue
            }
            // an answer from before the person's latest words (the turn they cut)
            let index = messages.firstIndex { $0.id == reply.id } ?? 0
            if dropOldReply || index < lastUser {
                interrupted.insert(reply.id)
                // the words of it the person never heard stay in the transcript, marked
                if let words = lastCutUnheard {
                    unheard[reply.id] = words
                    lastCutUnheard = nil
                }
                continue
            }
            out.append(.replyDone(reply.text ?? "", speakerId: reply.from?.botId))
        }
        if replies.isEmpty && (thinking || room) {
            if let chip = fresh.last(where: { $0.kind == .activity && !($0.tool?.spoken ?? "").isEmpty }),
               let line = chip.tool?.spoken, room || !playerBusy {
                out.append(.narrate(line, speakerId: chip.from?.botId))
            }
        }
        return out
    }
}
