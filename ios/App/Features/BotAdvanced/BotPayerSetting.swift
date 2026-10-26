// Who pays for this bot's replies (#1137, `BotPayerSettings.tsx`), on an
// organization server: the owner (their engine, subscription or local
// model answers everyone who writes to the bot) or each person (each pays
// for their own messages; the bot answers with their default model when
// its engine is not available to them). The owner sets it without an
// admin: PATCH /api/bots/:id/runtime-settings {turnPayer}. Who pays never
// changes who reads a conversation.
import SwiftUI
import CompanionCore

/// The phone's and the iPad's shared logic.
@MainActor
struct BotPayerModel {
    let bot: Bot
    let session: Session

    /// Shown on an organization server, to the owner or an admin.
    var visible: Bool {
        bot.turnPayerDefault != nil && (session.canAdminister || session.canEditBotField(bot, "automaticRecovery"))
    }

    static func label(_ mode: String) -> String {
        mode == "owner" ? String(localized: "The owner") : String(localized: "Each person")
    }

    static func help(_ mode: String) -> String {
        mode == "owner"
            ? String(localized: "The owner's engine, subscription or local model answers everyone who writes to this bot: they need nothing of their own.")
            : String(localized: "Each person pays for their own messages. When this bot's engine isn't available to them, it answers with their default model (their first starred model).")
    }

    func save(_ choice: String) async -> Bool {
        guard let client = session.profileClient else { return false }
        do {
            try await client.setBotTurnPayer(botId: bot.id, turnPayer: choice == "default" ? nil : choice)
            return true
        } catch {
            session.actionError = error.localizedDescription
            return false
        }
    }
}

/// The picker: Default (X), The owner, Each person. `choice` is
/// "default", "owner" or "speaker".
struct BotPayerPicker: View {
    @EnvironmentObject private var session: Session
    let bot: Bot
    @State private var choice: String?
    @State private var saving = false

    private var current: Bot { session.state.bot(bot.id) ?? bot }
    private var shown: String { choice ?? current.turnPayer ?? "default" }
    private var effective: String { shown == "default" ? (current.turnPayerDefault ?? "speaker") : shown }

    var body: some View {
        let model = BotPayerModel(bot: current, session: session)
        VStack(alignment: .leading, spacing: 4) {
            Picker(String(localized: "Who pays for replies"), selection: Binding(get: { shown }, set: { next in
                let before = shown
                choice = next
                saving = true
                Task {
                    if !(await model.save(next)) { choice = before }
                    saving = false
                }
            })) {
                Text(verbatim: String(localized: "Default (\(BotPayerModel.label(current.turnPayerDefault ?? "speaker")))")).tag("default")
                Text(verbatim: BotPayerModel.label("owner")).tag("owner")
                Text(verbatim: BotPayerModel.label("speaker")).tag("speaker")
            }
            .pickerStyle(.menu)
            .disabled(saving)
            .accessibilityIdentifier("bot-turn-payer")
            Text(verbatim: BotPayerModel.help(effective))
                .font(.footnote)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

/// The phone's Model page: one form section.
struct BotPayerSection: View {
    @EnvironmentObject private var session: Session
    let bot: Bot

    var body: some View {
        if BotPayerModel(bot: session.state.bot(bot.id) ?? bot, session: session).visible {
            Section { BotPayerPicker(bot: bot) }
        }
    }
}
