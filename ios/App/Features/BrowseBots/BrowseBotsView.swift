// Browse Bots on iOS (desktop src/components/bot-catalog/BotCatalogModal.tsx,
// BotCatalogView.tsx, BotCatalogDetailView.tsx): the organisation bot
// catalogue, as Connect apps' Bots tab (2026-10-29) and as a sheet (the bot
// wizard's Browse templates, the large layout's sidebar). Same sections in the same order (Featured, Shared
// with me, My Bots, Organization, Templates), the same search and category
// chips, the same actions per bot (Add to my sidebar, Open, Import Bot,
// publish, feature) and a read-only detail page. The model is CompanionCore's
// `BotCatalogRules`; the routes are `/api/bot-catalog*`. The xAI Bot
// Marketplace is a section of its own (`/api/team-library/xai`, Refresh); Use
// stages the bot through the agent import (AgentImportSheet).
import CompanionCore
import SwiftUI

/// A marketplace bot being imported (the agent import sheet).
struct XaiImportTarget: Identifiable, Hashable { var slug: String; var id: String { slug } }

@MainActor
final class BrowseBotsModel: ObservableObject {
    @Published var xai: [XaiMarketplaceEntry] = []
    @Published var xaiError: String?
    @Published var xaiLoading = false
    @Published var xaiImport: XaiImportTarget?
    private var presets: [BotPreset] = []
    private var community: [TeamLibraryCatalog.Team] = []
    @Published var data: BotCatalogResponse?
    @Published var templates: [BotCatalogTemplate] = []
    @Published var failed = false
    @Published var filter = BotCatalogFilter()
    @Published var notice: String?
    @Published var working: String?
    /// The publish form's bot, and the zip import (#271), wherever the
    /// catalogue shows (the sheet or Connect apps' Bots tab).
    @Published var publishing: BotCatalogEntry?
    @Published var importingZip = false

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
        presets = await session.botPresets()
        community = []
        if session.surfaceGate.allows(.templates) {
            community = (try? await client.teamLibraryCatalog().teams) ?? []
        }
        rebuildTemplates()
        if xai.isEmpty, xaiError == nil { await loadXai(session) }
    }

    private func rebuildTemplates() {
        templates = BotCatalogRules.templates(presets: presets, community: community, roles: NewBotRules.builtInRoles, xai: xai)
    }

    /// The xAI Bot Marketplace (kept a few hours on the server; `refresh` reads x.ai again).
    func loadXai(_ session: Session, refresh: Bool = false) async {
        guard let client = session.profileClient else { return }
        xaiLoading = true
        defer { xaiLoading = false }
        do {
            let list = try await client.xaiMarketplace(refresh: refresh)
            xai = list.bots
            xaiError = list.stale.map { XaiMarketplaceRules.errorText(code: $0.code) + " " + String(localized: "These are the bots read earlier.") }
        } catch {
            xaiError = XaiMarketplaceRules.errorText(code: nil)
        }
        rebuildTemplates()
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
            case let (.useTemplate, .template(template)) where template.source == .xai:
                // previewed and imported in the agent import sheet
                if let slug = template.xaiSlug { xaiImport = XaiImportTarget(slug: slug) }
                return nil
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
        case .xai: XaiMarketplaceRules.label
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
/// Still opened from the bot wizard's "Browse templates" and the large
/// layout's sidebar place; Connect apps shows the same content in its Bots
/// tab (`BrowseBotsContent`, `BrowseBotsPresenters`).
struct BrowseBotsSheet: View {
    @EnvironmentObject private var session: Session
    @StateObject private var model = BrowseBotsModel()
    let close: () -> Void

    var body: some View {
        NavigationStack {
            List {
                BrowseBotsContent(model: model, open: open)
            }
            .listStyle(.insetGrouped)
            .searchable(text: $model.filter.query, prompt: Text("Search by creator or bot name"))
            .navigationTitle("Browse Bots")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done", action: close) }
                if model.data?.viewer.canCreate == true {
                    ToolbarItem(placement: .topBarLeading) {
                        Button { model.importingZip = true } label: { Label("Import from zip", systemImage: "doc.zipper") }
                            .accessibilityIdentifier("browse-bots.import-zip")
                    }
                }
            }
            .modifier(BrowseBotsPresenters(model: model, open: open))
            .task { await model.load(session) }
            .refreshable { await model.load(session) }
        }
        .accessibilityIdentifier("browse-bots")
    }

    private func open(_ bot: Bot) {
        close()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { session.openChat(threadId: bot.threadId) }
    }
}

/// What Browse Bots pushes and presents, on the navigation stack that shows
/// its content (the sheet's own, or Connect apps'): a bot's card, a
/// section's full list, the publish form, the xAI import, the zip import and
/// the short notice at the bottom.
struct BrowseBotsPresenters: ViewModifier {
    @EnvironmentObject private var session: Session
    @ObservedObject var model: BrowseBotsModel
    let open: (Bot) -> Void

