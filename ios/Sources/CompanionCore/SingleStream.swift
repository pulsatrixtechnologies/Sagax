// One conversation per bot (threads hidden): the phone's copy of THE rule,
// shared/single-stream.ts, the same cases in shared/single-stream.vectors.json
// (SingleStreamTests). The server (WireBot.mainThreadId, where a routine's
// report, a peer's ask, a call or an AI client's work lands) and the desktop
// read the same rule, so every device opens the same conversation and
// nothing arrives "elsewhere".
//
// A bot's stream is its segments: the conversations a person had with it,
// oldest first. The newest segment is THE conversation: where the composer
// writes, where the bot opens, where everything lands. Earlier segments are
// its history, drawn above it. A thread outside the stream (a routine's run,
// a job a bot opened, a parallel task, a confidential thread) opens beside
// the conversation, never in its place.
import Foundation

public enum SingleStream {
    /// Whether a thread is a segment of its bot's stream (`isStreamSegment`):
    /// never a routine run, a results thread, a hidden AI-client
    /// conversation, a confidential thread, a bot-opened thread, a parallel
    /// task, an archived or a closed thread. An empty `routineRunId` reads
    /// as none, as the desktop's truthiness does.
    public static func isSegment(_ task: BotTask) -> Bool {
        (task.routineRunId ?? "").isEmpty && task.routineResults != true && task.hidden != true && task.confidential != true
            && task.openedBy == nil && task.parallelOf == nil && task.archivedAt == nil && task.closedBy == nil
    }

    /// The stream's segments, oldest first (the order the person reads);
    /// the thread id breaks a tie, the same way everywhere.
    public static func segments(_ tasks: [BotTask]?) -> [BotTask] {
        (tasks ?? []).filter(isSegment).sorted { a, b in
            a.createdAt != b.createdAt ? a.createdAt < b.createdAt : a.threadId < b.threadId
        }
    }

    /// THE conversation: the newest segment, empty or not (its history is
    /// drawn from the earlier segments, so an empty one never strands
    /// anybody). Nil when the person has no segment yet.
    public static func conversation(_ tasks: [BotTask]?) -> BotTask? {
        segments(tasks).last
    }

    public static func conversationThreadId(_ tasks: [BotTask]?) -> String? {
        conversation(tasks)?.threadId
    }

    /// The segments before `threadId`, oldest first; empty when it is not a
    /// segment (a thread outside the stream is shown alone).
    public static func earlierSegments(_ tasks: [BotTask]?, before threadId: String) -> [BotTask] {
        let all = segments(tasks)
        guard let at = all.firstIndex(where: { $0.threadId == threadId }) else { return [] }
        return Array(all[..<at])
    }

    /// Whether `threadId` is an earlier segment of the stream: a link, a
    /// notification or a search hit there opens the conversation at its end
    /// and brings that topic on screen, never a switch.
    public static func isEarlierSegment(_ tasks: [BotTask]?, _ threadId: String) -> Bool {
        guard let home = conversationThreadId(tasks), home != threadId else { return false }
        return earlierSegments(tasks, before: home).contains { $0.threadId == threadId }
    }

    /// Whether `threadId` is a thread of the bot outside its stream: it
    /// opens beside the conversation (a sheet), never in its place. False
    /// for a segment or an unknown thread.
    public static func opensBeside(_ tasks: [BotTask]?, _ threadId: String) -> Bool {
        guard let task = (tasks ?? []).first(where: { $0.threadId == threadId }) else { return false }
        return !isSegment(task)
    }

    /// Where the bot opens with threads hidden: the server's answer first
    /// (`WireBot.mainThreadId`, the same rule over every thread it knows),
    /// else this phone's over the threads it has; nil when the bot has no
    /// conversation (the caller keeps its older rule).
    public static func home(of bot: Bot) -> String? {
        if let main = bot.mainThreadId, let task = bot.tasks?.first(where: { $0.threadId == main }), isSegment(task) { return main }
        return conversationThreadId(bot.tasks)
    }

    /// The thread a way into `threadId` lands on, with threads hidden.
    public enum Landing: Equatable, Sendable {
        /// The conversation itself, or a bot with no conversation (the
        /// thread named is shown as it is): `thread` is what to open.
        case conversation(thread: String)
        /// An earlier topic: the conversation, brought to that topic.
        case earlier(home: String)
        /// A thread outside the stream: the conversation, that thread beside it.
        case beside(home: String)

        /// The thread the screen shows.
        public var shown: String {
            switch self {
            case let .conversation(thread), let .earlier(thread), let .beside(thread): return thread
            }
        }
    }

    public static func landing(of bot: Bot, threadId: String) -> Landing {
        guard let home = home(of: bot), home != threadId else { return .conversation(thread: home(of: bot) ?? threadId) }
        if isEarlierSegment(bot.tasks, threadId) { return .earlier(home: home) }
        if opensBeside(bot.tasks, threadId) { return .beside(home: home) }
        // a thread this phone does not know: the conversation
        return .conversation(thread: home)
    }
}
