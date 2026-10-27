// Shared with (BA15, bot-settings/SharingSection.tsx and GrantEditor.tsx):
// on an organization server, the people and teams a bot is shared with,
// each at a level (Talk, Run routines, Edit, Manage sharing), to change,
// remove and add from the organization directory. Levels above what the
// viewer may give are disabled; the server decides (GET/PUT/DELETE
// /api/bots/:id/grants) and its answer replaces the list.
import CompanionCore
import SwiftUI

extension GrantLevel {
    var label: String {
        switch self {
        case .use: String(localized: "Talk")
        case .run: String(localized: "Run routines")
        case .edit: String(localized: "Edit")
        case .manage: String(localized: "Manage sharing")
        }
    }
}

struct BotSharingSection: View {
    let bot: Bot
    @EnvironmentObject private var session: Session

    var body: some View {
        if let client = session.profileClient {
            BotSharingContent(bot: bot, client: client)
        }
    }
}

private struct BotSharingContent: View {
    @Environment(\.themePalette) var themePalette
    let bot: Bot
    @EnvironmentObject private var session: Session
    @StateObject private var model: BotSharingModel

    init(bot: Bot, client: CompanionClient) {
        self.bot = bot
        _model = StateObject(wrappedValue: BotSharingModel(bot: bot, api: client))
    }

    private var rows: [WireGrant] { model.rows }
    private var administer: GrantAdministration? { model.administer }
    private var directory: OrgShareDirectory? { model.directory }
    private var busy: String? { model.busy }
    private var candidates: [GrantCandidate] { model.candidates }
    private var loadedAdminister: Bool { model.loaded }
    private var error: String? { model.failed ? String(localized: "The change could not be saved.") : nil }

    var body: some View {
        Section {
            if rows.isEmpty {
                Text(String(localized: "Not shared with anyone yet."))
                    .foregroundStyle(Theme.textSecondary)
                    .accessibilityIdentifier("sharing-empty")
            }
            ForEach(rows) { grant in grantRow(grant) }
        } header: {
            Text(String(localized: "Shared with"))
        } footer: {
            Text(String(localized: "People you add see this bot's conversations and can write to it."))
        }
        .task(id: bot.id) { await load() }

        Section {
            if let administer {
                if !administer.mayAdd {
                    Text(String(localized: "This bot must first be shared with one of your teams. Ask its owner."))
                        .font(.footnote).foregroundStyle(Theme.textSecondary)
                } else if let directory, directory.isEmpty {
                    Text(String(localized: "The organization directory is not available yet. Ask an admin to link this server in Perspicax."))
                        .font(.footnote).foregroundStyle(Theme.textSecondary)
                } else {
                    if !administer.any {
                        Text(String(localized: "You manage sharing for your teams and their members on this bot."))
                            .font(.footnote).foregroundStyle(Theme.textSecondary)
                    }
                    TextField(String(localized: "Search by name, login or email"), text: $model.query)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .accessibilityLabel(Text(String(localized: "Search people and teams")))
                        .accessibilityIdentifier("sharing-search")
                    if !model.query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, candidates.isEmpty {
                        Text(String(localized: "Nobody matches.")).font(.footnote).foregroundStyle(Theme.textSecondary)
                    }
                    ForEach(candidates) { candidate in
                        HStack(spacing: 8) {
                            if candidate.kind == .team { Image(systemName: "person.2").foregroundStyle(Theme.textSecondary) }
                            VStack(alignment: .leading, spacing: 2) {
                                Text(verbatim: candidate.label).foregroundStyle(Theme.textPrimary)
                                Text(verbatim: candidate.kind == .team
                                     ? String(localized: "Teams") + " · " + String(localized: "\(candidate.count ?? 0) people")
                                     : candidate.detail)
                                    .font(.footnote).foregroundStyle(Theme.textSecondary)
                            }
                            Spacer(minLength: 8)
                            Button {
                                Task { await put(candidate.target, .use) }
                            } label: {
                                if busy == candidate.target { ProgressView() } else { Label(String(localized: "Add"), systemImage: "person.badge.plus") }
                            }
                            .buttonStyle(.borderless)
                            .disabled(busy != nil)
                            .accessibilityIdentifier("sharing-add.\(candidate.target)")
                        }
                    }
                }
            } else if loadedAdminister {
                Text(String(localized: "Only this bot's owner can share it."))
                    .font(.footnote).foregroundStyle(Theme.textSecondary)
            }
            if let error {
                Text(verbatim: error).font(.footnote).foregroundStyle(Theme.danger)
            }
        }
    }

    @ViewBuilder
    private func grantRow(_ grant: WireGrant) -> some View {
        let editable = GrantRules.editable(grant, administer: administer)
        HStack(spacing: 8) {
            if grant.kind == .team { Image(systemName: "person.2").foregroundStyle(Theme.textSecondary) }
            Text(verbatim: grant.label).foregroundStyle(Theme.textPrimary).lineLimit(1)
            if grant.disabled == true {
                Text(String(localized: "Disabled")).font(.caption).foregroundStyle(Theme.textSecondary)
            }
            Spacer(minLength: 8)
            if editable {
                Menu {
                    ForEach(GrantLevel.allCases, id: \.self) { level in
                        Button {
                            Task { await put(grant.target, level) }
                        } label: {
                            if level == grant.level { Label(level.label, systemImage: "checkmark") } else { Text(level.label) }
                        }
                        .disabled(administer.map { !level.allowed(by: $0.maxLevel) } ?? true)
                    }
                } label: {
                    HStack(spacing: 4) {
                        Text(grant.level.label)
                        Image(systemName: "chevron.up.chevron.down").font(.caption2)
                    }
                    .font(.footnote)
                }
                .disabled(busy != nil)
                .accessibilityLabel(Text(String(localized: "Level") + " · " + grant.label))
                .accessibilityIdentifier("sharing-level.\(grant.target)")
            } else {
                Text(grant.level.label).font(.footnote).foregroundStyle(Theme.textSecondary)
            }
            if busy == grant.target { ProgressView() }
        }
        .swipeActions(edge: .trailing) {
            if editable {
                Button(String(localized: "Remove"), role: .destructive) { Task { await remove(grant.target) } }
                    .disabled(busy != nil)
            }
        }
        .contextMenu {
            if editable {
                Button(String(localized: "Remove"), systemImage: "person.badge.minus", role: .destructive) { Task { await remove(grant.target) } }
            }
        }
        .accessibilityIdentifier("sharing-grant.\(grant.target)")
    }

    private func load() async {
        let config = await session.configStatus()
        await model.load(viewerPrincipalId: config?.viewer?.principalId)
    }

    private func put(_ target: String, _ level: GrantLevel) async { _ = await model.add(target, level: level) }

    private func remove(_ target: String) async { _ = await model.remove(target) }
}

struct BotSharingPage: View {
    @Environment(\.themePalette) var themePalette
    let bot: Bot

    var body: some View {
        ThemedList { BotSharingSection(bot: bot) }
            .navigationTitle(String(localized: "Shared with"))
            .navigationBarTitleDisplayMode(.inline)
            .accessibilityIdentifier("sharing-page")
    }
}
