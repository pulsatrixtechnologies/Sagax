// Routine runs on the phone (matrix AU8-AU10, AU15): a log row, the run's
// detail with Cancel run, Open thread and Open results thread, and the
// wording the desktop uses (src/components/routines/RoutineLogs.tsx,
// RoutineCalendarPage.tsx EventDetails, src/lib/routine-display.ts).
//
// Layout-agnostic: each view takes its data and reports what changed, so a
// list (iPhone) or a split view (a future iPad shell) can host it.
import CompanionCore
import SwiftUI

enum RoutineRunWording {
    /// `routineRunLabel`: a team goal's outcome, else the run status.
    static func label(_ run: RoutineRun) -> String { label(key: run.labelKey, fallback: run.status) }

    static func label(key: String, fallback: String) -> String {
        switch key {
        case "status.queued": String(localized: "Queued")
        case "status.running": String(localized: "Running")
        case "status.waiting": String(localized: "Waiting")
        case "status.completed", "goal.completed": String(localized: "Completed")
        case "status.failed", "goal.failed": String(localized: "Failed")
        case "status.cancelled": String(localized: "Cancelled")
        case "status.missed": String(localized: "Missed")
        case "goal.needs-input": String(localized: "Needs your input")
        case "goal.blocked": String(localized: "Blocked")
        case "goal.limit-reached": String(localized: "Turn limit reached")
        case "goal.paused": String(localized: "Paused")
        case "goal.stopped": String(localized: "Stopped")
        default: fallback.capitalized
        }
    }

    /// `routineRunTone`.
    static func tone(_ run: RoutineRun) -> Color {
        let goal = run.goalStatus ?? ""
        if run.status == "waiting" || ["needs-input", "limit-reached", "paused"].contains(goal) { return Theme.warning }
        if run.isProblem || ["failed", "blocked"].contains(goal) { return Theme.danger }
        if run.status == "running" { return Theme.accent }
        if run.status == "completed" && (run.goalStatus == nil || goal == "completed") { return Theme.success }
        return Theme.textSecondary
    }

    static func trigger(_ run: RoutineRun) -> String {
        switch run.trigger {
        case "manual": String(localized: "Manual")
        case "webhook": String(localized: "Webhook")
        default: String(localized: "Scheduled")
        }
    }

    static func status(_ filter: RoutineRunStatusFilter) -> String {
        switch filter {
        case .all: String(localized: "All statuses")
        case .problems: String(localized: "Problems")
        case let .status(status): label(key: "status.\(status)", fallback: status)
        }
    }

    /// `routineDateTime`: "Oct 3, 4:53 PM".
    static func date(_ ms: Double) -> String {
        Date(timeIntervalSince1970: ms / 1_000).formatted(.dateTime.month(.abbreviated).day().hour().minute())
    }
}

/// One run in the logs: routine, bot, when, how it started, its status, an
/// unseen-failure dot and the first lines of what it said.
struct RoutineLogRow: View {
    @Environment(\.themePalette) var themePalette
    let run: RoutineRun
    let bot: Bot?
    var showsUnseen = true

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top, spacing: 10) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(verbatim: run.routineName)
                        .font(Theme.Font.bodyMedium)
                        .foregroundStyle(Theme.textPrimary)
                        .lineLimit(1)
                    Text(verbatim: "\(bot?.name ?? String(localized: "Bot unavailable")) · \(RoutineRunWording.date(run.scheduledFor)) · \(RoutineRunWording.trigger(run))")
                        .font(Theme.Font.label)
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 8)
                HStack(spacing: 6) {
                    if showsUnseen && run.isUnseenProblem {
                        Circle().fill(Theme.danger).frame(width: 6, height: 6)
                            .accessibilityLabel(Text("Unseen failure"))
                            .accessibilityIdentifier("routine-run-unseen.\(run.id)")
                    }
                    Text(verbatim: RoutineRunWording.label(run))
                        .font(Theme.Font.labelMedium)
                        .foregroundStyle(RoutineRunWording.tone(run))
                }
            }
            Text(verbatim: run.preview ?? String(localized: "No output recorded yet."))
                .font(Theme.Font.preview)
                .foregroundStyle(run.error?.isEmpty == false && run.attention?.isEmpty != false ? Theme.danger : Theme.textSecondary)
                .lineLimit(2)
        }
        .padding(.vertical, 2)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("routine-run-row.\(run.id)")
    }
}

