// The bot panel's smaller pieces (WP7 of the iOS feature parity matrix):
// per-bot usage (BP14, `bot-settings/UsageSection.tsx`), voice notes allowed
// (BA11, `VoiceSettings.tsx`), the Primary Bot (SB28, Sidebar.tsx
// `makePrimaryBot` and `PrimaryBotPicker.tsx`), the read-only notice and the
// proposal status (BP9, BotSettingsDialog.tsx, `ProposalStatus.tsx`), and
// the character's moves and style (BP7, BP8, MascotLookEditor.tsx). Each is
// a small layout-agnostic view the phone mounts in its existing doors (the
// Advanced sheet, the Info tab, long presses) and the iPad in its panel.
import CompanionCore
import SwiftUI

// MARK: - Advanced sections

/// Usage, voice notes and Primary Bot, as Form sections for the Advanced
/// sheet (`AgentProfileView`).
struct BotPanelAdvancedSections: View {
    @Environment(\.themePalette) var themePalette
    let bot: Bot

    @EnvironmentObject private var session: Session
    @State private var viewerId = "local-owner"

    var body: some View {
        let gate = session.surfaceGate
        // Usage always shows (local figures): it also learns who the viewer
        // is, for the Primary Bot section.
        BotUsageSection(bot: bot)
            .task { viewerId = PrimaryBotRules.viewerId(config: await session.configStatus()) }
        if gate.allows(.voiceNotesSetting) { BotVoiceNotesSection(bot: bot) }
        if gate.allows(.primaryBot) { PrimaryBotSection(bot: bot, viewerId: viewerId) }
    }
}

/// What this bot has spent across its threads (UsageSection.tsx).
struct BotUsageSection: View {
    @Environment(\.themePalette) var themePalette
    let bot: Bot

    @EnvironmentObject private var session: Session
    @State private var billing: String?

    private var usage: BotUsageTotal { BotUsageTotal.of(session.state.bot(bot.id) ?? bot) }

    var body: some View {
        Section {
            if usage.turns == 0 {
                Text("No usage recorded yet for this bot.")
                    .foregroundStyle(Theme.textSecondary)
                    .accessibilityIdentifier("bot-usage-empty")
            } else {
                HStack(alignment: .top) {
                    figure("Turns", String(usage.turns), id: "bot-usage-turns")
                    figure("Tokens", BotUsageTotal.formatTokens(usage.headlineTokens), id: "bot-usage-tokens")
                    figure("Cost", usage.costUsd.map(BotUsageTotal.formatUsd) ?? "-", id: "bot-usage-cost")
                }
            }
        } header: {
            Text("Usage")
        } footer: {
            if usage.turns > 0 {
                if usage.hasCost {
                    Text("Cost \(caption).")
                } else {
                    Text("This provider doesn't report a price; tokens are counted.")
                }
            }
        }
        .listRowBackground(Theme.card)
        .task {
            guard let client = session.profileClient else { return }
            let instances = (try? await client.instances()) ?? []
            billing = instances.first { $0.instanceId == bot.modelSelection.instanceId }?.snapshot.billing
        }
    }

    /// `costCaption`.
    private var caption: String {
        switch billing {
        case "subscription": String(localized: "equivalent, on your subscription, not billed")
        case "metered": String(localized: "billed to your API key")
        default: String(localized: "as reported by the provider")
        }
    }

