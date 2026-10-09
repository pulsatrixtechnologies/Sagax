// Browse Bots on iOS (desktop src/components/bot-catalog/BotCatalogModal.tsx,
// BotCatalogView.tsx, BotCatalogDetailView.tsx): the organisation bot
// catalogue as a sheet. Same sections in the same order (Featured, Shared
// with me, My Bots, Organization, Templates), the same search and category
// chips, the same actions per bot (Add to my sidebar, Open, Import Bot,
// publish, feature) and a read-only detail page. The model is CompanionCore's
// `BotCatalogRules`; the routes are `/api/bot-catalog*`.
import CompanionCore
import SwiftUI

@MainActor
final class BrowseBotsModel: ObservableObject {
    @Published var data: BotCatalogResponse?
    @Published var templates: [BotCatalogTemplate] = []
    @Published var failed = false
    @Published var filter = BotCatalogFilter()
    @Published var notice: String?
    @Published var working: String?

    func load(_ session: Session) async {
        guard let client = session.profileClient else { return }
        failed = false
        do {
            data = try await client.botCatalog()
        } catch {
            failed = data == nil
        }
        // presets and the community teams are an administrator's reads; a
        // member keeps the built-in roles, as on the desktop
        let presets = await session.botPresets()
        var community: [TeamLibraryCatalog.Team] = []
        if session.surfaceGate.allows(.templates) {
            community = (try? await client.teamLibraryCatalog().teams) ?? []
        }
        templates = BotCatalogRules.templates(presets: presets, community: community, roles: NewBotRules.builtInRoles)
    }

    var sections: [BotCatalogSection] {
        guard let data else { return [] }
        let all = BotCatalogRules.sections(data, templates: templates, filter: filter)
        // searching hides the empty sections
        let searching = !filter.query.trimmingCharacters(in: .whitespaces).isEmpty || filter.category != "all"
        return all.filter { !searching || !$0.items.isEmpty }
    }

    var categories: [String] {
        guard let data else { return ["all"] }
        let items = data.entries.map(BotCatalogItem.bot) + templates.map(BotCatalogItem.template)
        return BotCatalogRules.categories(items)
    }

    var hasArchived: Bool { data?.entries.contains { $0.source == .mine && $0.archived } ?? false }

    func actions(_ item: BotCatalogItem) -> [BotCatalogAction] {
        guard let data else { return [] }
        let hidden = SidebarPrefsModel.shared.prefs.hidden
        let keys = Set(hidden.items.map(\.key))
        return BotCatalogRules.actions(
            item, organization: data.organization, admin: data.viewer.admin, canCreate: data.viewer.canCreate,
            inSidebar: { !keys.contains(SidebarHidden.key(.bot, $0)) }
        )
    }

    func flash(_ text: String) {
        withAnimation { notice = text }
        Task {
            try? await Task.sleep(nanoseconds: 2_400_000_000)
            withAnimation { if notice == text { notice = nil } }
        }
    }

    /// Runs one action; returns the bot to open, if any.
    func perform(_ action: BotCatalogAction, on item: BotCatalogItem, category: String? = nil, session: Session) async -> Bot? {
        guard let client = session.profileClient else { return nil }
        working = item.id
        defer { working = nil }
        do {
            switch (action, item) {
            case let (.open, .bot(entry)):
                SidebarPrefsModel.shared.show(session, [SidebarHidden.key(.bot, entry.id)])
                return session.state.bot(entry.id)
            case let (.addToSidebar, .bot(entry)):
                SidebarPrefsModel.shared.show(session, [SidebarHidden.key(.bot, entry.id)])
                flash(String(localized: "\(entry.name) is back in your sidebar."))
            case let (.removeFromSidebar, .bot(entry)):
                SidebarPrefsModel.shared.hide(session, .bot, entry.id)
                flash(String(localized: "\(entry.name) was removed from your sidebar. It stays shared with you."))
            case let (.import, .bot(entry)):
                let botId = try await client.importCatalogBot(botId: entry.id)
                await session.refresh()
                flash(String(localized: "\(entry.name) was added to your bots."))
                _ = botId
            case let (.publish, .bot(entry)):
                _ = try await client.setBotCatalogListing(botId: entry.id, published: true, category: category)
                flash(String(localized: "Published to the organization catalog."))
            case let (.unpublish, .bot(entry)):
                _ = try await client.setBotCatalogListing(botId: entry.id, published: false)
                flash(String(localized: "Removed from the organization catalog."))
            case let (.feature, .bot(entry)), let (.unfeature, .bot(entry)):
                let on = action == .feature
                _ = try await client.setBotCatalogListing(botId: entry.id, published: true, category: entry.catalog?.category, featured: on)
                flash(on ? String(localized: "Featured in the catalog.") : String(localized: "No longer featured."))
            case let (.useTemplate, .template(template)):
                guard let draft = BotCatalogRules.draft(for: template), let bot = await session.createBot(draft) else { return nil }
                flash(String(localized: "\(bot.name) was added to your bots."))
            default:
                return nil
            }
            await load(session)
        } catch {
            session.actionError = error.localizedDescription
        }
        return nil
    }

