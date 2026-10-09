// Connect apps on the phone (#203, #206, #207, #218; matrix DC35 to DC39):
// the desktop's Plugins panel in its three views, with the same routes and
// the same rows (`ConnectApps` in CompanionCore, a port of plugins-model.ts):
//
// - Connect apps (main): search across apps and skills, the category chips
//   (All, Password managers, Productivity, Communication, Design, Code,
//   More), a section per category with View all, one row per app with Add
//   or Connect, and "N connected >" to Manage.
// - Manage: Plugins and skills (Installed, Private skills, Advanced with the
//   marketplaces) | Providers.
// - A plugin's page: its accounts, its tools with a switch each (applied to
//   every bot), its details, Uninstall; a private skill's page.
//
// The phone keeps its own presentation (a navigation stack of lists); the
// names, groupings and order are the desktop's. Writes the desktop gives an
// admin (MCP servers, marketplaces, the skills library) show only to an
// administering pairing; the Composio setup card and the MCP trust notice
// are gone (#197).
import CompanionCore
import SwiftUI
import UIKit

@MainActor
final class ConnectAppsModel: ObservableObject {
    @Published private(set) var items: [ConnectAppItem] = []
    @Published private(set) var loading = true
    @Published private(set) var servers: [MCPServerListing] = []
    @Published private(set) var disabledTools: [String: [String]] = [:]
    @Published private(set) var marketplaces: [Marketplace] = []
    @Published private(set) var statuses: [String: ConnectorStatus] = [:]
    @Published private(set) var probes: [String: MCPProbe] = [:]
    @Published private(set) var probing: Set<String> = []
    @Published private(set) var claudeConnectors = 0
    @Published var busy: String?
    @Published var message: String?
    @Published var query = ""
    @Published var filter: ConnectAppFilter = .all
    @Published var type: ConnectAppTypeFilter = .any

    private var cards: [ConnectorCard] = []
    private var categories: [String: [String]] = [:]
    private var featured: [PluginListing] = []
    private var skills: [LibrarySkill] = []
    private var composioUsable = true

    var sections: [ConnectApps.Section] {
        ConnectApps.sections(items, query: query, filter: filter, type: type, extraSources: marketplaces.map(\.name))
    }

    var summary: (count: Int, icons: [ConnectAppItem]) { ConnectApps.connected(items, extra: claudeConnectors) }

    func item(_ key: String) -> ConnectAppItem? { items.first { $0.key == key } }

    func load(_ session: Session) async {
        guard let client = session.settingsClient else { loading = false; return }
        async let catalog = try? client.connectorCatalog()
        async let cardCategories = try? client.connectorCategories()
        async let servers = try? client.mcpServers()
        async let disabled = try? client.mcpDisabledTools()
        async let page = try? client.searchPlugins()
        async let skills = try? client.skillsLibrary()
        async let markets = try? client.marketplaces()
        let loadedCatalog = await catalog
        cards = loadedCatalog?.cards ?? []
        composioUsable = loadedCatalog?.configured ?? false
        categories = await cardCategories ?? [:]
        self.servers = await servers?.servers ?? []
        disabledTools = await disabled ?? [:]
        featured = await page?.featured ?? []
        self.skills = await skills ?? []
        marketplaces = await markets ?? []
        if !cards.isEmpty, let answer = try? await client.connectorStatuses(services: cards.map(\.slug)) {
            statuses = answer.services
        }
        rebuild()
        loading = false
        // the claude.ai connectors count in "N connected"; that answer can
        // take a while, so the list does not wait for it
        if let harness = try? await client.harnessConnectors() {
            claudeConnectors = harness.claude.connectors.count
        }
    }

    private func rebuild() {
        items = ConnectApps.items(ConnectAppSources(
            cards: cards, cardCategories: categories, status: statuses,
            servers: servers.map { ConnectAppServer(name: $0.name, enabled: $0.enabled ?? true, url: $0.url, command: $0.command, auth: $0.auth, managedBy: $0.managedBy, source: $0.source) },
            featured: featured.map { ConnectAppFeatured(id: $0.id, name: $0.name, description: $0.description, url: $0.url, domain: $0.domain, auth: $0.auth, installed: $0.installed, iconUrl: $0.iconUrl) },
            skills: skills, marketplaces: marketplaces, composioUsable: composioUsable
        ))
    }

    func server(_ name: String) -> MCPServerListing? { servers.first { $0.name == name } }
    func card(_ slug: String) -> ConnectorCard? { cards.first { $0.slug == slug } }
    func skill(_ name: String) -> LibrarySkill? { skills.first { $0.name == name } }

    // MARK: Actions

