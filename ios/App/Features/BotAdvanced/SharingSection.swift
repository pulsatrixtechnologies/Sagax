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
    @Environment(\.themePalette) var themePalette
    let bot: Bot
    @EnvironmentObject private var session: Session
    @State private var directory: OrgShareDirectory?
    @State private var grants: [WireGrant]?
    @State private var administer: GrantAdministration?
    @State private var loadedAdminister = false
    @State private var query = ""
    @State private var busy: String?
    @State private var error: String?
    @State private var viewerId: String?

    private var rows: [WireGrant] { grants ?? GrantRules.initialRows(bot, directory: directory) }
    private var candidates: [GrantCandidate] {
        query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? [] :
            GrantRules.candidates(directory, ownerId: bot.ownerUserId, taken: rows.map(\.target), query: query, administer: administer)
    }

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
                    TextField(String(localized: "Search by name, login or email"), text: $query)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .accessibilityLabel(Text(String(localized: "Search people and teams")))
                        .accessibilityIdentifier("sharing-search")
                    if !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, candidates.isEmpty {
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
        guard let client = session.profileClient else { return }
        let config = await session.configStatus()
        viewerId = config?.viewer?.principalId
        if GrantRules.viewerOwns(bot, viewerPrincipalId: viewerId) { administer = .owner }
        async let directoryAnswer = try? client.orgShareDirectory()
        do {
            let answer = try await client.botGrants(botId: bot.id)
            grants = answer.grants
            administer = answer.administer
        } catch {
            // the owner keeps their own right to share when the read fails
            if administer?.any != true { administer = nil }
        }
        directory = await directoryAnswer ?? OrgShareDirectory(people: [])
        loadedAdminister = true
    }

    private func run(_ key: String, _ request: @escaping (CompanionClient) async throws -> BotGrants) async {
        guard let client = session.profileClient else { return }
        busy = key
        error = nil
        defer { busy = nil }
        do {
            grants = try await request(client).grants
            query = ""
        } catch {
            self.error = String(localized: "The change could not be saved.")
        }
    }

    private func put(_ target: String, _ level: GrantLevel) async {
        await run(target) { [botId = bot.id] in try await $0.putGrant(botId: botId, target: target, level: level) }
    }

    private func remove(_ target: String) async {
        await run(target) { [botId = bot.id] in try await $0.removeGrant(botId: botId, target: target) }
    }
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
