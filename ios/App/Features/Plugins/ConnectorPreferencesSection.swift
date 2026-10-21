// Clear connector preferences (PL4): every tool a person turned off on a
// connector comes back on. Accounts stay connected. Team bots use the same
// switches. PUT /api/connectors/:slug/tools { disabledTools: [] }.
import CompanionCore
import SwiftUI

struct ConnectorPreferencesSection: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @State private var confirming = false
    @State private var busy = false
    @State private var notice: String?

    var body: some View {
        Section {
            Button(String(localized: "Clear connector preferences"), role: .destructive) { confirming = true }
                .disabled(busy)
                .accessibilityIdentifier("connector-preferences-clear")
            if let notice {
                Text(verbatim: notice)
                    .font(.footnote)
                    .foregroundStyle(Theme.textSecondary)
                    .accessibilityIdentifier("connector-preferences-notice")
            }
        } footer: {
            Text(String(localized: "This turns every connector tool back on. Accounts stay connected."))
        }
        .confirmationDialog(String(localized: "Clear connector preferences?"), isPresented: $confirming, titleVisibility: .visible) {
            Button(String(localized: "Clear connector preferences"), role: .destructive) { Task { await clear() } }
            Button(String(localized: "Cancel"), role: .cancel) {}
        } message: {
            Text(String(localized: "This turns every connector tool back on. Accounts stay connected."))
        }
    }

    private func clear() async {
        guard let client = session.settingsClient else { return }
        busy = true
        defer { busy = false }
        do {
            _ = try await client.clearConnectorPreferences()
            notice = String(localized: "Cleared")
        } catch {
            notice = error.localizedDescription
        }
    }
}

/// Slack for each bot the server offers an Admin link for (PL6). The same
/// deep link as the bot's profile: Sagax does not connect Slack on the phone.
struct SlackConnectionsSection: View {
    @Environment(\.themePalette) var themePalette
    @Environment(\.openURL) private var openURL
    @EnvironmentObject private var session: Session
    @State private var links: [(bot: Bot, url: URL)] = []

    var body: some View {
        Group {
            if !links.isEmpty {
                slackSection
            }
        }
        .task(id: session.state.bots.map(\.id).joined(separator: ",")) { await load() }
    }

    private var slackSection: some View {
        Section {
                ForEach(links, id: \.bot.id) { row in
                    Button {
                        openURL(row.url)
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(verbatim: row.bot.name).foregroundStyle(Theme.textPrimary)
                            Text(String(localized: "Manage in Admin"))
                                .font(.footnote)
                                .foregroundStyle(Theme.textSecondary)
                        }
                    }
                    .accessibilityIdentifier("slack-manage.\(row.bot.id)")
                }
            } header: {
                Text(String(localized: "Slack"))
            } footer: {
                Text(String(localized: "Give this agent its own Slack app, with its own name and picture, so your team can message it directly."))
            }
    }

    private func load() async {
        guard session.surfaceGate.allows(.botSlack), let client = session.profileClient else {
            links = []
            return
        }
        var found: [(bot: Bot, url: URL)] = []
        for bot in session.state.bots where bot.hidden != true {
            if found.count >= 12 { break }
            if let url = await client.slackManagementURL(botId: bot.id) {
                found.append((bot, url))
            }
        }
        links = found
    }
}