    private func run(_ key: String, _ session: Session, _ work: (CompanionClient) async throws -> Void) async {
        guard let client = session.settingsClient else { return }
        busy = key
        defer { busy = nil }
        do {
            try await work(client)
        } catch {
            message = error.localizedDescription
        }
        await load(session)
    }

    /// Add or Connect on a row.
    func act(_ item: ConnectAppItem, alias: String?, session: Session) async {
        switch item.kind {
        case .app:
            await run(item.key, session) { client in
                let url = try await client.authorizeConnector(slug: item.id, alias: alias)
                if !(await UIApplication.shared.open(url)) {
                    message = String(localized: "The authorization page could not be opened. Try again after checking your browser restrictions.")
                }
            }
        case .featured:
            await run(item.key, session) { client in
                let result = try await client.installPlugin(id: item.id, trust: false)
                if let url = result.authorizationUrl { _ = try? await WebSignIn.run(url: url) }
            }
        case .plugin:
            let parts = item.id.split(separator: "@", maxSplits: 1).map(String.init)
            guard parts.count == 2 else { return }
            await run(item.key, session) { try await $0.setMarketplacePlugin(marketplace: parts[1], plugin: parts[0], installed: true) }
        case .mcp, .skill:
            break
        }
    }

    func signIn(_ server: MCPServerListing, session: Session) async {
        await run("mcp:\(server.name)", session) { client in
            _ = try? await WebSignIn.run(url: try await client.startPluginSignIn(serverName: server.name))
        }
    }

    func listTools(_ server: String, session: Session) async {
        guard let client = session.settingsClient, !probing.contains(server) else { return }
        probing.insert(server)
        defer { probing.remove(server) }
        do { probes[server] = try await client.testMCPServer(name: server) } catch { message = error.localizedDescription }
    }

    func setTool(_ tool: String, enabled: Bool, server: String, session: Session) async {
        guard let client = session.settingsClient else { return }
        let next = MCPToolSwitch.toggled(disabledTools[server] ?? [], tool: tool, enabled: enabled)
        disabledTools[server] = next
        do { try await client.setMCPDisabledTools(name: server, disabledTools: next) } catch {
            message = error.localizedDescription
            disabledTools = (try? await client.mcpDisabledTools()) ?? disabledTools
        }
    }

    func setServer(_ name: String, enabled: Bool, session: Session) async {
        await run("mcp:\(name)", session) { try await $0.setMCPServer(name: name, enabled: enabled) }
    }

    func uninstall(_ item: ConnectAppItem, session: Session) async {
        switch item.kind {
        case .mcp:
            await run(item.key, session) { try await $0.removeMCPServer(name: item.id) }
        case .plugin:
            let parts = item.id.split(separator: "@", maxSplits: 1).map(String.init)
            guard parts.count == 2 else { return }
            await run(item.key, session) { try await $0.setMarketplacePlugin(marketplace: parts[1], plugin: parts[0], installed: false) }
        case .app:
            let accounts = statuses[item.id]?.accounts ?? []
            await run(item.key, session) { client in
                for account in accounts { try await client.disconnectConnectorAccount(slug: item.id, accountId: account.id) }
            }
        case .featured, .skill:
            break
        }
    }

    func disconnect(_ slug: String, account: ConnectorAccount, session: Session) async {
        await run("app:\(slug)", session) { try await $0.disconnectConnectorAccount(slug: slug, accountId: account.id) }
    }

    func setSkill(_ name: String, enabled: Bool, session: Session) async {
        await run("skill:\(name)", session) { try await $0.setLibrarySkill(name: name, enabled: enabled) }
    }

    func addMarketplace(_ source: String, ref: String, session: Session) async {
        await run("market:new", session) { try await $0.addMarketplace(source: source, ref: ref) }
    }

    func refreshMarketplace(_ name: String, session: Session) async {
        await run("market:\(name)", session) { try await $0.refreshMarketplace(name: name) }
    }

    func removeMarketplace(_ name: String, session: Session) async {
        await run("market:\(name)", session) { try await $0.removeMarketplace(name: name) }
    }
}

// MARK: - Routes

enum ConnectAppsRoute: Hashable {
    case manage
    case detail(String)
    case skill(String)
}

