// Connected apps (iOS parity matrix PL1, PL2, PL4, PL6): the desktop's Apps
// panel (src/components/PluginsPanel.tsx) on the phone, restyled as one of
// the Settings pages. Marketplace / Connected, search, connect with an
// account label, continue or check a pending one, disconnect one account,
// the per-bot "Allow" tip, the stale-inventory warning and the setup notice.
// The rules are `ConnectedAppsRules` (CompanionCore); what the pairing may
// see is `SurfaceGate` (.connectedApps, .connectedAppsPerBot).
import CompanionCore
import SwiftUI
import UIKit

@MainActor
final class ConnectedAppsModel: ObservableObject {
    @Published private(set) var catalog: ConnectorCatalog?
    @Published private(set) var statuses: [String: ConnectorStatus] = [:]
    @Published private(set) var phase: ConnectorInventoryPhase = .loading
    /// What is on screen is remembered rather than confirmed.
    @Published private(set) var stale = false
    @Published private(set) var refreshing = false
    @Published private(set) var busySlug: String?
    @Published private(set) var pendingURLs: [String: URL] = [:]
    @Published private(set) var botsWithoutApps: [Bot] = []
    @Published var aliasSlug: String?
    @Published var aliasDraft = ""
    @Published var search = ""
    @Published var tab: ConnectorsTab = .marketplace
    @Published var error: String?

    /// The last inventory the computer vouched for, kept across openings so
    /// a reopened page never flashes every app as disconnected.
    private static var remembered: (statuses: [String: ConnectorStatus], authoritative: Bool)?
    private var polls: [String: Task<Void, Never>] = [:]
    private var instances: [Instance] = []

    init() {
        if let remembered = Self.remembered {
            statuses = remembered.statuses
            stale = !remembered.authoritative
            phase = .ready
        }
    }

    var configured: Bool { catalog?.configured ?? false }
    var visible: [ConnectorCard] {
        ConnectedAppsRules.visibleCards(catalog?.cards ?? [], search: search, tab: tab, statuses: statuses)
    }

    var connectedCount: Int { ConnectedAppsRules.connectedCount(statuses) }

    func load(_ session: Session) async {
        async let inventory: Void = loadInventory(session)
        async let catalog: Void = loadCatalog(session)
        _ = await (inventory, catalog)
        await refreshBots(session)
    }

    func loadCatalog(_ session: Session) async {
        guard let client = session.settingsClient else { return }
        do { catalog = try await client.connectorCatalog() }
        catch { self.error = error.localizedDescription }
    }

    /// `loadConnectionInventory`: the complete account inventory.
    func loadInventory(_ session: Session) async {
        guard let client = session.settingsClient else { return }
        let hadInventory = Self.remembered != nil
        if !hadInventory { phase = .loading }
        refreshing = true
        defer { refreshing = false }
        do {
            let response = try await client.allConnectorStatuses()
            let authoritative = response.isAuthoritative
            stale = !authoritative
            if authoritative || hadInventory {
                statuses = ConnectedAppsRules.mergeComplete(current: statuses, incoming: response.services, authoritative: authoritative)
                Self.remembered = (statuses, authoritative)
                phase = .ready
            } else {
                // Never confirmed and not knowable now: "unavailable", never
                // a Connect that asserts the app is disconnected.
                phase = .error
            }
            for (slug, state) in response.services where state.connected && state.pending != true {
                pendingURLs[slug] = nil
            }
        } catch {
            if !hadInventory { phase = .error }
            self.error = error.localizedDescription
        }
    }

    /// The bots the per-bot tip names (PL6), an admin pairing only.
    func refreshBots(_ session: Session) async {
        guard session.surfaceGate.allows(.connectedAppsPerBot) else {
            botsWithoutApps = []
            return
        }
        if instances.isEmpty, let client = session.settingsClient {
            instances = (try? await client.instances()) ?? []
        }
        let usable = ConnectedAppsRules.hasUsableConnectedApps(configured: configured, phase: phase, stale: stale, statuses: statuses)
        botsWithoutApps = usable ? ConnectedAppsRules.botsMissingConnectedApps(session.state.bots, instances: instances) : []
    }