    private func figure(_ label: LocalizedStringKey, _ value: String, id: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(Theme.Font.label).textCase(.uppercase).foregroundStyle(Theme.textSecondary)
            Text(verbatim: value).font(Theme.Font.body).monospacedDigit().foregroundStyle(Theme.textPrimary)
                .accessibilityIdentifier(id)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// "Voice notes": on unless switched off (VoiceSettings.tsx).
struct BotVoiceNotesSection: View {
    @Environment(\.themePalette) var themePalette
    let bot: Bot

    @EnvironmentObject private var session: Session
    @State private var on: Bool

    init(bot: Bot) {
        self.bot = bot
        _on = State(initialValue: bot.voiceNotes != false)
    }

    var body: some View {
        Section {
            Toggle(isOn: Binding(get: { on }, set: { save($0) })) {
                Text("Voice notes")
            }
            .accessibilityLabel(Text("Let this bot send voice notes"))
            .accessibilityIdentifier("bot-voice-notes")
        } footer: {
            Text("Let this agent send spoken notes; on unless switched off here.")
        }
        .listRowBackground(Theme.card)
        .onValueChange(of: session.state.bot(bot.id)?.voiceNotes) { value in on = value != false }
    }

    private func save(_ value: Bool) {
        on = value
        Task {
            guard let client = session.profileClient else { on = !value; return }
            do {
                session.applyProfileBot(try await client.editBot(botId: bot.id, edit: BotProfileEdit(voiceNotes: value)))
            } catch {
                on = !value
                session.actionError = error.localizedDescription
            }
        }
    }
}

/// Make this bot the Primary Bot, or hand the role to another of the
/// viewer's bots when it already is.
struct PrimaryBotSection: View {
    @Environment(\.themePalette) var themePalette
    let bot: Bot
    let viewerId: String

    @EnvironmentObject private var session: Session
    @State private var picking = false
    @State private var working = false
    @State private var made: String?

    private var current: Bot { session.state.bot(bot.id) ?? bot }

    var body: some View {
        if let action = PrimaryBotRules.menuAction(for: current, viewerId: viewerId) {
            Section {
                Button {
                    if action == .make { Task { await PrimaryBotActions.make(current.id, session: session, done: { made = $0 }, working: $working) } }
                    else { picking = true }
                } label: {
                    HStack {
                        Label(
                            action == .make ? String(localized: "Make primary bot") : String(localized: "Replace with different Bot"),
                            systemImage: action == .make ? "star" : "arrow.left.arrow.right"
                        )
                        if working { Spacer(); ProgressView() }
                    }
                }
                .disabled(working)
                .accessibilityIdentifier(action == .make ? "bot-make-primary" : "bot-replace-primary")
            } header: {
                Text("Primary Bot")
            } footer: {
                if let made {
                    Text(verbatim: made).accessibilityIdentifier("bot-primary-made")
                } else {
                    Text("Your primary bot is your main contact: it coordinates your other bots.")
                }
            }
            .listRowBackground(Theme.card)
            .sheet(isPresented: $picking) {
                PrimaryBotPicker(currentId: current.id, viewerId: viewerId) { made = $0 }
            }
        }
    }
}

/// The server hands the role over and answers with the new Primary Bot;
/// the viewer's other bots give it up (`withPrimaryBot`).
@MainActor
enum PrimaryBotActions {
    static func make(_ botId: String, session: Session, done: (String) -> Void, working: Binding<Bool>) async {
        guard let client = session.profileClient else { return }
        working.wrappedValue = true
        defer { working.wrappedValue = false }
        do {
            let primary = try await client.makePrimaryBot(botId: botId)
            for bot in PrimaryBotRules.withPrimary(session.state.bots, primary: primary) where bot != session.state.bot(bot.id) {
                session.applyProfileBot(bot)
            }
            done(String(localized: "\(primary.name) is now your primary bot."))
        } catch {
            session.actionError = error.localizedDescription
        }
    }
}

/// Choose a Primary Bot among the viewer's own bots (PrimaryBotPicker.tsx).
struct PrimaryBotPicker: View {
    @Environment(\.themePalette) var themePalette
    let currentId: String
    let viewerId: String
    let onMade: (String) -> Void

    @EnvironmentObject private var session: Session
    @Environment(\.dismiss) private var dismiss
    @State private var search = ""
    @State private var chosen: String?
    @State private var working = false

    private var choices: [Bot] { PrimaryBotRules.choices(session.state.bots, viewerId: viewerId, currentId: currentId, query: search) }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    if choices.isEmpty {
                        Text(search.isEmpty ? String(localized: "You have no other bot to choose.") : String(localized: "No bot matches this search."))
                            .foregroundStyle(Theme.textSecondary)
                    }
                    ForEach(choices) { bot in
                        Button {
                            chosen = bot.id
                        } label: {
                            HStack(spacing: 12) {
                                BotMascotView(bot: bot, size: 30)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(verbatim: bot.name).foregroundStyle(Theme.textPrimary)
                                    if !bot.title.isEmpty { Text(verbatim: bot.title).font(Theme.Profile.labelFont).foregroundStyle(Theme.textSecondary) }
                                }
                                Spacer()
                                if chosen == bot.id { Image(systemName: "checkmark").foregroundStyle(Theme.accentText) }
                            }
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("primary-choice.\(bot.name)")
                    }
                } footer: {
                    Text("Your primary bot is your main contact: it coordinates your other bots.")
                }
                .listRowBackground(Theme.card)
            }
            .scrollContentBackground(.hidden)
            .background(Theme.bg)
            .searchable(text: $search, prompt: Text("Search your bots"))
            .navigationTitle(Text("Choose a primary Bot"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(String(localized: "Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(String(localized: "Confirm")) {
                        guard let chosen else { return }
                        Task {
                            await PrimaryBotActions.make(chosen, session: session, done: { onMade($0); dismiss() }, working: $working)
                        }
                    }
                    .disabled(chosen == nil || working)
                    .accessibilityIdentifier("primary-confirm")
                }
            }
        }
    }
}

