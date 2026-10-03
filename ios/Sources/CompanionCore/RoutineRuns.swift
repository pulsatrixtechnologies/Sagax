// Routine runs as the desktop's Automations page treats them (matrix AU6,
// AU8-AU10, AU15): which runs need attention, the logs' status filter and
// search, the bot filter, cancel and seen, and where a routine's results go.
//
// Desktop: src/components/RoutineCalendarPage.tsx (RoutinesPage, EventDetails),
// src/components/routines/RoutineLogs.tsx, ResultsDestination.tsx,
// shared/routines.ts (`isRoutineProblemRun`), src/lib/routine-display.ts.
import Foundation

public extension RoutineRun {
    /// `isRoutineProblemRun`: failed or missed.
    var isProblem: Bool { status == "failed" || status == "missed" }
    /// A problem nobody has looked at yet: the red dot and the badge.
    var isUnseenProblem: Bool { isProblem && seenAt == nil }
    /// Queued, running or waiting: "Cancel run" applies.
    var isActive: Bool { ["queued", "running", "waiting"].contains(status) }
    /// `routineRunTime`: the logs' sort key.
    var logTime: Double {
        if createdAt != 0 { return createdAt }
        if let startedAt, startedAt != 0 { return startedAt }
        return scheduledFor
    }
    /// "schedule", "manual" or "webhook" (`routines.trigger.*`).
    var trigger: String { triggerSource ?? (manual ? "manual" : "schedule") }
    /// What a team-goal run's label says instead of the run status.
    var labelKey: String { goalStatus.map { "goal.\($0)" } ?? "status.\(status)" }
    /// The text a log row previews: what it waits on, the error, the output.
    var preview: String? {
        for text in [attention, error, output] {
            if let text, !text.isEmpty { return text }
        }
        return nil
    }
}

/// The logs' status picker (`RoutineRunStatusFilter`).
public enum RoutineRunStatusFilter: Hashable, Sendable {
    case all
    case problems
    case status(String)

    /// The order the desktop lists them in.
    public static let statuses = ["queued", "running", "waiting", "completed", "failed", "missed", "cancelled"]
    public static let allCases: [RoutineRunStatusFilter] = [.all, .problems] + statuses.map { .status($0) }

    public func matches(_ run: RoutineRun) -> Bool {
        switch self {
        case .all: true
        case .problems: run.isProblem
        case let .status(status): run.status == status
        }
    }
}

public enum RoutineRunLog {
    /// `RoutineLogs`: one routine's runs or all, the status filter, a search
    /// over the routine, bot, output, error and question; newest first.
    public static func filter(
        _ runs: [RoutineRun], bots: [Bot], routineId: String? = nil,
        status: RoutineRunStatusFilter = .all, query: String = ""
    ) -> [RoutineRun] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return runs.filter { run in
            guard routineId == nil || run.routineId == routineId, status.matches(run) else { return false }
            guard !needle.isEmpty else { return true }
            let botName = bots.first { $0.id == run.botId }?.name ?? ""
            let haystack = "\(run.routineName) \(botName) \(run.output ?? "") \(run.error ?? "") \(run.attention ?? "")"
            return haystack.lowercased().contains(needle)
        }
        .sorted { $0.logTime > $1.logTime }
    }

    /// The badge beside "Run logs" and on the toolbar.
    public static func unseenProblems(_ runs: [RoutineRun]) -> Int {
        runs.filter(\.isUnseenProblem).count
    }

    /// Runs still going, the "N active" pill.
    public static func active(_ runs: [RoutineRun]) -> Int {
        runs.filter(\.isActive).count
    }

    /// Fold the server's answer to cancel or seen into the list.
    public static func replacing(_ runs: [RoutineRun], with updated: [RoutineRun]) -> [RoutineRun] {
        let byId = Dictionary(updated.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
        return runs.map { byId[$0.id] ?? $0 }
    }
}

/// The "Filter schedule by bot" picker (AU6): nil is "All bots".
public struct RoutineBotFilter: Hashable, Sendable {
    public var botId: String?
    public init(botId: String? = nil) { self.botId = botId }

    public func routines(_ routines: [Routine]) -> [Routine] {
        guard let botId else { return routines }
        return routines.filter { $0.botId == botId }
    }

    public func runs(_ runs: [RoutineRun]) -> [RoutineRun] {
        guard let botId else { return runs }
        return runs.filter { $0.botId == botId }
    }
}

public extension Routine {
    /// `RoutineList`'s order: active first, then the next run, then the name.
    static func listOrder(_ a: Routine, _ b: Routine) -> Bool {
        if a.enabled != b.enabled { return a.enabled }
        let left = a.nextRunAt ?? .infinity
        let right = b.nextRunAt ?? .infinity
        if left != right { return left < right }
        return a.name.localizedCompare(b.name) == .orderedAscending
    }

