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
// - While the bot works in silence, a short progress line built from the
//   turn's real tool events is said, rate-limited (CallProgress). A room
//   still reads its members' narrated tool steps.
import Foundation

/// A sentence the call says on its own, worded by the app (localized).
public enum CallPrompt: Equatable, Sendable {
    public enum ApprovalKind: Equatable, Sendable { case command, skill, routine, profile }
    case approval(requester: String, kind: ApprovalKind, tool: String, title: String, detail: String, updating: Bool)
    case question(requester: String, subtitle: String, options: [String])
    /// Not one of the two options: "allow once, or deny?" again.
    case allowOnceOrDeny
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
        /// a narrated tool step while a room's member works
        case narrate(String, speakerId: String?)
        /// a short progress line while the bot works in silence (CallProgress)
        case progress(CallProgressLine)
        /// a short spoken update for an older topic that just finished
        case announce(String, speakerId: String?)
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
    /// thinking barge-in has no cut prefix: ignore live until it goes empty
    private var waitForClear = false
    /// answers cut by the person (the transcript marks them)
    public private(set) var interrupted: Set<String> = []
    /// the cut answers' words the person never heard, by reply id
    public private(set) var unheard: [String: String] = [:]
    /// the last cut's unheard words: they go on the reply it cut, once settled
    private var lastCutUnheard: String?
    /// a room: every member's reply is spoken in turn, nothing streams
    public let room: Bool
    /// short progress lines from the turn's tool events (one bot only)
    private var progress = CallProgress()
    /// milliseconds, injectable for tests
    public var clock: @Sendable () -> Double = { Date().timeIntervalSince1970 * 1000 }

    public init(existing: [Message], room: Bool = false) {
        spoken = Set(existing.map(\.id))
        self.room = room
    }

    /// A sibling parallel card: barge-in drops speech, not that work. The
    /// call thread's own tool chip is the current turn and still cancels.
    public static func hasBackgroundWork(_ messages: [Message]) -> Bool {
        messages.contains { message in
            if let task = message.parallelTask, task.isCard, task.state == "running" || task.state == "queued" { return true }
            return false
        }
    }

    public static func topicLabel(_ text: String) -> String {
        let line = text.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if line.count <= 48 { return line }
        let end = line.index(line.startIndex, offsetBy: 45, limitedBy: line.endIndex) ?? line.endIndex
        return String(line[..<end]).trimmingCharacters(in: .whitespaces) + "..."
    }

