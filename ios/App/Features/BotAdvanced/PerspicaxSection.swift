// Perspicax profiles (BA16, bot-settings/PerspicaxSection.tsx) and the
// Slack link (BA17, SlackSection.tsx). On an organization server each
// person who talks to the bot uses their own Perspicax access; an editor
// adds only profiles they hold, and a profile someone else put on the bot
// stays checked, marked as not held, and may be removed. The Slack app is
// created and managed in the organisation's Admin: the row exists only when
// the server offers an https link, and opens it.
import CompanionCore
import SwiftUI

struct BotPerspicaxSection: View {
    @Environment(\.themePalette) var themePalette
    let bot: Bot
    @EnvironmentObject private var session: Session
    @State private var answer: PerspicaxAnswer?
    @State private var loadFailed = false
    @State private var draft: [String] = []
    @State private var saving = false
    @State private var refusal: PerspicaxRules.Refusal?
    @State private var saved = false

    var body: some View {
        Section {
            if loadFailed {
                Text(String(localized: "Perspicax profiles are not available on this server right now."))
                    .foregroundStyle(Theme.textSecondary)
            } else if let answer {
                let rows = PerspicaxRules.rows(answer, draft: draft)
                if rows.isEmpty {
                    Text(String(localized: "You hold no Perspicax profile.")).foregroundStyle(Theme.textSecondary)
                }
                ForEach(rows) { row in
                    VStack(alignment: .leading, spacing: 4) {
                        Toggle(isOn: Binding(get: { row.checked }, set: { toggle(row.profile.id, $0) })) {
                            VStack(alignment: .leading, spacing: 2) {
                                HStack(spacing: 6) {
                                    Text(verbatim: row.profile.name).foregroundStyle(Theme.textPrimary)
                                    if row.notHeld {
                                        Text(String(localized: "Not held by you")).font(.caption).foregroundStyle(Theme.textSecondary)
                                    }
                                }
                                if !row.profile.description.isEmpty {
                                    Text(verbatim: row.profile.description).font(.footnote).foregroundStyle(Theme.textSecondary)
                                }
                            }
                        }
                        .tint(Theme.toggleOn)
                        .disabled(row.disabled || saving)
                        .accessibilityIdentifier("perspicax-profile.\(row.profile.id)")
                        if row.notHeld, answer.canEdit, row.checked {
                            Button(String(localized: "Remove")) { toggle(row.profile.id, false) }
                                .buttonStyle(.borderless)
                                .disabled(saving)
                        }
                    }
                }
            } else {
                HStack(spacing: 8) {
                    ProgressView()
                    Text(String(localized: "Loading the Perspicax profiles")).foregroundStyle(Theme.textSecondary)
                }
            }
        } header: {
            Text(String(localized: "Perspicax Profiles"))
        } footer: {
            Text(String(localized: "Each person who talks to this bot uses their own Perspicax access. Someone who does not hold a profile does not get its tools."))
        }
        .task(id: bot.id) { await load() }

        if let answer, !loadFailed {
            Section {
                if answer.canEdit {
                    Button {
                        Task { await save() }
                    } label: {
                        HStack {
                            Text(String(localized: "Save"))
                            if saving { Spacer(); ProgressView() }
                        }
                    }
                    .disabled(!PerspicaxRules.changed(draft, from: answer) || saving)
                    .accessibilityIdentifier("perspicax-save")
                    if saved, !PerspicaxRules.changed(draft, from: answer) {
                        Text(String(localized: "Saved.")).font(.footnote).foregroundStyle(Theme.textSecondary)
                    }
                    if let refusal {
                        Text(message(refusal)).font(.footnote).foregroundStyle(Theme.danger)
                    }
                } else {
                    Text(String(localized: "You can use this bot, not change its profiles."))
                        .font(.footnote).foregroundStyle(Theme.textSecondary)
                }
            } footer: {
                Text(String(localized: "Routines use the tools of the person they run as, once that person allows routines to act in their name."))
            }
        }
    }

    private func message(_ refusal: PerspicaxRules.Refusal) -> String {
        switch refusal {
        case .profileNotHeld: String(localized: "You can only add a profile you hold in Perspicax.")
        case .needsEdit: String(localized: "Changing these profiles needs edit access to this bot.")
        case .unknownProfile: String(localized: "Perspicax no longer lists this profile.")
        case .failed: String(localized: "The change could not be saved.")
        }
    }

    private func toggle(_ id: String, _ on: Bool) {
        saved = false
        refusal = nil
        draft = PerspicaxRules.toggled(draft, id: id, on: on)
    }

    private func load() async {
        guard let client = session.profileClient else { return }
        answer = nil
        loadFailed = false
        do {
            let next = try await client.botPerspicax(botId: bot.id)
            answer = next
            draft = next.selectedIds
        } catch {
            loadFailed = true
        }
    }

    private func save() async {
        guard let client = session.profileClient else { return }
        saving = true
        refusal = nil
        saved = false
        defer { saving = false }
        do {
            let next = try await client.setBotPerspicax(botId: bot.id, profiles: draft)
            answer = next
            draft = next.selectedIds
            saved = true
        } catch let failure as PerspicaxRefusalError {
            refusal = failure.refusal
        } catch {
            refusal = .failed
        }
    }
}

struct BotPerspicaxPage: View {
    @Environment(\.themePalette) var themePalette
    let bot: Bot

    var body: some View {
        ThemedForm { BotPerspicaxSection(bot: bot) }
            .navigationTitle(String(localized: "Perspicax Profiles"))
            .navigationBarTitleDisplayMode(.inline)
            .accessibilityIdentifier("perspicax-page")
    }
}

/// The Slack row: present only when the server offered an https link (the
/// parent loads it with `CompanionClient.slackManagementURL`).
struct BotSlackSection: View {
    @Environment(\.themePalette) var themePalette
    @Environment(\.openURL) private var openURL
    let url: URL

    var body: some View {
        Section {
            Button {
                openURL(url)
            } label: {
                Label(String(localized: "Manage in Admin"), systemImage: "arrow.up.right.square")
            }
            .accessibilityIdentifier("slack-manage")
        } header: {
            Text(String(localized: "Slack"))
        } footer: {
            Text(String(localized: "Give this agent its own Slack app, with its own name and picture, so your team can message it directly."))
        }
    }
}