// MARK: - Read-only notice and proposal status

/// "Your administrator lets you use shared bots only", and whether the
/// Primary Bot can propose changes to this bot. Draws nothing otherwise.
struct BotPanelNoticesView: View {
    @Environment(\.themePalette) var themePalette
    let bot: Bot

    @EnvironmentObject private var session: Session
    @State private var readOnly = false

    var body: some View {
        VStack(spacing: 8) {
            if readOnly {
                Text("Your administrator lets you use shared bots only.")
                    .font(Theme.Font.preview)
                    .foregroundStyle(Theme.textSecondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(Theme.cardRaised.opacity(0.6), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .padding(.horizontal, Theme.Profile.cardMargin)
                    .accessibilityIdentifier("profile-read-only")
            }
            if BotPanelNotices.chiefCovers(bot, in: session.state.bots) {
                Text("The Primary Bot can propose this; it arrives as a card you confirm.")
                    .font(Theme.Profile.labelFont)
                    .foregroundStyle(Theme.textTertiary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .padding(.horizontal, Theme.Profile.cardMargin)
                    .accessibilityIdentifier("profile-proposal-status")
            }
        }
        .task(id: bot.id) {
            readOnly = BotPanelNotices.botsReadOnly(await session.configStatus())
        }
    }
}

// MARK: - Moves and style

/// The character's moves and the owl's style (MascotLookEditor.tsx Moves
/// and Style), as menu items for a long press on the mascot.
struct CharacterMovesMenu: View {
    @Environment(\.themePalette) var themePalette
    let look: CompleteMascotLook
    let onMove: (OwlWingMove) -> Void
    let onStyle: (MascotStyle) -> Void

    var body: some View {
        if look.character == .owl {
            Section(String(localized: "Moves")) {
                ForEach(OwlWingMove.allCases, id: \.self) { move in
                    Button(Self.name(move)) { onMove(move) }
                        .accessibilityIdentifier("character-move.\(move.rawValue)")
                }
            }
            Section(String(localized: "Style")) {
                ForEach(MascotStyle.allCases, id: \.self) { style in
                    Button {
                        onStyle(style)
                    } label: {
                        if look.style == style {
                            Label(Self.name(style), systemImage: "checkmark")
                        } else {
                            Text(Self.name(style))
                        }
                    }
                    .accessibilityIdentifier("character-style.\(style.rawValue)")
                }
            }
        }
    }

    static func name(_ move: OwlWingMove) -> String {
        switch move {
        case .spread: String(localized: "Spread wings")
        case .flap: String(localized: "Flap")
        case .takeoff: String(localized: "Take off")
        case .shake: String(localized: "Ruffle")
        case .hoot: String(localized: "Hoot")
        }
    }

    static func name(_ style: MascotStyle) -> String {
        switch style {
        case .flat: String(localized: "2D")
        case .threeD: String(localized: "3D (preview)")
        }
    }
}
