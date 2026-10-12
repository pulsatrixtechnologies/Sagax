// iPad desktop: the chat column's right rail for sub-agents and background
// work (BackgroundWorkPanel.tsx). Routines, hops, parallel tasks and
// sub-agents — never the open conversation's own turn.
import SwiftUI
import CompanionCore

enum DesktopBackgroundWorkWording {
    static let title = String(localized: "Activités en cours", comment: "Right rail heading for background bot work")
    static let empty = String(localized: "Aucune tâche en arrière-plan pour l'instant.")
    static let loading = String(localized: "Chargement des activités…")
    static let error = String(localized: "Impossible de charger les activités en cours.")
    static let openTranscript = String(localized: "Ouvrir la conversation")
    static let openDetail = String(localized: "Voir le détail")
}

/// The ongoing-activities rail beside the desktop chat (lg+ on web).
struct DesktopBackgroundWorkRail: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @StateObject private var model: BotActivityModel
    @State private var expandedId: String?
    @State private var detailRoute: BotActivityRoute?

    let botId: String

    init(botId: String) {
        self.botId = botId
        _model = StateObject(wrappedValue: BotActivityModel(botId: botId))
    }

    private var items: [BotActivityItem] { model.other ?? [] }

    var body: some View {
        Group {
            if items.isEmpty, model.list != nil, !model.failed {
                EmptyView()
            } else {
                rail
            }
        }
        .task(id: session.connection?.id) { model.start(client: session.profileClient) }
        .onDisappear { model.stop() }
        .onValueChange(of: BotActivityRules.signature(session.state.bots.first { $0.id == botId }?.tasks)) { _ in
            Task { await model.refresh() }
        }
        .sheet(item: $detailRoute) { route in
            BotActivitySheet(botId: botId, route: route, model: model) { _, threadId in
                detailRoute = nil
                Task {
                    try? await Task.sleep(nanoseconds: 500_000_000)
                    session.openChat(threadId: threadId)
                }
            }
            .environmentObject(session)
        }
    }

    private var rail: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: "square.stack.3d.up")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(theme.inkSecondary)
                Text(verbatim: DesktopBackgroundWorkWording.title)
                    .font(theme.font(13, .medium))
                    .foregroundStyle(theme.ink)
                    .lineLimit(1)
                Spacer(minLength: 0)
                if items.contains(where: { $0.status.isActive }) {
                    ProgressView()
                        .controlSize(.small)
                }
            }
            .padding(.horizontal, 12)
            .frame(height: 48)
            .overlay(alignment: .bottom) { Rectangle().fill(theme.hairline).frame(height: 1) }

            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    if model.list == nil, !model.failed {
                        HStack(spacing: 8) {
                            ProgressView().controlSize(.small)
                            Text(verbatim: DesktopBackgroundWorkWording.loading)
                                .font(theme.font(12.5))
                                .foregroundStyle(theme.inkSecondary)
                        }
                        .padding(12)
                    } else if model.failed, model.list == nil {
                        Text(verbatim: DesktopBackgroundWorkWording.error)
                            .font(theme.font(12.5))
                            .foregroundStyle(theme.inkSecondary)
                            .padding(12)
                    } else if items.isEmpty, model.list != nil {
                        Text(verbatim: DesktopBackgroundWorkWording.empty)
                            .font(theme.font(12.5))
                            .foregroundStyle(theme.inkSecondary)
                            .multilineTextAlignment(.center)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 16)
                            .padding(.horizontal, 12)
                    } else {
                        ForEach(items) { item in
                            card(item)
                        }
                    }
                }
                .padding(12)
            }
        }
        .frame(width: 300)
        .background(theme.app)
        .overlay(alignment: .leading) { Rectangle().fill(theme.hairline).frame(width: 1) }
        .accessibilityIdentifier("background-work-panel")
    }

    private func card(_ item: BotActivityItem) -> some View {
        let expanded = expandedId == item.id
        return VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.easeOut(duration: 0.15)) {
                    expandedId = expanded ? nil : item.id
                }
            } label: {
                HStack(alignment: .top, spacing: 10) {
                    BotActivityStatusIcon(status: item.status, size: 14)
                        .padding(.top, 2)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(verbatim: item.title)
                            .font(theme.font(13, .medium))
                            .foregroundStyle(theme.ink)
                            .lineLimit(1)
                        Text(verbatim: BotActivityWording.subtitle(item, now: model.now.timeIntervalSince1970 * 1000))
                            .font(theme.font(12))
                            .foregroundStyle(theme.inkSecondary)
                            .lineLimit(2)
                        if let step = item.currentStep, !step.isEmpty {
                            Text(verbatim: step)
                                .font(theme.font(11))
                                .foregroundStyle(theme.inkTertiary)
                                .lineLimit(1)
                        }
                    }
                    Spacer(minLength: 0)
                    Image(systemName: expanded ? "chevron.down" : "chevron.right")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(theme.inkSecondary)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
            }
            .buttonStyle(.plain)

            if expanded {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 8) {
                        if let threadId = item.threadId {
                            Button(DesktopBackgroundWorkWording.openTranscript) {
                                session.openChat(threadId: threadId)
                            }
                            .font(theme.font(12))
                        }
                        Button(DesktopBackgroundWorkWording.openDetail) {
                            detailRoute = BotActivityRoute.detail(item)
                        }
                        .font(theme.font(12))
                    }
                }
                .padding(.horizontal, 12)
                .padding(.bottom, 10)
            }
        }
        .background(theme.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(theme.hairlineWeak, lineWidth: 1))
        .opacity(model.fading(item) ? 0 : 1)
        .animation(.easeOut(duration: BotActivityRules.finishedFade / 1000), value: model.fading(item))
        .accessibilityIdentifier("background-work-card.\(item.id)")
    }
}
