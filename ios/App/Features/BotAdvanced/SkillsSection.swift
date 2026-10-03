// Skills (BA4, bot-settings/SkillsSection.tsx and OrgSkillsCard.tsx): what
// the bot learned or imported, to read, switch on after a review, switch
// off and remove; an import field; the organization's offered skills for
// an admin. Enabling a disabled skill always shows its full SKILL.md first,
// exactly as the desktop's review step.
import CompanionCore
import SwiftUI

struct BotSkillsSection: View {
    @Environment(\.themePalette) var themePalette
    let bot: Bot
    @EnvironmentObject private var session: Session
    @State private var skills: [ManagedSkill] = []
    @State private var staged = 0
    @State private var loading = true
    @State private var working = ""
    @State private var error = ""
    @State private var authoring = true
    @State private var source = ""
    @State private var importing = false
    @State private var importMessage = ""
    @State private var reviewing: SkillSheet?
    @State private var viewing: SkillSheet?
    @State private var removing: ManagedSkill?

    struct SkillSheet: Identifiable {
        let skill: ManagedSkill
        let text: String
        var id: String { skill.name }
    }

    var body: some View {
        Section {
            HStack(spacing: 8) {
                TextField(String(localized: "owner/repo, https://github.com/…/SKILL.md, or https://skills.sh/…"), text: $source)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .font(.system(size: 14))
                    .accessibilityLabel(Text(String(localized: "Import a skill")))
                    .accessibilityIdentifier("skills-import-field")
                    .onSubmit { Task { await importSkill() } }
                Button(importing ? String(localized: "Importing…") : String(localized: "Import")) { Task { await importSkill() } }
                    .buttonStyle(.borderless)
                    .disabled(importing || SkillRules.importSource(source) == nil)
                    .accessibilityIdentifier("skills-import")
            }
            if !importMessage.isEmpty {
                Text(verbatim: importMessage).font(.footnote).foregroundStyle(Theme.textSecondary)
            }
            if loading {
                Text(String(localized: "Loading…")).foregroundStyle(Theme.textSecondary)
            } else if skills.isEmpty {
                Text(String(localized: "No installed skills yet."))
                    .foregroundStyle(Theme.textSecondary)
                    .accessibilityIdentifier("skills-empty")
            } else {
                ForEach(skills) { skill in row(skill) }
            }
            if staged > 0 {
                Text(staged == 1
                     ? String(localized: "1 proposal is waiting for a decision in chat.")
                     : String(localized: "\(staged) proposals are waiting for a decision in chat."))
                    .font(.footnote)
                    .foregroundStyle(Theme.warning)
            }
            if !error.isEmpty {
                Text(verbatim: error).font(.footnote).foregroundStyle(Theme.danger)
                    .accessibilityIdentifier("skills-error")
            }
        } header: {
            Text(String(localized: "Learned skills"))
        } footer: {
            Text(authoring
                 ? String(localized: "Save a bot's verification run as a skill from the Verify card, or import one below. Every change waits for your review.")
                 : String(localized: "Skill authoring is off, but skills you already enabled stay under your control here."))
        }
        .task(id: bot.id) { await refresh(first: true) }
        .sheet(item: $reviewing) { sheet in reviewSheet(sheet) }
        .sheet(item: $viewing) { sheet in viewSheet(sheet) }
        .confirmationDialog(
            removing.map { String(localized: "Remove the learned skill “\($0.name)”?") } ?? "",
            isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
            titleVisibility: .visible,
            presenting: removing
        ) { skill in
            Button(String(localized: "Remove skill"), role: .destructive) { Task { await remove(skill) } }
                .accessibilityIdentifier("skills-remove-confirm")
            Button(String(localized: "Cancel"), role: .cancel) { removing = nil }
        }

        if session.surfaceGate.allows(.orgSkillsLibrary) {
            OrgSkillsSection(bot: bot) { Task { await refresh() } }
        }
    }