/// The whole panel: the main view and what it pushes.
struct ConnectAppsPage: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @StateObject private var model = ConnectAppsModel()
    @State private var path = NavigationPath()
    @Environment(\.dismiss) private var dismiss
    @Environment(\.settingsPop) private var settingsPop
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        NavigationStack(path: $path) {
            ConnectAppsMain(model: model) { path.append($0) }
                .navigationTitle(String(localized: "Connect apps"))
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(String(localized: "Done")) {
                            if let settingsPop { settingsPop() } else { dismiss() }
                        }
                        .accessibilityIdentifier("connect-apps-done")
                    }
                }
                .navigationDestination(for: ConnectAppsRoute.self) { route in
                    switch route {
                    case .manage: ConnectAppsManage(model: model) { path.append($0) }
                    case let .detail(key): ConnectAppDetail(model: model, key: key) { path.append($0) }
                    case let .skill(name): LibrarySkillPage(model: model, name: name)
                    }
                }
        }
        .tint(Theme.textPrimary)
        .task { await model.load(session) }
        // back from an authorization page in the browser
        .onValueChange(of: scenePhase) { phase in
            if phase == .active { Task { await model.load(session) } }
        }
        .alert(String(localized: "Connect apps"), isPresented: Binding(get: { model.message != nil }, set: { if !$0 { model.message = nil } })) {
            Button(String(localized: "OK"), role: .cancel) {}
        } message: {
            Text(verbatim: model.message ?? "")
        }
    }
}

// MARK: - Shared row parts

enum ConnectAppsWords {
    static func category(_ category: ConnectAppCategory) -> String {
        switch category {
        case .passwords: String(localized: "Password managers")
        case .productivity: String(localized: "Productivity")
        case .communication: String(localized: "Communication")
        case .design: String(localized: "Design")
        case .code: String(localized: "Code")
        case .data: String(localized: "Data")
        case .sales: String(localized: "Sales")
        case .finance: String(localized: "Finance")
        case .marketing: String(localized: "Marketing")
        case .research: String(localized: "Research")
        case .support: String(localized: "Support")
        case .other: String(localized: "Other")
        }
    }

    static func type(_ type: ConnectAppTypeFilter) -> String {
        switch type {
        case .any: String(localized: "All types")
        case .apps: String(localized: "Connected apps")
        case .mcp: String(localized: "MCP servers")
        case .skills: String(localized: "Skills")
        case let .source(name): name
        }
    }

    static func section(_ id: ConnectApps.SectionID) -> String {
        switch id {
        case .results: String(localized: "Results")
        case .recommended: String(localized: "Recommended for you")
        case .mcp: String(localized: "Your MCP servers")
        case .skills: String(localized: "Skills")
        case let .category(category): Self.category(category)
        case let .source(name): name
        case let .type(type): Self.type(type)
        }
    }

    static func status(_ status: ConnectAppStatus) -> String {
        switch status {
        case .connected: String(localized: "Connected")
        case .needsAuth: String(localized: "Needs sign-in")
        case .pending: String(localized: "Finishing sign-in")
        case .off: String(localized: "Off")
        case .available: String(localized: "Available")
        }
    }

    static func source(_ source: String) -> String {
        switch source {
        case "manual": String(localized: "Added manually")
        case "catalog": String(localized: "Sagax plugin catalog")
        case "composio": String(localized: "Connected apps (Composio)")
        case "local": String(localized: "Created locally")
        default: source
        }
    }
}

struct ConnectAppIcon: View {
    let item: ConnectAppItem
    var size: CGFloat = 34

    var body: some View {
        if item.kind == .skill {
            PluginsGlyphTile(systemImage: "sparkles", size: size)
        } else {
            PluginIconTile(key: item.domain.map { $0.split(separator: ".").dropLast().last.map(String.init) ?? $0 }, remote: item.logo, size: size)
        }
    }
}

/// One row of the main view or Manage: icon, name, description, and the
/// button (Add, Connect) or the status.
struct ConnectAppRow: View {
    @Environment(\.themePalette) var themePalette
    let item: ConnectAppItem
    let busy: Bool
    let act: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            ConnectAppIcon(item: item)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: item.name)
                    .font(.body.weight(.medium))
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(1)
                if !item.description.isEmpty {
                    Text(verbatim: item.description)
                        .font(.footnote)
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            if busy {
                ProgressView().controlSize(.small)
            } else if let action = item.action {
                Button(action: act) {
                    Text(action == .add ? String(localized: "Add") : String(localized: "Connect"))
                        .font(.footnote.weight(.semibold))
                }
                .buttonStyle(.bordered)
                .accessibilityIdentifier("connect-apps-action.\(item.key)")
            } else {
                Text(verbatim: ConnectAppsWords.status(item.status))
                    .font(.footnote)
                    .foregroundStyle(item.status == .connected ? Theme.accentText : Theme.textSecondary)
            }
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("connect-apps-row.\(item.key)")
    }
}

// MARK: - Main view