    var isTeamGoal: Bool { target == "room-goal" }
}

// MARK: - Results thread (AU14, AU15)

public enum RoutineResults {
    /// `EventDetails`: the results thread (or the chat it was asked from),
    /// when that conversation still exists.
    public static func openTarget(
        resultsThreadId: String?, sourceThreadId: String?, botId: String, bots: [Bot], rooms: [Room]
    ) -> NotificationTarget? {
        guard let threadId = resultsThreadId ?? sourceThreadId else { return nil }
        let exists = bots.contains { $0.threadId == threadId || ($0.tasks ?? []).contains { $0.threadId == threadId } }
            || rooms.contains { $0.threadId == threadId || ($0.tasks ?? []).contains { $0.threadId == threadId } }
        return exists ? NotificationTarget(botId: botId, threadId: threadId) : nil
    }

    public static func openTarget(for routine: Routine, bots: [Bot], rooms: [Room]) -> NotificationTarget? {
        openTarget(resultsThreadId: routine.resultsThreadId, sourceThreadId: routine.sourceThreadId,
                   botId: routine.botId, bots: bots, rooms: rooms)
    }

    public static func openTarget(for run: RoutineRun, routine: Routine?, bots: [Bot], rooms: [Room]) -> NotificationTarget? {
        openTarget(resultsThreadId: run.resultsThreadId ?? routine?.resultsThreadId,
                   sourceThreadId: run.sourceThreadId ?? routine?.sourceThreadId,
                   botId: run.botId, bots: bots, rooms: rooms)
    }

    /// One folder of the "Post results to" picker.
    public struct Group: Hashable, Sendable {
        /// The folder's name; nil for threads outside any folder.
        public var folder: String?
        public var threads: [BotTask]
    }

    /// `ResultsDestination`: the bot's own conversations (never a run's
    /// execution thread), by folder, the unfiled ones last.
    public static func groups(for bot: Bot?) -> [Group] {
        guard let bot else { return [] }
        let tasks = (bot.tasks ?? []).filter { $0.routineRunId == nil }
        let projects = bot.projects ?? []
        var out: [Group] = projects.compactMap { project in
            let members = tasks.filter { $0.projectId == project.id }
            return members.isEmpty ? nil : Group(folder: project.name, threads: members)
        }
        let loose = tasks.filter { task in !projects.contains { $0.id == task.projectId } }
        if !loose.isEmpty { out.append(Group(folder: nil, threads: loose)) }
        return out
    }

    /// The chosen thread is no longer one of the bot's conversations.
    public static func isMissing(_ destination: RoutineResultsDestination, bot: Bot?) -> Bool {
        guard case let .thread(id) = destination else { return false }
        return !groups(for: bot).contains { $0.threads.contains { $0.threadId == id } }
    }
}

// MARK: - Team goal (AU14)

public enum RoutineTeamGoal {
    /// Rooms that can run a goal: not a direct conversation.
    public static func rooms(_ rooms: [Room]) -> [Room] {
        rooms.filter { $0.dm != true }
    }

    /// A room's members that can lead: its bots, not hidden.
    public static func members(of room: Room?, bots: [Bot]) -> [Bot] {
        guard let room else { return [] }
        return room.memberIds.compactMap { id in
            bots.first { $0.id == id && $0.hidden != true }
        }
    }

    /// `preferredRoomLead`: the current bot if it is a member, else the
    /// room's chosen responder, its chief of staff, or its first member.
    public static func preferredLead(of room: Room?, bots: [Bot], preferredId: String?) -> Bot? {
        let members = members(of: room, bots: bots)
        let explicit = room?.defaultResponder.kind == "member" ? room?.defaultResponder.botId : nil
        return members.first { $0.id == preferredId }
            ?? members.first { $0.id == explicit }
            ?? members.first { $0.chiefOfStaff == true }
            ?? members.first
    }
}

// MARK: - Calls

public extension CompanionClient {
    /// Stop a queued, running or waiting run (`POST /api/routine-runs/:id/cancel`).
    func cancelRoutineRun(id: String) async throws -> RoutineRun {
        try await send(try makeRequest("POST", "/api/routine-runs/\(id)/cancel"), as: RoutineRunResponse.self).run
    }

    /// Acknowledge one run (`POST /api/routine-runs/:id/seen`).
    func markRoutineRunSeen(id: String) async throws -> RoutineRun {
        try await send(try makeRequest("POST", "/api/routine-runs/\(id)/seen"), as: RoutineRunResponse.self).run
    }

    /// "Mark all as read" (`POST /api/routine-runs/seen-all`): the runs it changed.
    func markAllRoutineRunsSeen() async throws -> [RoutineRun] {
        try await send(try makeRequest("POST", "/api/routine-runs/seen-all"), as: RoutineRunsResponse.self).runs
    }
}

struct RoutineRunsResponse: Codable, Sendable { var runs: [RoutineRun] }