    public static func announceTopic(label: String, result: String) -> String {
        let clip = result.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if clip.count <= 160 { return "For \(label): \(clip)" }
        let end = clip.index(clip.startIndex, offsetBy: 157, limitedBy: clip.endIndex) ?? clip.endIndex
        return "For \(label): \(String(clip[..<end]).trimmingCharacters(in: .whitespaces))..."
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

    /// An approval or option card being answered by voice keeps its turn.
    public func mayInterruptBot(busy: Bool) -> Bool { askedApproval == nil && askedQuestion == nil && busy }

    public var awaitingDecision: Bool { askedApproval != nil || askedQuestion != nil }

    // MARK: - The stream

    /// The live text to feed the call's reply, or nil (cut, or nothing).
    public mutating func stream(_ live: String?) -> String? {
        let accepted = acceptStream(live)
        // the bot's own words are being said: no quick progress line now
        if let accepted, !accepted.isEmpty { progress.heard(now: clock()) }
        return accepted
    }

    private mutating func acceptStream(_ live: String?) -> String? {
        guard !room else { return nil }
        if live == nil || live?.isEmpty == true {
            if waitForClear { waitForClear = false }
            return nil
        }
        let live = live!
        if waitForClear { return nil }
        // the cut block keeps streaming until the server stops it: not spoken
        if let cut = dropStream, !cut.isEmpty {
            if live.count >= min(cut.count, 16) && live.hasPrefix(String(cut.prefix(16))) { return nil }
            dropStream = nil
            dropOldReply = false
            waitForClear = false
            return live
        }
        if dropOldReply {
            dropOldReply = false
            dropStream = nil
            waitForClear = false
            return live
        }
        return live
    }

    /// The bot's speech was cut: the rest of that answer is not spoken.
    public mutating func speechCancelled(currentStream: String?, cut: PlaybackCut? = nil) {
        progress.stop()
        if let unheard = cut?.unheard, !unheard.isEmpty { lastCutUnheard = unheard }
        dropOldReply = true
        dropStream = currentStream ?? ""
        waitForClear = (dropStream ?? "").isEmpty
    }

    /// The bot's running turn is being stopped: what it still streams is
    /// never spoken.
    public mutating func botInterrupted(currentStream: String?) {
        progress.stop()
        dropOldReply = true
        dropStream = currentStream ?? dropStream ?? ""
        waitForClear = (dropStream ?? "").isEmpty
    }

    // MARK: - What the person said

    public mutating func utterance(_ said: String, memberNames: [String] = [], mentionsOnly: Bool = false) -> UtteranceAction {
        if let open = askedApproval, !open.submitted {
            if let allow = CallAnswers.decision(said) {
                if allow && open.skill { return .say(.skillReview) }
                askedApproval?.submitted = true
                return .decide(requestId: open.requestId, allow: allow)
            }
            return .say(.allowOnceOrDeny)
        }
        if let question = askedQuestion {
            askedQuestion = nil
            return .answer(requestId: question.requestId, messageId: question.messageId, text: said)
        }
        // a new turn keeps the drop: a dying answer that lands after this
        // send is still the cut turn, never spoken
        guard room else {
            progress.turnSent(now: clock())
            return .send(said)
        }
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
    public mutating func settle(messages: [Message], botName: String, thinking: Bool, playerBusy: Bool, duplex: Bool = false, botBusy: Bool = true) -> [SettleAction] {
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
        let lastUserId = lastUser >= 0 ? messages[lastUser].id : nil
        let replies = fresh.filter { $0.role == .bot && $0.kind == .text && !($0.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        var out: [SettleAction] = []
        for reply in replies {
            if room {
                out.append(.reply(reply.text ?? "", speakerId: reply.from?.botId))
                continue
            }
            // an answer from before the person's latest words (the turn they cut)
            let index = messages.firstIndex { $0.id == reply.id } ?? 0
            let sourceId = sourceUserId(messages: messages, reply: reply, index: index)
            let belongsToLatest = sourceId != nil && sourceId == lastUserId
            let cutContinuation: Bool = {
                guard let cut = dropStream, !cut.isEmpty, let text = reply.text else { return false }
                return text.hasPrefix(String(cut.prefix(16)))
            }()
            let thinkingDrop = dropOldReply && !belongsToLatest && (dropStream == nil || dropStream?.isEmpty == true)
            if cutContinuation || index < lastUser || thinkingDrop {
                interrupted.insert(reply.id)
                // the words of it the person never heard stay in the transcript, marked
                if let words = lastCutUnheard {
                    unheard[reply.id] = words
                    lastCutUnheard = nil
                }
                continue
            }
            dropOldReply = false
            dropStream = nil
            if let sourceId, let lastUserId, sourceId != lastUserId {
                let source = messages.first { $0.id == sourceId }
                let label = Self.topicLabel(source?.text ?? reply.parallelTask?.title ?? "the other thing")
                out.append(.announce(Self.announceTopic(label: label, result: reply.text ?? ""), speakerId: reply.from?.botId))
            } else {
                out.append(.replyDone(reply.text ?? "", speakerId: reply.from?.botId))
            }
        }
        if !replies.isEmpty { progress.heard(now: clock()) }
        if replies.isEmpty && room {
            if let chip = fresh.last(where: { $0.kind == .activity && !($0.tool?.spoken ?? "").isEmpty }),
               let line = chip.tool?.spoken {
                out.append(.narrate(line, speakerId: chip.from?.botId))
            }
        }
        if replies.isEmpty && !room, let line = progressLine(messages: messages, thinking: thinking, botBusy: botBusy, playerBusy: playerBusy) {
            out.append(.progress(line))
        }
        return out
    }

    /// The progress line due now, if any (CallProgress). The call asks on
    /// every change of the thread and on a short tick while the bot works.
    public mutating func progressLine(messages: [Message], thinking: Bool, botBusy: Bool, playerBusy: Bool) -> CallProgressLine? {
        guard !room else { return nil }
        let awaiting = (askedApproval.map { !$0.submitted } ?? false) || askedQuestion != nil
        return progress.next(
            now: clock(), thinking: thinking, botBusy: botBusy, botSpeaking: playerBusy,
            awaitingAnswer: awaiting, tools: CallProgress.turnTools(messages)
        )
    }

    private func sourceUserId(messages: [Message], reply: Message, index: Int) -> String? {
        if let id = reply.parallelTask?.requestMessageId, !id.isEmpty { return id }
        if let id = reply.requestMessageId, !id.isEmpty { return id }
        var i = index - 1
        while i >= 0 {
            let message = messages[i]
            if message.role == .user && message.parallelTask?.part != .request {
                return message.id
            }
            i -= 1
        }
        return nil
    }
}