    func body(content: Content) -> some View {
        content
            .navigationDestination(for: BotCatalogItem.self) { item in
                BrowseBotsDetail(item: item, model: model, open: open, publish: { model.publishing = $0 })
            }
            .navigationDestination(for: BotCatalogSectionID.self) { id in
                List {
                    if let section = model.sections.first(where: { $0.id == id }) {
                        ForEach(section.items) { item in BrowseBotsItemRow(model: model, item: item, open: open) }
                    }
                }
                .navigationTitle(BrowseBotsModel.sectionTitle(id))
            }
            .overlay(alignment: .bottom) { noticeBanner }
            .sheet(isPresented: $model.importingZip) {
                BotZipImportSheet(close: { model.importingZip = false }) { bot in
                    model.importingZip = false
                    if let bot { open(bot) } else { Task { await model.load(session) } }
                }
            }
            .sheet(item: $model.publishing) { entry in
                BrowseBotsPublishSheet(entry: entry, categories: model.categories.filter { $0 != "all" }) { category in
                    model.publishing = nil
                    Task { _ = await model.perform(.publish, on: .bot(entry), category: category, session: session) }
                } cancel: { model.publishing = nil }
            }
            .sheet(item: $model.xaiImport) { target in
                AgentImportSheet(close: { model.xaiImport = nil }, imported: { bot in
                    model.xaiImport = nil
                    if let bot { open(bot) } else { Task { await model.load(session) } }
                }, marketplaceSlug: target.slug)
            }
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

/// The catalogue's sections inside a list: the header (what this is, the
/// category chips, Show archived), then Featured, Shared with me, My Bots,
/// Organization, Templates and the xAI Bot Marketplace, each with View all.
/// `importRow`: Import from zip as a row (Connect apps has no toolbar
/// button for it).
struct BrowseBotsContent: View {
    @EnvironmentObject private var session: Session
    @ObservedObject var model: BrowseBotsModel
    let open: (Bot) -> Void
    var importRow = false

    var body: some View {
        BrowseBotsFilters(model: model, importRow: importRow)
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

    @ViewBuilder private func sectionView(_ section: BotCatalogSection) -> some View {
        Section {
            if section.id == .xai, let error = model.xaiError {
                Text(verbatim: error).font(.footnote).foregroundStyle(.red)
                    .accessibilityIdentifier("browse-bots.xai.error")
            }
            if section.items.isEmpty {
                if section.id == .xai, model.xaiLoading {
                    HStack { Text("Reading the xAI Bot Marketplace…").foregroundStyle(Theme.textSecondary); Spacer(); ProgressView() }
                } else if !(section.id == .xai && model.xaiError != nil) {
                    Text("Nothing here yet.").foregroundStyle(Theme.textSecondary)
                }
            } else {
                ForEach(section.items.prefix(BotCatalogRules.sectionPreview)) { item in
                    BrowseBotsItemRow(model: model, item: item, open: open)
                }
                if section.items.count > BotCatalogRules.sectionPreview {
                    NavigationLink(value: section.id) { Text("View all") }
                }
            }
        } header: {
            if section.id == .xai {
                HStack {
                    Text(BrowseBotsModel.sectionTitle(section.id))
                    Spacer()
                    Button { Task { await model.loadXai(session, refresh: true) } } label: {
                        Label(model.xaiLoading ? String(localized: "Refreshing…") : String(localized: "Refresh"), systemImage: "arrow.clockwise")
                            .font(.caption)
                    }
                    .disabled(model.xaiLoading)
                    .textCase(nil)
                    .accessibilityIdentifier("browse-bots.xai.refresh")
                }
            } else {
                Text(BrowseBotsModel.sectionTitle(section.id))
            }
        }
    }
}

/// Browse Bots' header: what the catalogue holds, the category chips and
/// Show archived (and Import from zip as a row in Connect apps). Connect
/// apps keeps it above the search results on the Bots tab: the chips
/// narrow the bots found.
struct BrowseBotsFilters: View {
    @ObservedObject var model: BrowseBotsModel
    var importRow = false

    var body: some View {
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
                            .accessibilityIdentifier("browse-bots.category.\(id)")
                    }
                }
            }
            .listRowInsets(EdgeInsets(top: 6, leading: 12, bottom: 6, trailing: 12))
            if model.hasArchived {
                Toggle("Show archived", isOn: $model.filter.showArchived).tint(Theme.toggleOn)
            }
            if importRow, model.data?.viewer.canCreate == true {
                Button { model.importingZip = true } label: {
                    Label("Import from zip", systemImage: "doc.zipper")
                        .foregroundStyle(Theme.textPrimary)
                }
                .accessibilityIdentifier("browse-bots.import-zip")
            }
        }
    }
}

/// One bot or template of a section: its row (to the card) and the card's
/// short action (Add, Use, Open...).
struct BrowseBotsItemRow: View {
    @EnvironmentObject private var session: Session
    @ObservedObject var model: BrowseBotsModel
    let item: BotCatalogItem
    let open: (Bot) -> Void

    var body: some View {
        let actions = model.actions(item)
        let card = BotCatalogRules.cardAction(actions).flatMap { action -> BotCatalogAction? in
            if action == .open, case let .bot(entry) = item, session.state.bot(entry.id) == nil { return nil }
            return action
        }
        HStack(spacing: 12) {
            NavigationLink(value: item) { BrowseBotsRow(item: item) }
            if let card {
                Button(BrowseBotsModel.cardLabel(card)) { run(card) }
                    .buttonStyle(.bordered)
                    .buttonBorderShape(.capsule)
                    .font(.footnote.weight(.medium))
                    .disabled(model.working == item.id)
                    .accessibilityIdentifier("browse-bots.card.\(item.id)")
            }
        }
    }

    private func run(_ action: BotCatalogAction) {
        Haptics.selection()
        Task {
            if let bot = await model.perform(action, on: item, session: session) { open(bot) }
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
            MascotCharacterView(look: (template.look ?? MascotLook.owl).complete, color: template.color, size: size)
        }
    }
}
