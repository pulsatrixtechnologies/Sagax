// A bot of Browse Bots, read only (desktop BotCatalogDetailView.tsx): who it
// is, then its instructions, memories, skills, routines and integrations as
// the desktop's vertical tabs become sections, and every action the viewer
// may take. The Publish form asks for a category (BotCatalogModal.tsx).
import CompanionCore
import SwiftUI

struct BrowseBotsDetail: View {
    @EnvironmentObject private var session: Session
    let item: BotCatalogItem
    @ObservedObject var model: BrowseBotsModel
    let open: (Bot) -> Void
    let publish: (BotCatalogEntry) -> Void

    @State private var detail: BotCatalogDetail?
    @State private var failure: String?

    var body: some View {
        List {
            Section {
                HStack(spacing: 14) {
                    BrowseBotsFace(item: item, size: 56)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(verbatim: item.name).font(.title3.weight(.semibold))
                        Text("By \(item.creator)").font(.footnote).foregroundStyle(Theme.textSecondary)
                    }
                }
                if !description.isEmpty {
                    Text(verbatim: description).font(.callout)
                }
                if case let .template(template) = item {
                    ForEach(template.notes, id: \.self) { note in
                        Text(verbatim: note).font(.footnote).foregroundStyle(Theme.textSecondary)
                    }
                    if let members = template.members {
                        Text("Bots: \(members)").font(.footnote).foregroundStyle(Theme.textSecondary)
                    }
                    if template.source == .community {
                        Text("Add this team from Sagax on your computer.").font(.footnote).foregroundStyle(Theme.textSecondary)
                    }
                }
                ForEach(model.actions(item), id: \.self) { action in
                    if action != .open || openable != nil {
                        Button(BrowseBotsModel.actionLabel(action), role: action == .unpublish || action == .removeFromSidebar ? .destructive : nil) {
                            run(action)
                        }
                        .disabled(model.working == item.id)
                        .accessibilityIdentifier("browse-bots.action.\(action.rawValue)")
                    }
                }
            }
            switch item {
            case .bot:
                if let detail { tabs(detail) } else if let failure {
                    Section { Text(verbatim: failure).foregroundStyle(Theme.textSecondary) }
                } else {
                    Section { ProgressView() }
                }
            case let .template(template):
                templateTabs(template)
            }
            Section {
                Text("Everything here is read only. Change a bot from its own panel.")
                    .font(.footnote)
                    .foregroundStyle(Theme.textSecondary)
            }
        }
        .navigationTitle(item.name)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            guard case let .bot(entry) = item, let client = session.profileClient else { return }
            do { detail = try await client.botCatalogDetail(botId: entry.id) } catch { failure = error.localizedDescription }
        }
    }

    private var description: String {
        switch item {
        case let .bot(entry): entry.blurb
        case let .template(template): template.description
        }
    }

    private var openable: Bot? {
        guard case let .bot(entry) = item else { return nil }
        return session.state.bot(entry.id)
    }

    private func run(_ action: BotCatalogAction) {
        Haptics.selection()
        if action == .publish, case let .bot(entry) = item { publish(entry); return }
        Task {
            if let bot = await model.perform(action, on: item, session: session) { open(bot) }
        }
    }

    @ViewBuilder private func tabs(_ detail: BotCatalogDetail) -> some View {
        Section {
            if detail.soul.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Text("No instructions yet.").foregroundStyle(Theme.textSecondary)
            } else {
                MarkdownText(source: detail.soul).font(.callout).textSelection(.enabled)
            }
        } header: { tabHeader("Instructions", "Who it is and how it works", nil) }
        Section {
            if let memories = detail.memories {
                if memories.isEmpty { Text("It knows no facts yet.").foregroundStyle(Theme.textSecondary) }
                ForEach(Array(memories.enumerated()), id: \.offset) { _, fact in Text(verbatim: fact).font(.callout) }
            } else {
                Text("Its memories are shown only to the people this bot is shared with. An imported copy starts with none.")
                    .font(.footnote)
                    .foregroundStyle(Theme.textSecondary)
            }
        } header: { tabHeader("Memories", "Facts it already knows", detail.memories?.count) }
        Section {
            if detail.skills.isEmpty { Text("No skills.").foregroundStyle(Theme.textSecondary) }
            ForEach(detail.skills, id: \.name) { skill in
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: skill.name).font(.callout.weight(.medium))
                    if let text = skill.description, !text.isEmpty {
                        Text(verbatim: text).font(.footnote).foregroundStyle(Theme.textSecondary)
                    }
                }
            }
        } header: { tabHeader("Skills", "Playbooks it can run", detail.skills.count) }
        Section {
            if detail.routines.isEmpty { Text("No routines.").foregroundStyle(Theme.textSecondary) }
            ForEach(Array(detail.routines.enumerated()), id: \.offset) { _, routine in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(verbatim: routine.name).font(.callout.weight(.medium))
                        if let schedule = routine.schedule { Text(verbatim: schedule).font(.footnote).foregroundStyle(Theme.textSecondary) }
                    }
                    Spacer()
                    if routine.enabled == false { Text("Paused").font(.footnote).foregroundStyle(Theme.textSecondary) }
                }
            }
        } header: { tabHeader("Routines", "Jobs that run on their own", detail.routines.count) }
        Section {
            if detail.integrations.isEmpty { Text("No integrations.").foregroundStyle(Theme.textSecondary) }
            ForEach(Array(detail.integrations.enumerated()), id: \.offset) { _, integration in
                LabeledContent(integration.name, value: Self.kindLabel(integration.kind))
            }
        } header: { tabHeader("Integrations", "Apps it can use", detail.integrations.count) }
    }

    @ViewBuilder private func templateTabs(_ template: BotCatalogTemplate) -> some View {
        if !template.soul.isEmpty {
            Section {
                MarkdownText(source: template.soul).font(.callout)
            } header: { tabHeader("Instructions", "Who it is and how it works", nil) }
        }
        if !template.skills.isEmpty {
            Section {
                ForEach(template.skills, id: \.self) { Text(verbatim: $0) }
            } header: { tabHeader("Skills", "Playbooks it can run", template.skills.count) }
        }
    }

    private func tabHeader(_ title: LocalizedStringKey, _ hint: LocalizedStringKey, _ count: Int?) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text(title)
                if let count { Text(verbatim: "\(count)").foregroundStyle(Theme.textSecondary) }
            }
            Text(hint).font(.caption2).textCase(nil)
        }
    }

    static func kindLabel(_ kind: String) -> String {
        switch kind {
        case "mcp": String(localized: "MCP server")
        case "app": String(localized: "Connected app")
        case "browser": String(localized: "Built-in browser")
        default: kind
        }
    }
}

/// Publish: a category (a default chip or one typed), then Publish.
struct BrowseBotsPublishSheet: View {
    let entry: BotCatalogEntry
    let categories: [String]
    let publish: (String?) -> Void
    let cancel: () -> Void
    @State private var category = ""

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Category", text: $category)
                        .textInputAutocapitalization(.words)
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(categories, id: \.self) { id in
                                Button(BrowseBotsModel.categoryLabel(id)) { category = BrowseBotsModel.categoryLabel(id) }
                                    .buttonStyle(.bordered)
                                    .buttonBorderShape(.capsule)
                                    .font(.footnote)
                            }
                        }
                    }
                } footer: {
                    Text("Pick one or type your own. Everyone in the organization will see this bot and can import a copy. Its conversations and memory stay private.")
                }
            }
            .navigationTitle(entry.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel", action: cancel) }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Publish") {
                        // a default chip's label maps back to its id
                        let id = categories.first { BrowseBotsModel.categoryLabel($0) == category } ?? category
                        publish(BotCatalogRules.normalizeCategory(id))
                    }
                }
            }
        }
        .presentationDetents([.medium])
    }
}