struct ConnectAppsMain: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @ObservedObject var model: ConnectAppsModel
    let push: (ConnectAppsRoute) -> Void
    @State private var expanded: Set<ConnectApps.SectionID> = []
    @State private var aliasFor: ConnectAppItem?
    @State private var aliasDraft = ""

    var body: some View {
        ThemedList {
            Section {
                connectedLink
                chips
            }
            if model.loading && model.items.isEmpty {
                Section { HStack { Spacer(); ProgressView(); Spacer() } }
            }
            ForEach(model.sections) { section in
                Section {
                    let shown = expanded.contains(section.id) || section.viewAll == nil ? section.items : Array(section.items.prefix(ConnectApps.sectionPreview))
                    ForEach(shown) { item in
                        Button { open(item) } label: {
                            ConnectAppRow(item: item, busy: model.busy == item.key) { act(item) }
                        }
                        .buttonStyle(.plain)
                    }
                    if let viewAll = section.viewAll, section.total > section.items.count {
                        Button(String(localized: "View all")) {
                            switch viewAll {
                            case let .filter(filter): model.filter = filter
                            case let .type(type): model.type = type
                            }
                        }
                        .accessibilityIdentifier("connect-apps-view-all")
                    }
                } header: {
                    Text(verbatim: ConnectAppsWords.section(section.id))
                }
            }
            if !model.loading, model.sections.isEmpty {
                Section { Text(String(localized: "Nothing matches")).foregroundStyle(Theme.textSecondary) }
            }
        }
        .searchable(text: $model.query, prompt: Text(String(localized: "Search across apps and skills")))
        .refreshable { await model.load(session) }
        .accessibilityIdentifier("connect-apps")
        .alert(String(localized: "Connect"), isPresented: Binding(get: { aliasFor != nil }, set: { if !$0 { aliasFor = nil } })) {
            TextField(String(localized: "work, personal..."), text: $aliasDraft)
            Button(String(localized: "Cancel"), role: .cancel) {}
            Button(String(localized: "Connect")) {
                guard let item = aliasFor else { return }
                let alias = aliasDraft.trimmingCharacters(in: .whitespacesAndNewlines)
                Task { await model.act(item, alias: alias.isEmpty ? nil : String(alias.prefix(64)), session: session) }
            }
        } message: {
            Text(String(localized: "A label for the account, such as work or personal."))
        }
    }

    /// "N connected >" with up to four icons: opens Manage.
    private var connectedLink: some View {
        let summary = model.summary
        return Button { push(.manage) } label: {
            HStack(spacing: 8) {
                HStack(spacing: -8) {
                    ForEach(summary.icons) { ConnectAppIcon(item: $0, size: 24) }
                }
                Text(String(localized: "\(summary.count) connected"))
                    .foregroundStyle(Theme.textPrimary)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Theme.textTertiary)
            }
        }
        .accessibilityIdentifier("connect-apps-manage")
    }

    /// All, the main categories, More (the rest), then the type filter.
    private var chips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                chip(String(localized: "All"), selected: model.filter == .all && model.type == .any) {
                    model.filter = .all
                    model.type = .any
                }
                ForEach(ConnectAppCategory.main, id: \.self) { category in
                    chip(ConnectAppsWords.category(category), selected: model.filter == .category(category)) {
                        model.filter = model.filter == .category(category) ? .all : .category(category)
                    }
                }
                Menu {
                    ForEach(ConnectAppCategory.more, id: \.self) { category in
                        Button(ConnectAppsWords.category(category)) { model.filter = .category(category) }
                    }
                } label: {
                    chipLabel(moreTitle, selected: ConnectAppCategory.more.contains { model.filter == .category($0) })
                }
                Menu {
                    let types: [ConnectAppTypeFilter] = [.any, .apps, .mcp, .skills] + model.marketplaces.map { .source($0.name) }
                    ForEach(types, id: \.self) { type in
                        Button(ConnectAppsWords.type(type)) { model.type = type }
                    }
                } label: {
                    chipLabel(ConnectAppsWords.type(model.type), selected: model.type != .any, systemImage: "line.3.horizontal.decrease")
                }
                .accessibilityIdentifier("connect-apps-type")
            }
            .padding(.vertical, 2)
        }
        .accessibilityIdentifier("connect-apps-chips")
    }

    private var moreTitle: String {
        if case let .category(category) = model.filter, ConnectAppCategory.more.contains(category) { return ConnectAppsWords.category(category) }
        return String(localized: "More")
    }

    private func chip(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button {
            Haptics.selection()
            action()
        } label: { chipLabel(title, selected: selected) }
        .buttonStyle(.plain)
    }

    private func chipLabel(_ title: String, selected: Bool, systemImage: String? = nil) -> some View {
        HStack(spacing: 4) {
            if let systemImage { Image(systemName: systemImage).font(.caption2) }
            Text(verbatim: title).font(.footnote.weight(.medium)).lineLimit(1)
        }
        .padding(.horizontal, 12)
        .frame(height: 30)
        .foregroundStyle(selected ? Theme.accentInk : Theme.textPrimary)
        .background(selected ? Theme.accent : Theme.chip, in: Capsule())
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func open(_ item: ConnectAppItem) {
        if item.kind == .skill { push(.skill(item.id)) } else { push(.detail(item.key)) }
    }

    private func act(_ item: ConnectAppItem) {
        if item.kind == .app, item.action == .connect {
            aliasDraft = ""
            aliasFor = item
        } else {
            Task { await model.act(item, alias: nil, session: session) }
        }
    }
}

