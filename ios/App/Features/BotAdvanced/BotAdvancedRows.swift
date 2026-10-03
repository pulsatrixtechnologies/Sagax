// The advanced panel's rows in the bot's Advanced sheet (WP16, the desktop
// bot settings rail: src/components/bot-settings/sections.ts), each behind
// the pairing's gate (`SurfaceGate`, decision D1 for the owner's sidecar):
// Prompt preview, Skills, Memory, Access, Allowed commands, Who can see it,
// Shared with, Perspicax Profiles, History, Slack and Duplicate. Rows push
// the section pages; nothing is drawn that the pairing could only fail.
import CompanionCore
import SwiftUI

struct BotAdvancedRows: View {
    @Environment(\.themePalette) var themePalette
    let bot: Bot
    @EnvironmentObject private var session: Session
    /// The Admin link for this bot's Slack app, when the server offered one
    /// (the sheet loads it: `CompanionClient.slackManagementURL`).
    var slackURL: URL?
    @State private var viewerId = "local-owner"

    private var gate: SurfaceGate { session.surfaceGate }

    /// A client session reads and removes command rules only for its own bot.
    private var showsAllowlist: Bool {
        guard gate.allows(.commandAllowlist) else { return false }
        return gate.scope != .serverClient || PrimaryBotRules.viewerOwns(bot, viewerId: viewerId)
    }

    var body: some View {
        let panel = gate.allows(.advancedBotPanel)
        if panel || showsAllowlist || gate.allows(.botVisibility) || gate.allows(.botSharing) || gate.allows(.botPerspicax) {
            Section {
                if panel {
                    row(String(localized: "Prompt preview"), "text.alignleft", id: "advanced-prompt") { PromptPreviewPage(bot: bot) }
                    row(String(localized: "Skills"), "book", id: "advanced-skills") { BotSkillsPage(bot: bot) }
                    row(String(localized: "Memory"), "brain", id: "advanced-memory") { BotMemoryPage(bot: bot) }
                    row(String(localized: "Access"), "network", id: "advanced-access") { BotAccessPage(bot: bot) }
                }
                if showsAllowlist {
                    row(String(localized: "Command allowlist"), "terminal", id: "advanced-allowlist") { CommandAllowlistPage(bot: bot) }
                }
                if gate.allows(.botVisibility) {
                    row(String(localized: "Who can see it"), "eye", id: "advanced-visibility") { BotVisibilityPage(bot: bot) }
                }
                if gate.allows(.botSharing) {
                    row(String(localized: "Shared with"), "person.2", id: "advanced-sharing") { BotSharingPage(bot: bot) }
                }
                if gate.allows(.botPerspicax) {
                    row(String(localized: "Perspicax Profiles"), "puzzlepiece.extension", id: "advanced-perspicax") { BotPerspicaxPage(bot: bot) }
                }
                if panel {
                    row(String(localized: "History"), "clock.arrow.circlepath", id: "advanced-history") { BotHistoryPage(bot: bot) }
                }
            } header: {
                Text(String(localized: "Advanced"))
            }
            .task(id: bot.id) {
                viewerId = PrimaryBotRules.viewerId(config: await session.configStatus())
            }
        }

        if gate.allows(.botSlack), let slackURL {
            BotSlackSection(url: slackURL)
        }

        if gate.allows(.duplicateBot) {
            DuplicateBotSection(bot: bot)
        }
    }

    private func row<Destination: View>(_ title: String, _ systemImage: String, id: String, @ViewBuilder destination: @escaping () -> Destination) -> some View {
        NavigationLink {
            destination()
        } label: {
            Label {
                Text(verbatim: title).foregroundStyle(Theme.textPrimary)
            } icon: {
                Image(systemName: systemImage).foregroundStyle(Theme.iconGrey)
            }
        }
        .accessibilityIdentifier(id)
    }
}

/// Duplicate (BA19, store.tsx `duplicateBot`): a new bot, then the source's
/// profile on it as "<name> copy". A member's fields only, unless the
/// session is an admin's (where it works, and a restricted audience).
struct DuplicateBotSection: View {
    @Environment(\.themePalette) var themePalette
    let bot: Bot
    @EnvironmentObject private var session: Session
    @State private var working = false
    @State private var copied: String?

    var body: some View {
        Section {
            Button {
                Task { await duplicate() }
            } label: {
                HStack {
                    Label(String(localized: "Duplicate"), systemImage: "plus.square.on.square")
                    if working { Spacer(); ProgressView() }
                }
            }
            .disabled(working)
            .accessibilityIdentifier("advanced-duplicate")
            if let copied {
                Text(String(localized: "Added \(copied)."))
                    .font(.footnote)
                    .foregroundStyle(Theme.textSecondary)
                    .accessibilityIdentifier("advanced-duplicate-done")
            }
        }
    }

    private func duplicate() async {
        guard let client = session.profileClient else { return }
        working = true
        defer { working = false }
        let source = session.state.bot(bot.id) ?? bot
        let admin = session.surfaceGate.scope == .serverAdmin
        do {
            // the fleet carries no instructions: read them for the copy
            let soul = try? await client.soul(botId: source.id).soul
            let copy = try await client.duplicateBot(source, soul: soul, computerFields: admin, carryVisibility: admin)
            session.applyProfileBot(copy)
            copied = copy.name
        } catch {
            session.actionError = error.localizedDescription
        }
    }
}