    /// `refreshStatus`: one or a few apps, merged into the inventory.
    @discardableResult
    func refreshStatus(_ slugs: [String], session: Session) async -> [String: ConnectorStatus] {
        guard let client = session.settingsClient, !slugs.isEmpty else { return [:] }
        guard let response = try? await client.connectorStatuses(services: slugs), response.isAuthoritative else { return [:] }
        for (slug, state) in response.services {
            statuses[slug] = state
            if state.connected && state.pending != true { pendingURLs[slug] = nil }
        }
        if phase == .ready { Self.remembered = (statuses, !stale) }
        return response.services
    }

    func startPolling(_ slug: String, session: Session) {
        polls[slug]?.cancel()
        polls[slug] = Task { [weak self] in
            var tries = 0
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(ConnectedAppsRules.pollInterval * 1_000_000_000))
                guard !Task.isCancelled, let self else { return }
                let services = await self.refreshStatus([slug], session: session)
                tries += 1
                if ConnectedAppsRules.stopsPolling(tries: tries, status: services[slug]) { break }
            }
        }
    }

    func stopPolling() {
        for task in polls.values { task.cancel() }
        polls.removeAll()
    }

    /// The card's button (`onClick` in PluginsPanel.tsx).
    func tapAction(_ card: ConnectorCard, session: Session) {
        let state = statuses[card.slug]
        if state?.pending == true {
            if let url = pendingURLs[card.slug] {
                error = nil
                Task { await open(url) }
            } else {
                aliasSlug = nil
                error = nil
                Task { await refreshStatus([card.slug], session: session) }
                startPolling(card.slug, session: session)
            }
        } else {
            aliasSlug = aliasSlug == card.slug ? nil : card.slug
            aliasDraft = ""
        }
    }

    /// `connect`: authorize with the label, open the page, poll.
    func connect(_ card: ConnectorCard, session: Session) async {
        let alias = String(aliasDraft.trimmingCharacters(in: .whitespacesAndNewlines).prefix(64))
        guard !alias.isEmpty else {
            error = AppStrings.localized("Enter a label for the account, such as work or personal.")
            return
        }
        guard let client = session.settingsClient else { return }
        busySlug = card.slug
        error = nil
        defer { busySlug = nil }
        do {
            let url = try await client.authorizeConnector(slug: card.slug, alias: alias)
            pendingURLs[card.slug] = url
            var state = statuses[card.slug] ?? ConnectorStatus(connected: false, pending: nil, status: nil, accounts: nil)
            state.pending = true
            state.status = "INITIATED"
            statuses[card.slug] = state
            aliasSlug = nil
            aliasDraft = ""
            startPolling(card.slug, session: session)
            await open(url)
        } catch {
            if ConnectedAppsRules.requiresAccountAlias(error.localizedDescription) {
                aliasSlug = card.slug
                aliasDraft = ""
                self.error = AppStrings.localized("This app already has an account. Add a label such as work or personal to connect another.")
                await refreshStatus([card.slug], session: session)
            } else {
                self.error = error.localizedDescription
            }
        }
    }

    /// `disconnectAccount` (PL4).
    func disconnect(_ card: ConnectorCard, account: ConnectorAccount, session: Session) async {
        guard let client = session.settingsClient else { return }
        busySlug = card.slug
        defer { busySlug = nil }
        do {
            try await client.disconnectConnectorAccount(slug: card.slug, accountId: account.id)
            await refreshStatus([card.slug], session: session)
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// "Allow <bot>": the bot's own Connected apps switch on (PL6).
    func allow(_ bot: Bot, session: Session) async {
        guard let client = session.settingsClient else { return }
        do {
            let updated = try await client.patchBot(botId: bot.id, patch: BotPatch(composio: true))
            session.applyProfileBot(updated)
            botsWithoutApps.removeAll { $0.id == bot.id }
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func open(_ url: URL) async {
        if !(await UIApplication.shared.open(url)) {
            error = AppStrings.localized("The authorization page could not be opened. Try again after checking your browser restrictions.")
        }
    }
}

struct ConnectedAppsView: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var model = ConnectedAppsModel()
    @State private var confirming: (card: ConnectorCard, account: ConnectorAccount)?

    var body: some View {
        SettingsPage(title: "Connected apps", contentTop: 80) {
            PluginsRefreshButton(label: "Refresh connection status", spinning: model.refreshing, identifier: "connected-apps-refresh") {
                Task { await model.loadInventory(session) }
            }
        } content: {
            content
        }
        .task { await model.load(session) }
        .onDisappear { model.stopPolling() }
        .onValueChange(of: scenePhase) { phase in
            if phase == .active { Task { await model.loadInventory(session) } }
        }
        .onValueChange(of: session.state.bots) { _ in Task { await model.refreshBots(session) } }
        .confirmationDialog(
            Text(verbatim: confirmationText),
            isPresented: Binding(get: { confirming != nil }, set: { if !$0 { confirming = nil } }),
            titleVisibility: .visible
        ) {
            Button("Disconnect", role: .destructive) {
                guard let confirming else { return }
                Task { await model.disconnect(confirming.card, account: confirming.account, session: session) }
            }
            .accessibilityIdentifier("connected-apps-disconnect-confirm")
            Button("Cancel", role: .cancel) {}
        }
    }

    private var confirmationText: String {
        guard let confirming else { return "" }
        let account = confirming.account
        let identity = account.nonemptyAlias.map { "“\($0)” (\(account.id))" } ?? "“\(account.id)”"
        return pluginsFormat("Disconnect %1$@ from %2$@? Only this %2$@ account will be revoked. Your other %2$@ accounts will stay connected.", identity, confirming.card.label)
    }

    @ViewBuilder
    private var content: some View {
        VStack(spacing: 0) {
            if model.stale { staleWarning }
            controls
            if model.catalog != nil, !model.configured, !model.stale { setupNotice }
            if !model.botsWithoutApps.isEmpty { perBotTip }
            if let error = model.error {
                PluginsCallout(tone: .danger) { Text(verbatim: error) }
                    .accessibilityIdentifier("connected-apps-error")
            }
            list
        }
    }

    // MARK: Header controls

    private var controls: some View {
        VStack(alignment: .leading, spacing: 10) {
            PluginsSegmented(
                options: [
                    (ConnectorsTab.marketplace, Text("Marketplace"), "connected-apps-tab.marketplace"),
                    (ConnectorsTab.connected, model.connectedCount > 0 ? Text("Connected") + Text(verbatim: " \(model.connectedCount)") : Text("Connected"), "connected-apps-tab.connected"),
                ],
                selection: $model.tab
            )
            SettingsSearchField(prompt: "Search apps", text: $model.search, identifier: "connected-apps-search")
        }
        .padding(.horizontal, SettingsMetrics.headerInset)
        .padding(.bottom, 16)
    }

    private var staleWarning: some View {
        PluginsCallout(tone: .warning) {
            Label("Accounts could not be re-checked", systemImage: "exclamationmark.triangle")
                .font(Theme.Font.labelMedium)
            Text("Showing what was connected last time. Your computer could not open its credential store just now, so these could not be re-checked. Nothing has been disconnected — restarting Sagax on your computer usually clears this.")
                .foregroundStyle(Theme.textSecondary)
        }
        .accessibilityIdentifier("connected-apps-stale")
    }

    /// `ConnectedAppsSetup` as the remote client draws it: nobody configures
    /// the workspace's key from a paired device.
    private var setupNotice: some View {
        PluginsCallout {
            Text("Set up connected apps")
                .font(Theme.Font.labelMedium)
                .foregroundStyle(Theme.textPrimary)
            Text("Connected apps run through your own Composio project, so your accounts and tokens stay in a project you control.")
            Text("Ask the owner of this installation or an admin to add a Composio key.")
                .font(Theme.Font.labelMedium)
                .foregroundStyle(Theme.textPrimary)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("connected-apps-setup")
    }

    private var perBotTip: some View {
        PluginsCallout {
            (Text("Not every bot can use these apps.").foregroundColor(Theme.textPrimary).fontWeight(.medium)
                + Text(verbatim: " ")
                + Text("Connecting an app here does not hand it to a bot. Each bot has its own Connected apps switch under Settings → Access, and until it is on the bot does not know the app exists."))
            FlowRow(spacing: 6) {
                ForEach(model.botsWithoutApps) { bot in
                    PluginsPillButton(title: Text(verbatim: pluginsFormat("Allow %@", bot.name)), identifier: "connected-apps-allow.\(bot.id)") {
                        Task { await model.allow(bot, session: session) }
                    }
                }
            }
        }
    }

    // MARK: List

    @ViewBuilder
    private var list: some View {
        if model.catalog == nil {
            HStack(spacing: 8) {
                ProgressView().controlSize(.small).tint(Theme.textSecondary)
                Text("Loading catalog…").font(Theme.Font.label).foregroundStyle(Theme.textSecondary)
            }
            .padding(.top, 60)
        } else {
            PluginsSectionHeading(title: heading)
                .padding(.top, 6)
            ForEach(model.visible) { card in row(card) }
            if model.visible.isEmpty { emptyState }
        }
    }

    private var heading: Text {
        let base: Text = model.tab == .connected ? Text("Your connections") : (model.search.isEmpty ? Text("Available apps") : Text("Search results"))
        guard model.tab == .marketplace, model.search.isEmpty, let pagination = model.catalog?.pagination,
              ConnectedAppsRules.isPartial(pagination) else { return base }
        var note: String
        if let total = pagination.totalItems, pagination.items < total {
            note = pluginsFormat("showing %1$@ of %2$@ apps; the connection service returned a partial catalog",
                                 pagination.items.formatted(), total.formatted())
        } else {
            note = AppStrings.localized("the connection service returned a partial catalog")
        }
        if let reason = pagination.reason {
            note += "; " + pluginsFormat("the connection service stopped paging early: %@", reason)
        }
        return base + Text(verbatim: "  ") + Text(verbatim: note)
    }

    @ViewBuilder
    private var emptyState: some View {
        VStack(spacing: 6) {
            if model.tab == .connected {
                switch model.phase {
                case .loading:
                    Text("Checking connected apps…").font(Theme.Font.bodyMedium).foregroundStyle(Theme.textPrimary)
                    Text("Your accounts will appear here as soon as the secure connection check finishes.")
                case .error:
                    Text("Couldn’t load connected apps").font(Theme.Font.bodyMedium).foregroundStyle(Theme.textPrimary)
                    Text("Retry the connection check before adding another account.")
                    PluginsPillButton(title: Text("Retry"), enabled: !model.refreshing, identifier: "connected-apps-retry") {
                        Task { await model.loadInventory(session) }
                    }
                    .padding(.top, 8)
                case .ready:
                    Text("No connected apps yet").font(Theme.Font.bodyMedium).foregroundStyle(Theme.textPrimary)
                    Text("Connect an app from Marketplace and it will appear here.")
                }
            } else {
                Text("No apps found").font(Theme.Font.bodyMedium).foregroundStyle(Theme.textPrimary)
                Text("Try a different search.")
            }
        }
        .font(Theme.Font.label)
        .foregroundStyle(Theme.textSecondary)
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 30)
        .padding(.vertical, 60)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("connected-apps-empty")
    }

    private func row(_ card: ConnectorCard) -> some View {
        let state = model.statuses[card.slug]
        let pending = state?.pending == true
        let failed = ConnectedAppsRules.isFailed(state)
        let accounts = state?.accounts ?? []
        let included = ConnectedAppsRules.isIncluded(card, state)
        let busy = model.busySlug == card.slug
        let unavailable = ConnectedAppsRules.managedUnavailable(mode: model.catalog?.mode, slug: card.slug)
        let action = ConnectedAppsRules.action(
            phase: model.phase, busy: busy, included: included, canContinue: pending && model.pendingURLs[card.slug] != nil,
            pending: pending, hasAccounts: !accounts.isEmpty, failed: failed
        )
        let enabled = model.configured && model.phase == .ready && !busy && !included && !unavailable
        let subtitle: Text = {
            if unavailable { return Text("Twitter/X needs your own X Developer app and Composio auth config. Use self-hosted connected apps for now.") }
            if pending {
                return model.pendingURLs[card.slug] != nil
                    ? Text("Finish setup in your browser")
                    : Text("Finish setup in your browser, or disconnect the pending account below to start again")
            }
            if failed && accounts.isEmpty { return Text("Authorization expired. Try again") }
            return Text(verbatim: card.blurb)
        }()

        return VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 0) {
                ConnectorMark(card: card)
                VStack(alignment: .leading, spacing: 2.6) {
                    Text(verbatim: card.label)
                        .font(Theme.Font.rowTitle)
                        .tracking(SettingsMetrics.tracking135)
                        .foregroundStyle(Theme.textPrimary)
                        .lineLimit(1)
                    subtitle
                        .font(Theme.Font.label)
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(2)
                }
                .padding(.leading, 14)
                Spacer(minLength: 12)
                PluginsPillButton(title: unavailable ? Text("Self-host only") : actionLabel(action), enabled: enabled, busy: busy,
                                  identifier: "connected-apps-action.\(card.slug)") {
                    model.tapAction(card, session: session)
                }
            }
            if !accounts.isEmpty {
                VStack(spacing: 6) {
                    ForEach(accounts) { account in accountRow(card, account, busy: busy) }
                }
                .padding(.top, 10)
                .padding(.leading, 52.5)
            }
            if model.aliasSlug == card.slug && !pending {
                aliasForm(card, accounts: accounts, busy: busy)
                    .padding(.top, 10)
                    .padding(.leading, 52.5)
            }
        }
        .padding(.horizontal, 21)
        .padding(.vertical, 15.25)
        .frame(maxWidth: .infinity, minHeight: 69, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("connected-apps-row.\(card.slug)")
    }

    private func actionLabel(_ action: ConnectorAction?) -> Text {
        switch action {
        case .included: Text("Included")
        case .checking: Text("Checking…")
        case .unavailable: Text("Unavailable")
        case .continueSetup: Text("Continue")
        case .checkStatus: Text("Check status")
        case .addAccount: Text("Add account")
        case .retry: Text("Retry")
        case .connect, nil: Text("Connect")
        }
    }

    private func accountRow(_ card: ConnectorCard, _ account: ConnectorAccount, busy: Bool) -> some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 5) {
                    if account.isActive {
                        Image(systemName: "checkmark").font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.success)
                    }
                    Text(verbatim: account.nonemptyAlias ?? account.id)
                        .font(Theme.Font.labelMedium)
                        .foregroundStyle(Theme.textPrimary)
                        .lineLimit(1)
                }
                Text(verbatim: (account.nonemptyAlias != nil ? "\(account.id) · " : "") + account.status.lowercased())
                    .font(Theme.font(10.5))
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            Button {
                Haptics.selection()
                confirming = (card, account)
            } label: {
                Text("Disconnect")
                    .font(Theme.Font.label)
                    .foregroundStyle(Theme.destructive)
                    .padding(.horizontal, 8)
                    .frame(minHeight: 28)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(busy)
            .accessibilityLabel(Text(verbatim: pluginsFormat("Disconnect %1$@ from %2$@", account.nonemptyAlias ?? account.id, card.label)))
            .accessibilityIdentifier("connected-apps-disconnect.\(account.id)")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.Metric.cardRadius == 0 ? 0 : 10, style: .continuous))
    }

    private func aliasForm(_ card: ConnectorCard, accounts: [ConnectorAccount], busy: Bool) -> some View {
        HStack(spacing: 8) {
            TextField("", text: $model.aliasDraft, prompt: Text("Account label (work, personal…)").foregroundColor(Theme.placeholder))
                .font(Theme.Font.rowTitle)
                .foregroundStyle(Theme.textPrimary)
                .textInputAutocapitalization(.words)
                .submitLabel(.continue)
                .onSubmit { Task { await model.connect(card, session: session) } }
                .padding(.horizontal, 12)
                .frame(height: 36)
                .background(Theme.card, in: Capsule())
                .accessibilityLabel(Text(verbatim: accounts.isEmpty
                    ? pluginsFormat("Label for the new %@ account", card.label)
                    : pluginsFormat("Label for another %@ account", card.label)))
                .accessibilityIdentifier("connected-apps-alias.\(card.slug)")
                .onValueChange(of: model.aliasDraft) { value in
                    if value.count > 64 { model.aliasDraft = String(value.prefix(64)) }
                }
            PluginsPillButton(title: Text("Continue"),
                              enabled: !busy && !model.aliasDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                              prominent: true, identifier: "connected-apps-alias-continue.\(card.slug)") {
                Task { await model.connect(card, session: session) }
            }
        }
    }
}

/// Lays chips out in rows that wrap.
struct FlowRow: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, line: CGFloat = 0, widest: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width {
                y += line + spacing
                x = 0
                line = 0
            }
            x += size.width + spacing
            line = max(line, size.height)
            widest = max(widest, x - spacing)
        }
        return CGSize(width: proposal.width ?? widest, height: y + line)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, line: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX {
                y += line + spacing
                x = bounds.minX
                line = 0
            }
            view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            line = max(line, size.height)
        }
    }
}

private extension ConnectorAccount {
    var nonemptyAlias: String? {
        let value = alias?.trimmingCharacters(in: .whitespacesAndNewlines)
        return value?.isEmpty == false ? value : nil
    }
}