// MARK: - Manage

struct ConnectAppsManage: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @ObservedObject var model: ConnectAppsModel
    let push: (ConnectAppsRoute) -> Void
    @State private var tab = Tab.plugins
    @State private var showAll = false
    @State private var marketSource = ""
    @State private var marketRef = ""
    @State private var removingMarket: String?

    enum Tab: Hashable { case plugins, providers }

    private static let installedPreview = 8

    private var tabs: some View {
        Picker(String(localized: "Manage"), selection: $tab) {
            Text(String(localized: "Plugins and skills")).tag(Tab.plugins)
            Text(String(localized: "Providers")).tag(Tab.providers)
        }
        .pickerStyle(.segmented)
        .accessibilityIdentifier("connect-apps-manage-tabs")
    }

    var body: some View {
        Group {
            switch tab {
            case .plugins:
                ThemedList {
                    Section { tabs }
                    plugins
                }
            case .providers:
                // the Claude connectors block draws its own rows and switch
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        tabs
                        ConnectAppsProviders()
                    }
                    .padding(16)
                }
                .background(Theme.bg.ignoresSafeArea())
            }
        }
        .navigationTitle(String(localized: "Manage plugins and skills"))
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog(
            String(localized: "Remove the \(removingMarket ?? "") marketplace?"),
            isPresented: Binding(get: { removingMarket != nil }, set: { if !$0 { removingMarket = nil } }),
            titleVisibility: .visible
        ) {
            Button(String(localized: "Remove"), role: .destructive) {
                if let name = removingMarket { Task { await model.removeMarketplace(name, session: session) } }
            }
        }
    }

    @ViewBuilder
    private var plugins: some View {
        let installed = ConnectApps.installed(model.items)
        Section {
            if installed.isEmpty {
                Text(String(localized: "Nothing is installed yet. Connect an app from Connect apps, or add an MCP server on your computer."))
                    .font(.footnote)
                    .foregroundStyle(Theme.textSecondary)
            }
            ForEach(showAll ? installed : Array(installed.prefix(Self.installedPreview))) { item in
                Button { push(.detail(item.key)) } label: {
                    HStack(spacing: 12) {
                        ConnectAppIcon(item: item)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(verbatim: item.name).foregroundStyle(Theme.textPrimary).lineLimit(1)
                            Text(verbatim: countLine(item)).font(.footnote).foregroundStyle(Theme.textSecondary).lineLimit(1)
                        }
                        Spacer(minLength: 8)
                        Text(verbatim: item.status == .connected ? String(localized: "Connected") : (item.status == .off ? String(localized: "Off") : String(localized: "Not connected")))
                            .font(.footnote)
                            .foregroundStyle(item.status == .connected ? Theme.success : Theme.textSecondary)
                    }
                }
                .accessibilityIdentifier("connect-apps-installed.\(item.key)")
            }
            if installed.count > Self.installedPreview {
                Button(showAll ? String(localized: "Show fewer") : String(localized: "Show all \(installed.count) plugins")) { showAll.toggle() }
                    .accessibilityIdentifier("connect-apps-show-all")
            }
        } header: {
            Text(String(localized: "Installed"))
        }
        Section {
            let skills = ConnectApps.privateSkills(model.items)
            if skills.isEmpty {
                Text(String(localized: "No private skills yet. Create one, or add a marketplace plugin that brings some."))
                    .font(.footnote)
                    .foregroundStyle(Theme.textSecondary)
            }
            ForEach(skills) { item in
                Button { push(.skill(item.id)) } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(verbatim: item.name).foregroundStyle(Theme.textPrimary)
                        Text(verbatim: [String(localized: "Created locally"), item.description].filter { !$0.isEmpty }.joined(separator: " · "))
                            .font(.footnote)
                            .foregroundStyle(Theme.textSecondary)
                            .lineLimit(2)
                    }
                }
            }
        } header: {
            Text(String(localized: "Private skills"))
        }
        if session.canAdminister {
            // Add manually and Paste config need a keyboard and secrets: they
            // stay on the computer; the marketplaces work from here.
            Section {
                ForEach(model.marketplaces) { market in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(verbatim: market.name)
                            Text(String(localized: "\(market.plugins.count) plugins, \(market.plugins.filter(\.installed).count) installed"))
                                .font(.footnote)
                                .foregroundStyle(Theme.textSecondary)
                        }
                        Spacer()
                        if model.busy == "market:\(market.name)" { ProgressView().controlSize(.small) }
                    }
                    .swipeActions {
                        if !market.plugins.contains(where: \.installed) {
                            Button(String(localized: "Remove"), role: .destructive) { removingMarket = market.name }
                        }
                        Button(String(localized: "Refresh")) { Task { await model.refreshMarketplace(market.name, session: session) } }
                    }
                }
                TextField(String(localized: "owner/repo or https://..."), text: $marketSource)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .accessibilityIdentifier("connect-apps-market-source")
                TextField(String(localized: "Branch (optional)"), text: $marketRef)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                Button(String(localized: "Add marketplace")) {
                    let source = marketSource.trimmingCharacters(in: .whitespacesAndNewlines)
                    let ref = marketRef.trimmingCharacters(in: .whitespacesAndNewlines)
                    marketSource = ""
                    marketRef = ""
                    Task { await model.addMarketplace(source, ref: ref, session: session) }
                }
                .disabled(marketSource.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.busy == "market:new")
            } header: {
                Text(String(localized: "Advanced") + " · " + String(localized: "Marketplaces"))
            } footer: {
                Text(String(localized: "Add a Claude Code plugin marketplace: a GitHub repository (owner/repo, optionally a branch), an https git address, or the address of its marketplace.json."))
            }
        }
    }

    private func countLine(_ item: ConnectAppItem) -> String {
        switch item.kind {
        case .plugin:
            let children = model.items.filter { $0.parent == item.key }
            let servers = children.filter { $0.kind == .mcp }.count
            let skills = children.filter { $0.kind == .skill }.count
            return [servers == 1 ? String(localized: "1 connector") : String(localized: "\(servers) connectors"),
                    skills == 1 ? String(localized: "1 skill") : String(localized: "\(skills) skills")].joined(separator: " · ")
        default:
            return String(localized: "1 connector")
        }
    }
}

