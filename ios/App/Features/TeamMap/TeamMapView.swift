// The Team map on the phone (matrix TM1, TM2; TeamMapPage.tsx,
// TeamCanvas.tsx): the desktop's canvas read as a list, one section per
// team, its chiefs ahead of its members in the person's own order, each
// bot with its mascot, title and status, then the agent handoffs.
//
// A bot row opens the chat. Touch and hold arranges it inside its team
// (personal, on this phone, as the desktop's drag inside a team) and, for
// a server admin, moves it to another team behind the desktop's
// confirmation. `TeamMapContent` carries no presentation, so the iPad
// shell can host it, and later its canvas, in the desktop's main column.
import CompanionCore
import SwiftUI

struct TeamMapSheet: View {
    var openChat: (Chat) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            TeamMapContent(openChat: openChat)
                .navigationTitle(String(localized: "Team map"))
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button(String(localized: "Done")) { dismiss() }
                            .accessibilityIdentifier("team-map-done")
                    }
                }
        }
    }
}

struct TeamMapContent: View {
    @Environment(\.themePalette) var themePalette
    var openChat: (Chat) -> Void
    @EnvironmentObject private var session: Session
    @StateObject private var model = TeamMapModel()

    private var sections: [TeamMapSection] { TeamMap.pageSections(state: session.state) }
    private var visibleBots: [Bot] { session.state.bots.filter { $0.hidden != true } }

    var body: some View {
        let sections = self.sections
        let edges = TeamMap.edges(bots: visibleBots, snapshot: model.snapshot)
        ThemedList {
            Section {
                VStack(alignment: .leading, spacing: 4) {
                    Text(String(localized: "\(visibleBots.count) bots"))
                        .font(.footnote)
                        .foregroundStyle(Theme.textSecondary)
                        .accessibilityIdentifier("team-map-count")
                    Text(String(localized: "Your bots, their teams, and how they work together."))
                        .font(.footnote)
                        .foregroundStyle(Theme.textSecondary)
                }
                .listRowBackground(Color.clear)
            }
            if let message = model.error ?? model.refreshError {
                Section {
                    HStack(alignment: .firstTextBaseline) {
                        Text(verbatim: message)
                            .font(.footnote)
                            .foregroundStyle(Theme.danger)
                        Spacer(minLength: 8)
                        Button {
                            model.error = nil
                            model.refreshError = nil
                        } label: {
                            Image(systemName: "xmark")
                        }
                        .accessibilityLabel(Text(String(localized: "Close")))
                    }
                    .accessibilityIdentifier("team-map-error")
                }
            }
            ForEach(sections) { section in
                Section {
                    let bots = model.lane(section.chiefs, in: section) + model.lane(section.members, in: section)
                    if bots.isEmpty {
                        Text(String(localized: "No bots in this team yet."))
                            .font(.footnote)
                            .foregroundStyle(Theme.textSecondary)
                    }
                    ForEach(bots) { bot in
                        Button { openChat(.bot(bot)) } label: {
                            TeamMapBotRow(bot: bot, moving: model.moving == bot.id)
                        }
                        .buttonStyle(.plain)
                        .contextMenu { botMenu(bot, sections: sections) }
                        .accessibilityIdentifier("team-map-bot-\(bot.id)")
                    }
                } header: {
                    HStack {
                        Text(section.key.isEmpty ? String(localized: "Unassigned") : section.name)
                        Spacer()
                        Text(verbatim: "\(section.count)")
                            .monospacedDigit()
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("team-map-team-\(section.key.isEmpty ? "general" : section.key)")
                }
            }
            if !edges.isEmpty {
                Section {
                    ForEach(edges.prefix(12)) { edge in
                        TeamMapEdgeRow(edge: edge) { chat in openChat(chat) }
                    }
                } header: {
                    Text(String(localized: "Agent handoffs · \(edges.count)"))
                }
            }
        }
        .accessibilityIdentifier("team-map")
        .task(id: session.connection?.id) { await model.poll(session) }
        .alert(
            model.pendingMove.map { String(localized: "Move \($0.bot.name) to \($0.destinationName)?") } ?? "",
            isPresented: Binding(get: { model.pendingMove != nil }, set: { if !$0, model.pendingMove != nil { model.cancelMove() } }),
            presenting: model.pendingMove
        ) { _ in
            Button(String(localized: "Cancel"), role: .cancel) { model.cancelMove() }
            Button(String(localized: "Move bot")) { model.confirmMove(session) }
                .accessibilityIdentifier("team-map-confirm-move")
        } message: { _ in
            Text(String(localized: "This changes the bot's home team and shared instructions, not just its position. Its conversations and model stay with it. To arrange visually, drag within the same team."))
        }
    }

    @ViewBuilder
    private func botMenu(_ bot: Bot, sections: [TeamMapSection]) -> some View {
        Button { openChat(.bot(bot)) } label: {
            Label(String(localized: "Open chat"), systemImage: "bubble.left")
        }
        if model.canArrange(bot, by: -1, in: sections) {
            Button { model.arrange(bot, by: -1, in: sections) } label: {
                Label(String(localized: "Move up"), systemImage: "arrow.up")
            }
            .accessibilityIdentifier("team-map-move-up")
        }
        if model.canArrange(bot, by: 1, in: sections) {
            Button { model.arrange(bot, by: 1, in: sections) } label: {
                Label(String(localized: "Move down"), systemImage: "arrow.down")
            }
            .accessibilityIdentifier("team-map-move-down")
        }
        if session.surfaceGate.allows(.teamMapMove) {
            let here = TeamMap.teamKey(of: bot)
            let others = sections.filter { $0.key != here }
            if !others.isEmpty {
                Menu {
                    ForEach(others) { section in
                        Button(section.key.isEmpty ? String(localized: "Unassigned") : section.name) { model.requestMove(bot, to: section.key) }
                            .accessibilityIdentifier("team-map-move-to-\(section.key.isEmpty ? "general" : section.key)")
                    }
                } label: {
                    Label(String(localized: "Move to team"), systemImage: "person.2")
                }
                .accessibilityIdentifier("team-map-move-team")
            }
        }
    }
}

/// One bot of the map: mascot, name, title, and its status when it is not
/// simply ready (TeamCanvas `BotCard`).
struct TeamMapBotRow: View {
    @Environment(\.themePalette) var themePalette
    let bot: Bot
    var moving = false