/// A run, opened from the logs or a routine's history. Opening a failed or
/// missed run marks it seen, as on the desktop.
struct RoutineRunDetailView: View {
    @Environment(\.themePalette) var themePalette
    @State var run: RoutineRun
    let routine: Routine?
    /// The run as the computer now has it (seen, cancelled).
    var onChange: (RoutineRun) -> Void = { _ in }

    @EnvironmentObject private var session: Session
    @Environment(\.dismiss) private var dismiss
    @State private var working = false

    var body: some View {
        NavigationStack {
            ThemedList {
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(verbatim: run.routineName).font(.headline)
                        Text(verbatim: "\(RoutineRunWording.date(run.scheduledFor)) · \(RoutineRunWording.trigger(run))")
                            .font(.caption).foregroundStyle(Theme.textSecondary)
                    }
                    HStack(spacing: 8) {
                        if run.status == "running" { ProgressView().controlSize(.small) }
                        Text(verbatim: RoutineRunWording.label(run))
                            .foregroundStyle(RoutineRunWording.tone(run))
                            .accessibilityIdentifier("routine-run-status")
                    }
                    if let bot = session.state.bot(run.botId) {
                        LabeledContent(run.target == "room-goal" ? String(localized: "Lead coordinator") : String(localized: "Assigned bot"), value: bot.name)
                    }
                    LabeledContent(String(localized: "Run limit"), value: run.timeoutMinutes.map { String(localized: "Stops if still running after \(RoutineDurations.label($0))") } ?? String(localized: "No time limit"))
                }

                if let attention = run.attention, !attention.isEmpty {
                    Section { Label(attention, systemImage: "exclamationmark.circle").foregroundStyle(Theme.warning) }
                } else if run.status == "waiting" {
                    Section { Text("This run is waiting. Open its execution thread for more context.").foregroundStyle(Theme.warning) }
                }
                if let output = run.output, !output.isEmpty {
                    Section { Text(verbatim: output).textSelection(.enabled).font(.subheadline) }
                }
                if let error = run.error, !error.isEmpty {
                    Section { Text(verbatim: error).textSelection(.enabled).font(.subheadline).foregroundStyle(Theme.danger) }
                }

                Section {
                    if let target = executionTarget {
                        Button(run.target == "room-goal" ? String(localized: "Open group thread") : String(localized: "Open thread"), systemImage: "arrow.up.right.square") {
                            open(target)
                        }
                        .accessibilityIdentifier("routine-run-open-thread")
                    }
                    if let target = RoutineResults.openTarget(for: run, routine: routine, bots: session.state.bots, rooms: session.state.rooms) {
                        Button(String(localized: "Open results thread"), systemImage: "arrow.up.right.square") { open(target) }
                            .accessibilityIdentifier("routine-run-open-results")
                    }
                    if run.isActive && session.surfaceGate.allows(.routineRunCancel) {
                        Button(String(localized: "Cancel run"), systemImage: "xmark", role: .destructive) {
                            Task { await cancel() }
                        }
                        .disabled(working)
                        .accessibilityIdentifier("routine-run-cancel")
                    }
                }
            }
            .navigationTitle(Text("Run"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(String(localized: "Done")) { dismiss() }
                }
            }
        }
        .task { await markSeen() }
    }

    private var executionTarget: NotificationTarget? {
        NotificationTarget(botId: run.botId, threadId: run.executionThreadId ?? run.threadId)
    }

    private func open(_ target: NotificationTarget) {
        dismiss()
        Task { await session.openNotification(target) }
    }

    private func cancel() async {
        working = true
        defer { working = false }
        if let updated = await session.cancelRoutineRun(run) {
            run = updated
            onChange(updated)
        }
    }

    private func markSeen() async {
        guard run.isUnseenProblem, session.surfaceGate.allows(.routineRunsSeen),
              let updated = await session.markRoutineRunSeen(run) else { return }
        run = updated
        onChange(updated)
    }
}

/// `durationLabel` (src/lib/schedule-label.ts).
enum RoutineDurations {
    /// `EVENT_DURATION_OPTIONS`: 5 to 240 minutes in 5-minute slots.
    static let options = stride(from: 5, through: 240, by: 5).map { $0 }

    static func label(_ minutes: Int) -> String {
        if minutes < 60 { return String(localized: "\(minutes) min") }
        if minutes % 60 == 0 { return String(localized: "\(minutes / 60) hr") }
        return String(localized: "\(minutes / 60) hr \(minutes % 60) min")
    }
}