/// Manage > Providers (#207): the claude.ai connectors of the person's
/// account; the other providers' connectors do not reach bots.
struct ConnectAppsProviders: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @StateObject private var harness = HarnessConnectorsModel()

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(String(localized: "The engine accounts on this installation, and the connectors each one brings to bots. A provider's connectors act as that account."))
                .font(.footnote)
                .foregroundStyle(Theme.textSecondary)
            if session.surfaceGate.allows(.harnessConnectors) {
                HarnessConnectorsSection(model: harness)
                    .task { await harness.load(session.settingsClient) }
            }
            VStack(alignment: .leading, spacing: 6) {
                Text(String(localized: "Grok: its connectors do not reach bots in Sagax."))
                Text(String(localized: "Gemini: Google's extensions do not reach bots in Sagax."))
            }
            .font(.footnote)
            .foregroundStyle(Theme.textSecondary)
        }
    }
}

// MARK: - A plugin's page

struct ConnectAppDetail: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @ObservedObject var model: ConnectAppsModel
    let key: String
    let push: (ConnectAppsRoute) -> Void
    @State private var toolsOpen = false
    @State private var confirmingUninstall = false

    var body: some View {
        Group {
            if let item = model.item(key) {
                content(item)
                    .navigationTitle(item.name)
            } else {
                ThemedList { Text(String(localized: "This plugin is no longer installed.")).foregroundStyle(Theme.textSecondary) }
            }
        }
        .navigationBarTitleDisplayMode(.inline)
    }

    private func content(_ item: ConnectAppItem) -> some View {
        ThemedList {
            Section {
                HStack(spacing: 12) {
                    ConnectAppIcon(item: item, size: 44)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(verbatim: item.name).font(.headline)
                        Text(verbatim: item.description).font(.footnote).foregroundStyle(Theme.textSecondary).lineLimit(2)
                    }
                }
                if let action = item.action {
                    Button(action == .add ? String(localized: "Add") : String(localized: "Connect")) {
                        Task { await model.act(item, alias: nil, session: session) }
                    }
                }
            }
            switch item.kind {
            case .mcp: mcpSections(item)
            case .app: appSections(item)
            case .plugin: pluginSections(item)
            case .featured, .skill: EmptyView()
            }
            Section {
                detailRow(String(localized: "Source"), ConnectAppsWords.source(item.source))
                if let version = item.version { detailRow(String(localized: "Version"), version) }
                if item.kind == .mcp, let server = model.server(item.id) {
                    detailRow(String(localized: "Transport"), server.isRemote ? (server.type == "sse" ? "SSE" : "HTTP") : "stdio")
                    detailRow(server.isRemote ? String(localized: "URL") : String(localized: "Command"), server.url ?? ([server.command ?? ""] + (server.args ?? [])).joined(separator: " "))
                }
            } header: {
                Text(String(localized: "Details"))
            }
            if item.installed, item.kind != .featured, session.canAdminister || item.kind == .app {
                Section {
                    Button(String(localized: "Uninstall"), role: .destructive) { confirmingUninstall = true }
                        .accessibilityIdentifier("connect-apps-uninstall")
                }
            }
        }
        .confirmationDialog(String(localized: "Uninstall \(item.name)?"), isPresented: $confirmingUninstall, titleVisibility: .visible) {
            Button(String(localized: "Uninstall"), role: .destructive) {
                Task { await model.uninstall(item, session: session) }
            }
        }
    }

    @ViewBuilder
    private func mcpSections(_ item: ConnectAppItem) -> some View {
        if let server = model.server(item.id) {
            Section {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(verbatim: server.auth == "connected" ? (server.authIssuer ?? String(localized: "Signed in")) : String(localized: "default"))
                        Text(verbatim: accountLine(server)).font(.footnote).foregroundStyle(Theme.textSecondary)
                    }
                    Spacer()
                    if ["required", "expired", "error"].contains(server.auth ?? "") {
                        Button(String(localized: "Sign in")) { Task { await model.signIn(server, session: session) } }
                            .buttonStyle(.bordered)
                            .accessibilityIdentifier("connect-apps-sign-in")
                    }
                }
                if session.canAdminister {
                    Toggle(String(localized: "Turned on"), isOn: Binding(
                        get: { server.enabled ?? true },
                        set: { on in Task { await model.setServer(server.name, enabled: on, session: session) } }
                    ))
                    .disabled(server.managedBy != nil)
                }
            } header: {
                Text(String(localized: "Accounts"))
            }
            Section {
                DisclosureGroup(isExpanded: $toolsOpen) {
                    toolList(server.name)
                } label: {
                    HStack {
                        Text(String(localized: "Tools"))
                        Spacer()
                        Text(verbatim: toolCount(server.name)).font(.footnote).foregroundStyle(Theme.textSecondary)
                    }
                }
                .onValueChange(of: toolsOpen) { open in
                    if open, model.probes[server.name] == nil { Task { await model.listTools(server.name, session: session) } }
                }
                .accessibilityIdentifier("connect-apps-tools")
            } footer: {
                Text(String(localized: "A tool turned off here is hidden from every bot. Each bot's Access settings can narrow the rest."))
            }
        }
    }

    @ViewBuilder
    private func toolList(_ server: String) -> some View {
        if let probe = model.probes[server] {
            if let error = probe.error, !probe.ok {
                Text(verbatim: error).font(.footnote).foregroundStyle(Theme.danger)
            }
            ForEach(probe.switches(disabled: model.disabledTools[server] ?? []), id: \.tool.name) { entry in
                Toggle(isOn: Binding(
                    get: { !(model.disabledTools[server] ?? []).contains(entry.tool.name) },
                    set: { on in Task { await model.setTool(entry.tool.name, enabled: on, server: server, session: session) } }
                )) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(verbatim: entry.tool.name).font(.subheadline.monospaced())
                        if let description = entry.tool.description, !description.isEmpty {
                            Text(verbatim: description).font(.caption).foregroundStyle(Theme.textSecondary).lineLimit(2)
                        }
                    }
                }
                .disabled(!session.canAdminister)
                .accessibilityIdentifier("connect-apps-tool.\(entry.tool.name)")
            }
        } else if model.probing.contains(server) {
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text(String(localized: "Asking the server for its tools...")).font(.footnote).foregroundStyle(Theme.textSecondary)
            }
        } else {
            Button(String(localized: "List the tools")) { Task { await model.listTools(server, session: session) } }
        }
    }

    private func toolCount(_ server: String) -> String {
        let disabled = model.disabledTools[server] ?? []
        if let probe = model.probes[server], probe.ok {
            let enabled = probe.tools.filter { !disabled.contains($0.name) }.count
            return String(localized: "\(enabled) of \(probe.tools.count) enabled")
        }
        return disabled.isEmpty ? String(localized: "All enabled") : String(localized: "\(disabled.count) turned off")
    }

    private func accountLine(_ server: MCPServerListing) -> String {
        if server.auth == "connected" { return String(localized: "Signed in") }
        if let error = server.authError, !error.isEmpty { return error }
        let keys = (server.isRemote ? server.headerKeys : server.envKeys) ?? []
        return keys.isEmpty ? String(localized: "No sign-in needed") : keys.joined(separator: ", ")
    }

    @ViewBuilder
    private func appSections(_ item: ConnectAppItem) -> some View {
        let accounts = model.statuses[item.id]?.accounts ?? []
        Section {
            if accounts.isEmpty {
                Text(String(localized: "No account needed")).foregroundStyle(Theme.textSecondary)
            }
            ForEach(accounts) { account in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(verbatim: account.alias ?? account.id)
                        Text(verbatim: account.isActive ? String(localized: "Connected") : account.status.capitalized)
                            .font(.footnote)
                            .foregroundStyle(account.isActive ? Theme.success : Theme.textSecondary)
                    }
                    Spacer()
                }
                .swipeActions {
                    Button(String(localized: "Disconnect"), role: .destructive) {
                        Task { await model.disconnect(item.id, account: account, session: session) }
                    }
                    .accessibilityIdentifier("connect-apps-disconnect.\(account.id)")
                }
                .accessibilityIdentifier("connect-apps-account.\(account.id)")
            }
            if item.installed {
                Button(String(localized: "Add another account")) {
                    Task { await model.act(item, alias: "account \(accounts.count + 1)", session: session) }
                }
            }
        } header: {
            Text(String(localized: "Accounts"))
        }
    }

    @ViewBuilder
    private func pluginSections(_ item: ConnectAppItem) -> some View {
        let children = model.items.filter { $0.parent == item.key }
        Section {
            if children.isEmpty {
                Text(String(localized: "This plugin added no MCP server and no skill that Sagax can use.")).foregroundStyle(Theme.textSecondary)
            }
            ForEach(children) { child in
                Button {
                    if child.kind == .skill { push(.skill(child.id)) } else { push(.detail(child.key)) }
                } label: {
                    ConnectAppRow(item: child, busy: false) {}
                }
                .buttonStyle(.plain)
            }
        } header: {
            Text(String(localized: "What it adds"))
        } footer: {
            Text(String(localized: "Its MCP servers and skills are available to every bot. A server that runs a command starts off: test it, then turn it on. Skills start off until you read them."))
        }
    }

    private func detailRow(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(verbatim: label).foregroundStyle(Theme.textSecondary)
            Spacer(minLength: 12)
            Text(verbatim: value).multilineTextAlignment(.trailing).textSelection(.enabled)
        }
        .font(.subheadline)
    }
}