    var body: some View {
        let status = TeamMap.status(bot)
        HStack(spacing: 12) {
            BotMascotView(bot: bot, size: 38)
                .frame(width: 38, height: 38)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 5) {
                    Text(verbatim: bot.name)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Theme.textPrimary)
                        .lineLimit(1)
                    if bot.chiefOfStaff == true { PrimaryBotBadge(size: 12) }
                }
                Text(verbatim: subtitle)
                    .font(.footnote)
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            if moving {
                ProgressView()
            } else if status.tone != .idle {
                HStack(spacing: 5) {
                    Circle().fill(color(status.tone)).frame(width: 6, height: 6)
                    Text(statusLabel(status))
                        .font(.caption)
                        .foregroundStyle(Theme.textSecondary)
                }
                .accessibilityElement(children: .combine)
            }
        }
        .padding(.vertical, 2)
        .contentShape(Rectangle())
        .opacity(moving ? 0.35 : 1)
    }

    private var subtitle: String {
        if !bot.title.isEmpty { return bot.title }
        return bot.chiefOfStaff == true ? String(localized: "Primary Bot") : String(localized: "Bot")
    }

    private func statusLabel(_ status: TeamMapStatus) -> String {
        switch status.label {
        case "Waiting for you": String(localized: "Waiting for you")
        case "No signal": String(localized: "No signal")
        case "Working": String(localized: "Working")
        default: String(localized: "Ready")
        }
    }

    private func color(_ tone: TeamMapStatus.Tone) -> Color {
        switch tone {
        case .success: Theme.success
        case .warning: Theme.warning
        case .danger: Theme.danger
        case .idle: Theme.textTertiary
        }
    }
}

/// One handoff: who to whom, why, and its state (TeamMapPage `EdgeRow`).
/// It opens the room the bots talk in, else the receiving bot.
struct TeamMapEdgeRow: View {
    @Environment(\.themePalette) var themePalette
    let edge: TeamMapEdge
    var open: (Chat) -> Void
    @EnvironmentObject private var session: Session

    var body: some View {
        if let source = session.state.bot(edge.sourceBotId), let target = session.state.bot(edge.targetBotId) {
            Button {
                if let id = edge.groupId, let room = session.state.rooms.first(where: { $0.id == id }) {
                    open(.room(room))
                } else {
                    open(.bot(target))
                }
            } label: {
                HStack(spacing: 8) {
                    Text(verbatim: source.name).lineLimit(1)
                    Image(systemName: "arrow.right")
                        .font(.caption)
                        .foregroundStyle(edge.state == .connected ? Theme.textSecondary : Theme.accent)
                    Text(verbatim: target.name).lineLimit(1)
                    Spacer(minLength: 8)
                    if let reason = edge.reason, !reason.isEmpty {
                        Text(verbatim: reason)
                            .font(.caption)
                            .foregroundStyle(Theme.textSecondary)
                            .lineLimit(1)
                    }
                    Text(verbatim: chip)
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(chipInk)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 2)
                        .background(chipFill, in: Capsule())
                }
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(Theme.textPrimary)
            }
            .accessibilityIdentifier("team-map-edge-\(edge.id)")
        }
    }

    private var chip: String {
        switch edge.state {
        case .running: String(localized: "Running")
        case .queued: String(localized: "Queued")
        case .connected: edge.lastAt.map { RelativeStamp.list($0) } ?? String(localized: "Connected")
        }
    }

    private var chipInk: Color {
        switch edge.state {
        case .running: Theme.success
        case .queued: Theme.warning
        case .connected: Theme.textSecondary
        }
    }

    private var chipFill: Color {
        switch edge.state {
        case .running: Theme.success.opacity(0.15)
        case .queued: Theme.warning.opacity(0.15)
        case .connected: Theme.chip
        }
    }
}