    static func sectionTitle(_ id: BotCatalogSectionID) -> String {
        switch id {
        case .featured: String(localized: "Featured")
        case .shared: String(localized: "Shared with me")
        case .mine: String(localized: "My Bots")
        case .organization: String(localized: "Organization")
        case .templates: String(localized: "Templates")
        }
    }

    static func categoryLabel(_ id: String) -> String {
        switch id {
        case "all": String(localized: "All")
        case "engineering": String(localized: "Engineering")
        case "sales": String(localized: "Sales")
        case "marketing": String(localized: "Marketing")
        case "design": String(localized: "Design")
        case "personal": String(localized: "Personal")
        case "people": String(localized: "Recruiting & People")
        case "product": String(localized: "Product")
        case "operations": String(localized: "Operations")
        default: id
        }
    }

    static func actionLabel(_ action: BotCatalogAction) -> String {
        switch action {
        case .open: String(localized: "Open")
        case .addToSidebar: String(localized: "Add to my sidebar")
        case .removeFromSidebar: String(localized: "Remove from sidebar")
        case .import: String(localized: "Import Bot")
        case .useTemplate: String(localized: "Use this template")
        case .publish: String(localized: "Publish to the organization catalog")
        case .unpublish: String(localized: "Remove from the catalog")
        case .feature: String(localized: "Feature")
        case .unfeature: String(localized: "Stop featuring")
        }
    }

    /// The row button's short word (`cardActionLabel`).
    static func cardLabel(_ action: BotCatalogAction) -> String {
        switch action {
        case .import, .addToSidebar: String(localized: "Add")
        case .useTemplate: String(localized: "Use")
        case .removeFromSidebar: String(localized: "Remove")
        default: actionLabel(action)
        }
    }
}

/// The sheet: the home view, a section's full list and the detail page.
struct BrowseBotsSheet: View {
    @EnvironmentObject private var session: Session
    @StateObject private var model = BrowseBotsModel()
    let close: () -> Void
    @State private var publishing: BotCatalogEntry?