// MARK: - A private skill's page

struct LibrarySkillPage: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @ObservedObject var model: ConnectAppsModel
    let name: String
    @State private var text: String?
    @State private var confirmingDelete = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let skill = model.skill(name)
        ThemedList {
            Section {
                Text(verbatim: name).font(.headline)
                if let skill {
                    Text(verbatim: skill.source == "local-import" ? String(localized: "Created locally") : String(localized: "From \(skill.source)"))
                        .font(.footnote)
                        .foregroundStyle(Theme.textSecondary)
                    if !skill.description.isEmpty { Text(verbatim: skill.description).font(.subheadline) }
                    if session.canAdminister {
                        Toggle(String(localized: "Turned on"), isOn: Binding(
                            get: { skill.enabled },
                            set: { on in Task { await model.setSkill(name, enabled: on, session: session) } }
                        ))
                        .accessibilityIdentifier("connect-apps-skill-toggle")
                    }
                }
            } footer: {
                Text(String(localized: "Read it before turning it on: once on, bots it is assigned to follow it."))
            }
            Section {
                if let text {
                    Text(verbatim: text).font(.footnote.monospaced()).textSelection(.enabled)
                } else {
                    ProgressView()
                }
            } header: {
                Text(String(localized: "Instructions"))
            }
            if session.canAdminister, skill?.source == "local-import" {
                Section {
                    Button(String(localized: "Delete Skill"), role: .destructive) { confirmingDelete = true }
                }
            }
        }
        .navigationTitle(String(localized: "Private skill"))
        .navigationBarTitleDisplayMode(.inline)
        .task { text = (try? await session.settingsClient?.librarySkillText(name: name)) ?? "" }
        .confirmationDialog(String(localized: "Delete the skill \(name)? Bots it is assigned to stop using it."), isPresented: $confirmingDelete, titleVisibility: .visible) {
            Button(String(localized: "Delete Skill"), role: .destructive) {
                Task {
                    if let client = session.settingsClient {
                        do { try await client.deleteLibrarySkill(name: name) } catch { model.message = error.localizedDescription }
                    }
                    await model.load(session)
                    dismiss()
                }
            }
        }
    }
}