    @ViewBuilder
    private func row(_ skill: ManagedSkill) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .top, spacing: 10) {
                Button { Task { await view(skill) } } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(verbatim: skill.name)
                            .font(.system(size: 13, design: .monospaced))
                            .foregroundStyle(Theme.textPrimary)
                        if !skill.description.isEmpty {
                            Text(verbatim: skill.description)
                                .font(.system(size: 12))
                                .foregroundStyle(Theme.textSecondary)
                                .lineLimit(2)
                        }
                        Text(String(localized: "Used when the bot decides it's relevant"))
                            .font(.system(size: 11))
                            .foregroundStyle(Theme.textSecondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("skill-open.\(skill.name)")
                Toggle(isOn: Binding(get: { skill.enabled }, set: { _ in Task { await toggle(skill) } })) { EmptyView() }
                    .labelsHidden()
                    .tint(Theme.toggleOn)
                    .disabled(working == skill.name)
                    .accessibilityLabel(Text(skill.enabled ? String(localized: "Disable \(skill.name)") : String(localized: "Enable \(skill.name)")))
                    .accessibilityIdentifier("skill-toggle.\(skill.name)")
            }
            Text(String(localized: "Source: \(skill.source)"))
                .font(.system(size: 11))
                .foregroundStyle(Theme.textSecondary)
                .lineLimit(1)
            if !skill.warnings.isEmpty {
                Text(verbatim: skill.warnings.joined(separator: " · "))
                    .font(.system(size: 11))
                    .foregroundStyle(Theme.warning)
            }
        }
        .swipeActions(edge: .trailing) {
            Button(String(localized: "Remove"), role: .destructive) { removing = skill }
                .disabled(working == skill.name)
        }
        .contextMenu {
            Button(String(localized: "Remove skill"), systemImage: "trash", role: .destructive) { removing = skill }
        }
        .accessibilityIdentifier("skill-row.\(skill.name)")
    }

    private func reviewSheet(_ sheet: SkillSheet) -> some View {
        NavigationStack {
            ThemedList {
                Section {
                    Text(String(localized: "Source: \(sheet.skill.source)"))
                        .font(.footnote).foregroundStyle(Theme.textSecondary)
                    if !sheet.skill.warnings.isEmpty {
                        Text(verbatim: sheet.skill.warnings.joined(separator: " · "))
                            .font(.footnote).foregroundStyle(Theme.warning)
                    }
                    Text(verbatim: sheet.text)
                        .font(.system(size: 12, design: .monospaced))
                        .foregroundStyle(Theme.textPrimary)
                        .textSelection(.enabled)
                        .accessibilityLabel(Text(String(localized: "Full SKILL.md for \(sheet.skill.name)")))
                    if !error.isEmpty {
                        Text(verbatim: error).font(.footnote).foregroundStyle(Theme.danger)
                    }
                }
            }
            .navigationTitle(String(localized: "Review \(sheet.skill.name) before enabling"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(String(localized: "Cancel")) { reviewing = nil }.disabled(working == sheet.skill.name)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(String(localized: "Enable reviewed skill")) { Task { await enableReviewed(sheet.skill) } }
                        .disabled(working == sheet.skill.name)
                        .accessibilityIdentifier("skill-enable-reviewed")
                }
            }
        }
    }

    private func viewSheet(_ sheet: SkillSheet) -> some View {
        NavigationStack {
            ThemedList {
                Text(verbatim: sheet.text)
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundStyle(Theme.textPrimary)
                    .textSelection(.enabled)
                    .accessibilityLabel(Text(String(localized: "Full SKILL.md for \(sheet.skill.name)")))
                    .accessibilityIdentifier("skill-text")
            }
            .navigationTitle(Text(verbatim: sheet.skill.name))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(String(localized: "Close")) { viewing = nil }
                }
            }
        }
    }

    // MARK: Actions (SkillsSection.tsx)

    private func refresh(first: Bool = false) async {
        guard let client = session.profileClient else { return }
        if first {
            loading = true
            authoring = (try? await client.skillAuthoringEnabled()) ?? true
        }
        do {
            let list = try await client.botSkills(botId: bot.id)
            skills = list.skills
            staged = list.staged.count
            error = ""
        } catch {
            self.error = error.localizedDescription
        }
        loading = false
    }

    private func toggle(_ skill: ManagedSkill) async {
        guard let client = session.profileClient else { return }
        working = skill.name
        error = ""
        defer { working = "" }
        do {
            if !skill.enabled {
                // A disabled import has not necessarily been reviewed: show
                // the integrity-checked text before it can reach the bot.
                guard let text = try await client.skillText(botId: bot.id, name: skill.name), !text.isEmpty else {
                    error = String(localized: "The skill contents are unavailable; remove and import or learn it again.")
                    return
                }
                reviewing = SkillSheet(skill: skill, text: text)
                return
            }
            try await client.setSkillEnabled(botId: bot.id, name: skill.name, enabled: false)
            await refresh()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func enableReviewed(_ skill: ManagedSkill) async {
        guard let client = session.profileClient else { return }
        working = skill.name
        error = ""
        defer { working = "" }
        do {
            try await client.setSkillEnabled(botId: bot.id, name: skill.name, enabled: true)
            reviewing = nil
            await refresh()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func remove(_ skill: ManagedSkill) async {
        removing = nil
        guard let client = session.profileClient else { return }
        working = skill.name
        error = ""
        defer { working = "" }
        do {
            try await client.removeSkill(botId: bot.id, name: skill.name)
            await refresh()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func view(_ skill: ManagedSkill) async {
        guard let client = session.profileClient else { return }
        error = ""
        do {
            viewing = SkillSheet(skill: skill, text: try await client.skillText(botId: bot.id, name: skill.name) ?? "")
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func importSkill() async {
        guard let trimmed = SkillRules.importSource(source), let client = session.profileClient else { return }
        importing = true
        error = ""
        importMessage = ""
        defer { importing = false }
        do {
            let count = try await client.importSkill(botId: bot.id, source: trimmed)
            importMessage = count == 1
                ? String(localized: "Imported 1 skill — review and enable below.")
                : String(localized: "Imported \(count) skills — review and enable below.")
            source = ""
            await refresh()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// Bot > Skills > From {Organization} (OrgSkillsCard.tsx): absent with no
/// organization or nothing offered.
struct OrgSkillsSection: View {
    @Environment(\.themePalette) var themePalette
    let bot: Bot
    let onAdded: () -> Void
    @EnvironmentObject private var session: Session
    @State private var offer: OrgSkillsOffer?
    @State private var working = ""
    @State private var error = ""

    var body: some View {
        Group {
            if let offer, offer.shown, let organization = offer.organization {
                Section {
                    ForEach(offer.skills) { skill in
                        HStack(spacing: 10) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(verbatim: skill.name).font(.system(size: 13, design: .monospaced)).foregroundStyle(Theme.textPrimary)
                                Text(verbatim: skill.description).font(.system(size: 12)).foregroundStyle(Theme.textSecondary).lineLimit(2)
                                Text(String(localized: "\(skill.packageName) \(skill.release) · \(skill.publisher)"))
                                    .font(.system(size: 11)).foregroundStyle(Theme.textSecondary).lineLimit(1)
                            }
                            Spacer(minLength: 8)
                            if skill.added {
                                Label(String(localized: "Added"), systemImage: "checkmark")
                                    .font(.footnote).foregroundStyle(Theme.textSecondary)
                            } else {
                                Button(working == skill.id ? String(localized: "Adding…") : String(localized: "Add")) {
                                    Task { await add(skill) }
                                }
                                .buttonStyle(.borderless)
                                .disabled(!working.isEmpty)
                                .accessibilityLabel(Text(String(localized: "Add \(skill.name) to this bot")))
                            }
                        }
                    }
                    if !error.isEmpty {
                        Text(verbatim: error).font(.footnote).foregroundStyle(Theme.danger)
                    }
                } header: {
                    Text(String(localized: "From \(organization.name)"))
                } footer: {
                    Text(String(localized: "Skills your organization shares. Adding one puts it on this bot, switched on."))
                }
            }
        }
        .task(id: bot.id) { await refresh() }
    }

    private func refresh() async {
        // No organization library is the same as nothing offered.
        offer = try? await session.profileClient?.orgOfferedSkills(botId: bot.id)
    }

    private func add(_ skill: OfferedOrgSkill) async {
        guard let client = session.profileClient else { return }
        working = skill.id
        error = ""
        defer { working = "" }
        do {
            try await client.addOrgSkill(botId: bot.id, skill: skill)
            await refresh()
            onAdded()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct BotSkillsPage: View {
    @Environment(\.themePalette) var themePalette
    let bot: Bot

    var body: some View {
        ThemedList { BotSkillsSection(bot: bot) }
            .navigationTitle(String(localized: "Skills"))
            .navigationBarTitleDisplayMode(.inline)
            .accessibilityIdentifier("skills-page")
    }
}