    var body: some View {
        NavigationStack {
            List {
                header
                if model.data == nil {
                    Section {
                        if model.failed {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("The catalog could not be loaded.").foregroundStyle(Theme.textSecondary)
                                Button("Try again") { Task { await model.load(session) } }
                            }
                        } else {
                            HStack { Text("Loading the catalog").foregroundStyle(Theme.textSecondary); Spacer(); ProgressView() }
                        }
                    }
                } else if model.sections.isEmpty {
                    Section { Text("No bot matches this search.").foregroundStyle(Theme.textSecondary) }
                } else {
                    ForEach(model.sections) { section in
                        sectionView(section)
                    }
                }
            }
            .listStyle(.insetGrouped)
            .searchable(text: $model.filter.query, prompt: Text("Search by creator or bot name"))
            .navigationTitle("Browse Bots")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done", action: close) }
            }
            .navigationDestination(for: BotCatalogItem.self) { item in
                BrowseBotsDetail(item: item, model: model, open: open, publish: { publishing = $0 })
            }
            .navigationDestination(for: BotCatalogSectionID.self) { id in
                List {
                    if let section = model.sections.first(where: { $0.id == id }) {
                        ForEach(section.items) { item in row(item) }
                    }
                }
                .navigationTitle(BrowseBotsModel.sectionTitle(id))
            }
            .overlay(alignment: .bottom) { noticeBanner }
            .sheet(item: $publishing) { entry in
                BrowseBotsPublishSheet(entry: entry, categories: model.categories.filter { $0 != "all" }) { category in
                    publishing = nil
                    Task { _ = await model.perform(.publish, on: .bot(entry), category: category, session: session) }
                } cancel: { publishing = nil }
            }
            .task { await model.load(session) }
            .refreshable { await model.load(session) }
        }
        .accessibilityIdentifier("browse-bots")
    }

    @ViewBuilder private var header: some View {
        Section {
            Text(model.data?.organization == true
                 ? String(localized: "Bots from your organization, the ones shared with you, your own and templates.")
                 : String(localized: "Your bots and templates to start a new one."))
                .font(.footnote)
                .foregroundStyle(Theme.textSecondary)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(model.categories, id: \.self) { id in
                        Button(BrowseBotsModel.categoryLabel(id)) { model.filter.category = id }
                            .buttonStyle(.bordered)
                            .buttonBorderShape(.capsule)
                            .tint(model.filter.category == id ? Theme.accent : Theme.textSecondary)
                            .font(.footnote)
                    }
                }
            }
            .listRowInsets(EdgeInsets(top: 6, leading: 12, bottom: 6, trailing: 12))
            if model.hasArchived {
                Toggle("Show archived", isOn: $model.filter.showArchived).tint(Theme.toggleOn)
            }
        }
    }

    @ViewBuilder private func sectionView(_ section: BotCatalogSection) -> some View {
        Section {
            if section.items.isEmpty {
                Text("Nothing here yet.").foregroundStyle(Theme.textSecondary)
            } else {
                ForEach(section.items.prefix(BotCatalogRules.sectionPreview)) { item in row(item) }
                if section.items.count > BotCatalogRules.sectionPreview {
                    NavigationLink(value: section.id) { Text("View all") }
                }
            }
        } header: {
            Text(BrowseBotsModel.sectionTitle(section.id))
        }
    }

    private func row(_ item: BotCatalogItem) -> some View {
        let actions = model.actions(item)
        let card = BotCatalogRules.cardAction(actions).flatMap { action -> BotCatalogAction? in
            if action == .open, case let .bot(entry) = item, session.state.bot(entry.id) == nil { return nil }
            return action
        }
        return HStack(spacing: 12) {
            NavigationLink(value: item) { BrowseBotsRow(item: item) }
            if let card {
                Button(BrowseBotsModel.cardLabel(card)) { run(card, item) }
                    .buttonStyle(.bordered)
                    .buttonBorderShape(.capsule)
                    .font(.footnote.weight(.medium))
                    .disabled(model.working == item.id)
                    .accessibilityIdentifier("browse-bots.card.\(item.id)")
            }
        }
    }

    private func run(_ action: BotCatalogAction, _ item: BotCatalogItem) {
        Haptics.selection()
        Task {
            if let bot = await model.perform(action, on: item, session: session) { open(bot) }
        }
    }

    private func open(_ bot: Bot) {
        close()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { session.openChat(threadId: bot.threadId) }
    }

    @ViewBuilder private var noticeBanner: some View {
        if let notice = model.notice {
            Text(verbatim: notice)
                .font(.footnote.weight(.medium))
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(.regularMaterial, in: Capsule())
                .padding(.bottom, 16)
                .transition(.move(edge: .bottom).combined(with: .opacity))
        }
    }
}

/// One row: the mascot, "Name by Owner", the badges and one line.
struct BrowseBotsRow: View {
    @EnvironmentObject private var session: Session
    let item: BotCatalogItem

    var body: some View {
        HStack(spacing: 12) {
            BrowseBotsFace(item: item, size: 40)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 4) {
                    Text(verbatim: item.name).font(.body.weight(.semibold)).lineLimit(1)
                    Text("by \(item.creator)").font(.footnote).foregroundStyle(Theme.textSecondary).lineLimit(1)
                }
                badges
                Text(verbatim: blurb).font(.footnote).foregroundStyle(Theme.textSecondary).lineLimit(1)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var blurb: String {
        switch item {
        case let .bot(entry): entry.blurb
        case let .template(template): template.description.isEmpty ? template.title : template.description
        }
    }

    @ViewBuilder private var badges: some View {
        let labels = Self.badges(item)
        if !labels.isEmpty {
            HStack(spacing: 4) {
                ForEach(labels, id: \.self) { label in
                    Text(verbatim: label)
                        .font(.caption2.weight(.medium))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 1)
                        .background(Theme.textSecondary.opacity(0.14), in: Capsule())
                }
            }
        }
    }

    static func badges(_ item: BotCatalogItem) -> [String] {
        switch item {
        case .template: return [String(localized: "Template")]
        case let .bot(entry):
            var out: [String] = []
            if entry.archived { out.append(String(localized: "Archived")) }
            if entry.catalog?.featured == true, entry.published { out.append(String(localized: "Featured")) }
            else if entry.published, entry.source == .mine { out.append(String(localized: "In the catalog")) }
            return out
        }
    }
}

/// The bot's own face when the phone holds the bot (its picture too), else
/// the character from the catalogue's look.
struct BrowseBotsFace: View {
    @EnvironmentObject private var session: Session
    let item: BotCatalogItem
    let size: CGFloat

    var body: some View {
        switch item {
        case let .bot(entry):
            if let bot = session.state.bot(entry.id) {
                BotMascotView(bot: bot, size: size)
            } else {
                MascotCharacterView(look: entry.look.resolvedLook, color: entry.look.color, skin: entry.look.resolvedSkin, size: size)
            }
        case let .template(template):
            MascotCharacterView(look: MascotLook.owl.complete, color: template.color, size: size)
        }
    }
}
