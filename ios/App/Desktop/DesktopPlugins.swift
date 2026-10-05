// iPad I5: Plugins as the desktop's modal (src/components/PluginsPanel.tsx):
// `min(800, 100vw-40)` by `min(700, 100dvh-96)` on the elevated fill, the
// title, the Connected apps / MCP servers tabs, and each tab's page. The
// data and actions are the phone's (ConnectedAppsModel, McpServersModel,
// HarnessConnectorsModel, WP9); what a pairing may do follows SurfaceGate:
// connecting apps and signing in to MCP servers for a sidecar or an admin,
// the workspace key, the Claude Code switch and an MCP server's test, on/off
// and removal for an admin. Adding or editing an MCP server stays on the
// computer (it runs a command there).
import SwiftUI
import UIKit
import CompanionCore

struct DesktopPluginsModal: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var shell: DesktopShellModel
    @StateObject private var apps = ConnectedAppsModel()
    @StateObject private var mcp = McpServersModel()
    @StateObject private var harness = HarnessConnectorsModel()
    @StateObject private var settings = DesktopSettingsModel()
    let close: () -> Void

    private var tabs: [DesktopPluginsTab] { DesktopPluginsTab.available(for: session.surfaceGate) }
    private var tab: DesktopPluginsTab {
        tabs.contains(shell.pluginsTab) ? shell.pluginsTab : (tabs.first ?? .apps)
    }

    var body: some View {
        DesktopModalFrame(width: 800, background: \.elevated, close: close) {
            VStack(alignment: .leading, spacing: 0) {
                header
                if tabs.isEmpty {
                    DesktopText("Connected apps and MCP servers are managed by an admin of this server.", color: \.inkSecondary)
                        .padding(.horizontal, 32)
                        .padding(.top, 20)
                    Spacer(minLength: 0)
                } else {
                    tabBar
                        .padding(.horizontal, 32)
                        .padding(.top, 12)
                    ScrollView {
                        AnyView(page)
                            .padding(.horizontal, 32)
                            .padding(.top, 20)
                            .padding(.bottom, 24)
                    }
                    .scrollIndicators(.hidden)
                }
            }
        }
        .environmentObject(apps)
        .environmentObject(mcp)
        .environmentObject(harness)
        .environmentObject(settings)
        .task {
            settings.attach(session)
            async let config: Void = settings.load()
            async let catalog: Void = apps.load(session)
            async let servers: Void = mcp.load(session.settingsClient)
            async let connectors: Void = loadHarness()
            _ = await (config, catalog, servers, connectors)
        }
        .onDisappear {
            apps.stopPolling()
            mcp.stopAll()
        }
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isModal)
        .accessibilityIdentifier("desktop-plugins")
    }

    private func loadHarness() async {
        guard session.surfaceGate.allows(.harnessConnectors) else { return }
        await harness.load(session.settingsClient)
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 4) {
            VStack(alignment: .leading, spacing: 4) {
                DesktopText("Plugins", size: 17, weight: .semibold, line: 24, tracking: -0.136)
                    .accessibilityAddTraits(.isHeader)
                DesktopText("Connect apps and your own MCP tools.", line: 19.5, color: \.inkSecondary)
            }
            Spacer(minLength: 0)
            if tab == .apps, !tabs.isEmpty {
                Button {
                    Task { await apps.loadInventory(session) }
                } label: {
                    DesktopSettingsIconView(icon: .refreshCw, size: 17)
                        .foregroundStyle(theme.inkSecondary)
                        .rotationEffect(.degrees(apps.refreshing ? 180 : 0))
                        .frame(width: 28, height: 28)
                }
                .buttonStyle(DesktopHoverFill(radius: 8))
                .disabled(apps.refreshing)
                .padding(.top, 2)
                .accessibilityLabel(Text("Refresh connection status"))
                .accessibilityIdentifier("desktop-plugins.refresh")
            }
            DesktopCloseButton(label: "Close plugins", identifier: "desktop-plugins.close", action: close)
        }
        .padding(.leading, 32)
        .padding(.trailing, 32)
        .padding(.top, 24)
    }

    private var tabBar: some View {
        HStack(spacing: 4) {
            ForEach(tabs, id: \.self) { item in
                Button { shell.pluginsTab = item } label: {
                    Text(item == .apps ? "Connected apps" : "MCP servers")
                        .font(theme.font(13))
                        .foregroundStyle(item == tab ? theme.ink : theme.inkTertiary)
                        .padding(.horizontal, 8)
                        .frame(height: 24)
                        .background(item == tab ? theme.hover : .clear, in: Capsule())
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(item == tab ? [.isSelected] : [])
                .accessibilityIdentifier("desktop-plugins.tab.\(item.rawValue)")
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Plugin type"))
    }

    @ViewBuilder
    private var page: some View {
        switch tab {
        case .apps: DesktopConnectedAppsPage()
        case .mcp: DesktopMcpServersPage()
        }
    }
}

// MARK: - Connected apps

struct DesktopConnectedAppsPage: View {
    @Environment(\.desktopTheme) private var theme
    @Environment(\.openURL) private var openURL
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var apps: ConnectedAppsModel
    @EnvironmentObject private var settings: DesktopSettingsModel
    @State private var confirming: (card: ConnectorCard, account: ConnectorAccount)?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            controls
            if session.surfaceGate.allows(.harnessConnectors) {
                AnyView(DesktopHarnessConnectorsBox())
                    .padding(.top, 16)
            }
            if apps.catalog != nil, !apps.configured, !apps.stale {
                AnyView(setup)
                    .padding(.top, 12)
            }
            if let error = apps.error {
                DesktopText(verbatim: error, size: 12.5, color: \.danger)
                    .padding(.top, 12)
            }
            list
                .padding(.top, 20)
        }
        .confirmationDialog(
            Text(verbatim: confirmationText),
            isPresented: Binding(get: { confirming != nil }, set: { if !$0 { confirming = nil } }),
            titleVisibility: .visible
        ) {
            Button("Disconnect", role: .destructive) {
                guard let confirming else { return }
                Task { await apps.disconnect(confirming.card, account: confirming.account, session: session) }
            }
            Button("Cancel", role: .cancel) {}
        }
    }

    private var confirmationText: String {
        guard let confirming else { return "" }
        let account = confirming.account
        let identity = account.desktopAlias.map { "“\($0)” (\(account.id))" } ?? "“\(account.id)”"
        return pluginsFormat("Disconnect %1$@ from %2$@? Only this %2$@ account will be revoked. Your other %2$@ accounts will stay connected.", identity, confirming.card.label)
    }

    /// Marketplace / Connected, and the search field.
    private var controls: some View {
        HStack(spacing: 12) {
            HStack(spacing: 0) {
                segment(.marketplace, Text("Marketplace"))
                segment(.connected, apps.connectedCount > 0 ? Text("Connected") + Text(verbatim: " \(apps.connectedCount)") : Text("Connected"))
            }
            .padding(2)
            .frame(height: 28)
            .background(theme.hover, in: Capsule())
            Spacer(minLength: 0)
            HStack(spacing: 10) {
                DesktopSettingsIconView(icon: .search, size: 17)
                    .foregroundStyle(theme.inkSecondary)
                TextField(text: $apps.search, prompt: Text("Search apps").foregroundColor(theme.inkSecondary)) { Text("Search apps") }
                    .font(theme.font(13))
                    .foregroundStyle(theme.ink)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .accessibilityIdentifier("desktop-plugins.search")
            }
            .padding(.horizontal, 17)
            .frame(width: 320, height: 44)
            .background(theme.hover, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(theme.borderStrong, lineWidth: 1))
        }
    }

    private func segment(_ value: ConnectorsTab, _ label: Text) -> some View {
        Button { apps.tab = value } label: {
            label
                .font(theme.font(13))
                .foregroundStyle(apps.tab == value ? theme.ink : theme.inkSecondary)
                .padding(.horizontal, 12)
                .frame(height: 24)
                .background(apps.tab == value ? theme.hover : .clear, in: Capsule())
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(apps.tab == value ? [.isSelected] : [])
        .accessibilityIdentifier("desktop-plugins.apps-tab.\(value == .marketplace ? "marketplace" : "connected")")
    }

    /// `ConnectedAppsSetup`: the workspace key for an admin (`canConfigure`),
    /// a note for everyone else, as the remote client draws it.
    private var setup: some View {
        HStack(alignment: .top, spacing: 12) {
            DesktopSettingsIconView(icon: .plugZap, size: 18)
                .foregroundStyle(theme.accent)
                .padding(.top, 2)
            VStack(alignment: .leading, spacing: 0) {
                DesktopText("Set up connected apps", size: 13.5, weight: .medium, line: 20.25)
                DesktopText("Connected apps run through your own Composio project, so your accounts and tokens stay in a project you control.",
                            size: 12.5, line: 20.3, color: \.inkSecondary)
                    .padding(.top, 4)
                if session.surfaceGate.scope == .serverAdmin {
                    VStack(alignment: .leading, spacing: 2) {
                        Button {
                            if let url = URL(string: "https://platform.composio.dev") { openURL(url) }
                        } label: {
                            HStack(spacing: 4) {
                                step(1, Text("Create a free Composio account at") + Text(verbatim: " ")
                                    + Text(verbatim: "platform.composio.dev").foregroundColor(theme.accent).fontWeight(.medium))
                                DesktopSettingsIconView(icon: .externalLink, size: 11)
                                    .foregroundStyle(theme.accent)
                            }
                        }
                        .buttonStyle(.plain)
                        step(2, Text("Open your project settings and copy the project API key (it starts with ak_)."))
                        step(3, Text("Paste it below and save. The key is checked with Composio before it is stored."))
                    }
                    .padding(.top, 8)
                    DesktopKeyField(
                        title: Text("Composio project key"), provider: .composio,
                        configured: settings.config?.keyConfigured(.composio) ?? false,
                        help: Text("The key is write-only: it is stored by this installation and never shown again.")
                    ) { value in
                        let error = await settings.apply(.apiKey(.composio, value), key: "composio")
                        if error == nil { await apps.loadCatalog(session) }
                        return error
                    }
                    .padding(.top, 14)
                    DesktopText("The key is write-only: it is stored by this installation and never shown again. Change it later in App Settings, Connections.",
                                size: 11.5, line: 18.7, color: \.inkTertiary)
                        .padding(.top, 8)
                } else {
                    DesktopText("Ask the owner of this installation or an admin to add a Composio key.",
                                size: 12.5, weight: .medium, line: 20.3)
                        .padding(.top, 8)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(1)
        .background(theme.inset, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.border, lineWidth: 1))
        .accessibilityIdentifier("desktop-plugins.setup")
    }

    private func step(_ n: Int, _ text: Text) -> some View {
        HStack(alignment: .top, spacing: 4) {
            DesktopText(verbatim: "\(n).", size: 12.5, line: 20.3, color: \.inkSecondary)
            DesktopText(text, size: 12.5, line: 20.3, color: \.inkSecondary)
        }
        .padding(.leading, 4)
    }

    @ViewBuilder
    private var list: some View {
        if apps.catalog == nil {
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                DesktopText("Loading catalog…", size: 12.5, color: \.inkSecondary)
            }
        } else {
            DesktopText(apps.tab == .connected ? Text("Your connections") : (apps.search.isEmpty ? Text("Available apps") : Text("Search results")),
                        size: 12, weight: .medium, color: \.inkSecondary)
                .padding(.bottom, 12)
            let cards = apps.visible
            if cards.isEmpty {
                DesktopText(apps.tab == .connected ? Text("No connected apps yet") : Text("No apps found"), color: \.inkSecondary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 40)
            }
            let rows = stride(from: 0, to: cards.count, by: 2).map { Array(cards[$0..<min($0 + 2, cards.count)]) }
            VStack(spacing: 0) {
                ForEach(rows, id: \.first?.slug) { row in
                    HStack(alignment: .top, spacing: 12) {
                        ForEach(row, id: \.slug) { card in appCell(card) }
                        if row.count == 1 { Color.clear.frame(maxWidth: .infinity, maxHeight: 1) }
                    }
                }
            }
        }
    }

    private func appCell(_ card: ConnectorCard) -> some View {
        let state = apps.statuses[card.slug]
        let pending = state?.pending == true
        let failed = ConnectedAppsRules.isFailed(state)
        let accounts = state?.accounts ?? []
        let included = ConnectedAppsRules.isIncluded(card, state)
        let busy = apps.busySlug == card.slug
        let unavailable = ConnectedAppsRules.managedUnavailable(mode: apps.catalog?.mode, slug: card.slug)
        let action = ConnectedAppsRules.action(
            phase: apps.phase, busy: busy, included: included, canContinue: pending && apps.pendingURLs[card.slug] != nil,
            pending: pending, hasAccounts: !accounts.isEmpty, failed: failed
        )
        let enabled = apps.configured && apps.phase == .ready && !busy && !included && !unavailable
        let subtitle: Text = {
            if pending { return Text("Finish setup in your browser") }
            if failed && accounts.isEmpty { return Text("Authorization expired. Try again") }
            return Text(verbatim: card.blurb)
        }()
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
                DesktopAppMark(card: card)
                VStack(alignment: .leading, spacing: 0) {
                    DesktopText(verbatim: card.label, weight: .medium).lineLimit(1)
                    DesktopText(subtitle, size: 12, color: \.inkTertiary).lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Button { apps.tapAction(card, session: session) } label: {
                    Group {
                        if busy { ProgressView().controlSize(.mini) } else { actionLabel(unavailable ? nil : action, unavailable: unavailable) }
                    }
                    .frame(minWidth: 64)
                }
                .buttonStyle(DesktopButtonStyle(kind: .hover, height: 30))
                .disabled(!enabled)
                .accessibilityIdentifier("desktop-plugins.app.\(card.slug)")
            }
            ForEach(accounts) { account in
                HStack(spacing: 8) {
                    DesktopText(verbatim: account.desktopAlias ?? account.id, size: 12, weight: .medium)
                    Spacer(minLength: 0)
                    Button("Disconnect") { confirming = (card, account) }
                        .buttonStyle(DesktopButtonStyle(kind: .ghost, size: 12, height: 26))
                        .disabled(busy)
                        .accessibilityIdentifier("desktop-plugins.disconnect.\(account.id)")
                }
                .padding(.leading, 56)
            }
            if apps.aliasSlug == card.slug && !pending {
                HStack(spacing: 8) {
                    TextField(text: $apps.aliasDraft, prompt: Text("Account label (work, personal…)")) { Text("Account label") }
                        .font(theme.font(13))
                        .padding(.horizontal, 10)
                        .frame(height: 30)
                        .background(theme.inset, in: RoundedRectangle(cornerRadius: 8))
                        .onSubmit { Task { await apps.connect(card, session: session) } }
                    Button("Continue") { Task { await apps.connect(card, session: session) } }
                        .buttonStyle(DesktopButtonStyle(kind: .accent, height: 30))
                        .disabled(apps.aliasDraft.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                .padding(.leading, 56)
            }
        }
        .padding(.leading, 12)
        .padding(.trailing, 8)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func actionLabel(_ action: ConnectorAction?, unavailable: Bool) -> Text {
        if unavailable { return Text("Self-host only") }
        switch action {
        case .included: return Text("Included")
        case .checking: return Text("Checking…")
        case .unavailable: return Text("Unavailable")
        case .continueSetup: return Text("Continue")
        case .checkStatus: return Text("Check status")
        case .addAccount: return Text("Add account")
        case .retry: return Text("Retry")
        case .connect, nil: return Text("Connect")
        }
    }
}

/// "Provided by Claude (your account)" (`HarnessConnectorsSection.tsx`).
struct DesktopHarnessConnectorsBox: View {
    @Environment(\.desktopTheme) private var theme
    @Environment(\.openURL) private var openURL
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var harness: HarnessConnectorsModel

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    DesktopText("Provided by Claude (your account)", weight: .semibold, line: 19.5)
                    DesktopText("The connectors of your own claude.ai account reach your Claude bots when they run on your Claude subscription. They act as you, with your access.",
                                size: 12, line: 19.5, color: \.inkSecondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Button { Task { await harness.load(session.settingsClient, refresh: true) } } label: {
                    DesktopSettingsIconView(icon: .refreshCw, size: 15)
                        .foregroundStyle(theme.inkSecondary)
                        .frame(width: 28, height: 28)
                }
                .buttonStyle(DesktopHoverFill(radius: 8))
                .disabled(harness.loading)
                .opacity(harness.loading ? 0.5 : 1)
                .accessibilityLabel(Text("Check again"))
                .padding(.trailing, -8)
                Button {
                    if let url = URL(string: harness.answer?.manageUrl ?? "https://claude.ai/settings/connectors") { openURL(url) }
                } label: {
                    HStack(spacing: 6) {
                        DesktopSettingsIconView(icon: .externalLink, size: 12)
                        Text("Manage on claude.ai").font(theme.font(11.5, .medium))
                    }
                    .foregroundStyle(theme.ink)
                    .padding(.horizontal, 10)
                    .frame(height: 25.2)
                    .background(theme.control, in: Capsule())
                }
                .buttonStyle(.plain)
                .padding(.top, 1.4)
            }
            content
                .padding(.top, 8)
            if let answer = harness.answer, answer.canManage, session.surfaceGate.allows(.harnessConnectorsSetting) {
                HStack {
                    DesktopText("Allow Claude connectors on this server", size: 12.5)
                    Spacer(minLength: 0)
                    DesktopSwitch(isOn: answer.enabled, label: Text("Allow Claude connectors on this server"),
                                  identifier: "desktop-plugins.harness-enabled", disabled: harness.saving) {
                        Task { await harness.setEnabled(!answer.enabled, client: session.settingsClient) }
                    }
                }
                .padding(.top, 10)
            }
            if let error = harness.error {
                DesktopText(verbatim: error, size: 12, color: \.danger).padding(.top, 6)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(1)
        .background(theme.inset, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.border, lineWidth: 1))
        .accessibilityIdentifier("desktop-plugins.harness")
    }

    @ViewBuilder
    private var content: some View {
        if harness.loading && harness.answer == nil {
            HStack(spacing: 8) {
                DesktopSettingsIconView(icon: .loaderCircle, size: 13)
                    .foregroundStyle(theme.inkSecondary)
                DesktopText("Checking your Claude account...", size: 12, color: \.inkSecondary)
            }
        } else if let claude = harness.answer?.claude, !claude.available {
            DesktopText(Self.unavailable(claude.reason), size: 12, color: \.inkSecondary)
        } else if let claude = harness.answer?.claude, claude.connectors.isEmpty {
            DesktopText("No connector on your claude.ai account yet.", size: 12, color: \.inkSecondary)
        } else if let claude = harness.answer?.claude {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(claude.connectors) { connector in
                    HStack(spacing: 8) {
                        DesktopSettingsIconView(icon: .plug, size: 13).foregroundStyle(theme.inkTertiary)
                        DesktopText(verbatim: connector.name, size: 12.5)
                        Spacer(minLength: 0)
                        DesktopBadge(text: Self.status(connector.status),
                                     color: connector.status == "connected" ? \.success : (connector.status == "needs_auth" ? \.warning : \.inkSecondary))
                    }
                }
            }
        }
    }

    static func status(_ value: String) -> Text {
        switch value {
        case "connected": Text("Connected")
        case "needs_auth": Text("Sign-in required")
        case "failed": Text("Unavailable")
        default: Text("Unknown")
        }
    }

    static func unavailable(_ reason: String?) -> Text {
        switch reason {
        case "disabled": Text("An administrator turned off Claude connectors on this server.")
        case "managed_policy": Text("Your organization restricts MCP servers on this computer.")
        case "no_engine": Text("No Claude engine on this server.")
        case "not_signed_in": Text("Connect your Claude subscription to use your connectors.")
        case "not_operator": Text("On this server, Claude connectors belong to its owner's Claude account.")
        case "key": Text("Connect your Claude subscription to use your connectors. An API key brings none.")
        default: Text("Claude Code did not answer. Check that it is installed and signed in.")
        }
    }
}

// MARK: - MCP servers

struct DesktopMcpServersPage: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var mcp: McpServersModel
    @EnvironmentObject private var settings: DesktopSettingsModel
    @State private var adminServers: [MCPServerListing]?
    @State private var busy: String?
    @State private var probes: [String: MCPProbeResult] = [:]
    @State private var removing: MCPServerListing?
    @State private var error: String?
    @State private var editing: DesktopMCPEditing?
    @State private var pasting = false

    private var admin: Bool { session.surfaceGate.scope == .serverAdmin }
    private var servers: [MCPServerListing]? { adminServers ?? mcp.servers }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 8) {
                VStack(alignment: .leading, spacing: 4) {
                    DesktopText("Your MCP servers", size: 15, weight: .semibold, line: 22.5)
                    DesktopText(admin
                                ? Text("Add an MCP server once (a command that runs on this computer, or a server at a URL) and every compatible bot can use its tools. Tool calls still follow your normal approval settings.")
                                : Text("The MCP servers on the computer, for every compatible bot. Add or change them in Sagax on the computer."),
                                size: 12.5, line: 20.3, color: \.inkSecondary)
                        .frame(maxWidth: 610, alignment: .leading)
                }
                Spacer(minLength: 0)
                Button {
                    adminServers = nil
                    Task { await mcp.load(session.settingsClient, reprobe: true) }
                } label: {
                    DesktopSettingsIconView(icon: .refreshCw, size: 16)
                        .foregroundStyle(theme.inkSecondary)
                        .frame(width: 32, height: 32)
                }
                .buttonStyle(DesktopHoverFill(radius: 8, fill: \.raised))
                .disabled(mcp.loading)
                .padding(.top, 1.4)
                .accessibilityLabel(Text("Refresh MCP servers"))
                .accessibilityIdentifier("desktop-plugins.mcp-refresh")
                if admin {
                    Button { pasting = true } label: {
                        HStack(spacing: 6) {
                            DesktopSettingsIconView(icon: .clipboardPaste, size: 14)
                            Text("Paste config")
                        }
                    }
                    .buttonStyle(DesktopButtonStyle(kind: .control, size: 12.5, weight: .medium, height: 34.8))
                    .accessibilityIdentifier("desktop-plugins.mcp-paste")
                    Button { editing = DesktopMCPEditing(server: nil) } label: {
                        HStack(spacing: 6) {
                            DesktopSettingsIconView(icon: .plus, size: 14)
                            Text("Add server")
                        }
                    }
                    .buttonStyle(DesktopButtonStyle(kind: .accent, size: 12.5, weight: .medium, height: 34.8))
                    .accessibilityIdentifier("desktop-plugins.mcp-add")
                }
            }
            if admin {
                claudeSwitch.padding(.top, 16)
                DesktopText("Commands run on this computer with the environment variables you provide; URL servers receive the headers you provide. Only add software and addresses you trust. New servers stay off until you enable them.",
                            size: 12, line: 19.5, color: \.inkSecondary)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(1)
                    .background(theme.raised.opacity(0.35), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.hairline.opacity(0.5), lineWidth: 1))
                    .padding(.top, 16)
            }
            if let notice = mcp.notice {
                DesktopText(verbatim: notice, size: 12.5, color: \.success).padding(.top, 12)
            }
            if let message = error ?? mcp.error {
                DesktopText(verbatim: message, size: 12.5, color: \.danger).padding(.top, 12)
            }
            VStack(spacing: 12) {
                if let servers {
                    if servers.isEmpty {
                        DesktopText("No MCP servers yet.", color: \.inkSecondary)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 30)
                    }
                    ForEach(servers) { server in row(server) }
                } else {
                    ProgressView().controlSize(.small).padding(.vertical, 30)
                }
            }
            .padding(.top, 20)
        }
        .confirmationDialog(
            Text("Remove the “\(removing?.name ?? "")” MCP server?"),
            isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
            titleVisibility: .visible
        ) {
            Button("Remove", role: .destructive) {
                if let server = removing { Task { await remove(server) } }
            }
            Button("Cancel", role: .cancel) {}
        }
        .sheet(item: $editing) { item in
            DesktopMCPServerEditor(existing: item.server) { servers in
                adminServers = servers
                editing = nil
            }
            .environmentObject(session)
        }
        .sheet(isPresented: $pasting) {
            DesktopMCPImport { servers in
                adminServers = servers
                pasting = false
            }
            .environmentObject(session)
        }
    }

    private var claudeSwitch: some View {
        let on = settings.config?.features?.claudeUserMcp == true
        return HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                DesktopText("Also use my Claude Code MCP servers", size: 14, weight: .medium, line: 21)
                    .frame(maxWidth: .infinity, alignment: .leading)
                DesktopText("Off: Claude bots only get the servers on this page, plus a bot project's own .mcp.json. On: they also get every MCP server and connector from your own Claude Code setup, on every message, the same way Codex bots already read your Codex config. More tools means more tokens per message, so keep this off unless you need them.",
                            size: 12, line: 19.5, color: \.inkSecondary)
            }
            DesktopSwitch(isOn: on, label: Text("Use my Claude Code MCP servers"), identifier: "desktop-plugins.claude-mcp",
                          disabled: settings.config == nil || !settings.saving.isEmpty) {
                Task { _ = await settings.apply(.feature("claudeUserMcp", !on), key: "claudeMcp") }
            }
            .padding(.top, 2)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 16)
        .padding(1)
        .background(theme.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(theme.hairline.opacity(0.5), lineWidth: 1))
    }

    private func row(_ server: MCPServerListing) -> some View {
        let enabled = server.enabled == true
        let signingIn = mcp.busy == "oauth:\(server.name)" || mcp.waiting.contains(server.name)
        return HStack(alignment: .center, spacing: 12) {
            DesktopSettingsIconView(icon: server.isRemote ? .globe : .terminal, size: 19)
                .foregroundStyle(enabled ? theme.success : theme.inkSecondary)
                .frame(width: 40, height: 40)
                .background((enabled ? theme.success.opacity(0.1) : theme.control), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 8) {
                    DesktopText(verbatim: server.name, size: 14, weight: .medium, line: 21).lineLimit(1)
                    Text(enabled ? "On" : "Off")
                        .font(theme.font(10.5))
                        .foregroundStyle(enabled ? theme.success : theme.inkSecondary)
                        .padding(.horizontal, 8)
                        .frame(height: 19.8)
                        .background(enabled ? theme.success.opacity(0.1) : theme.control, in: Capsule())
                }
                Text(verbatim: MCPServerRules.detailLine(server))
                    .font(.system(size: 11.5, design: .monospaced))
                    .foregroundStyle(theme.inkSecondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .frame(height: 17.25)
                    .padding(.top, 4)
                authLine(server).padding(.top, 6)
                if let probe = probes[server.name] {
                    DesktopText(verbatim: probe.ok
                                ? pluginsFormat("Works: %@ tools.", "\(probe.tools?.count ?? 0)")
                                : (probe.error ?? AppStrings.localized("The test failed.")),
                                size: 11.5, line: 17.25, color: probe.ok ? \.success : \.danger)
                        .padding(.top, 4)
                }
                if mcp.waiting.contains(server.name) {
                    DesktopText("Finish the sign-in in your browser. This row updates when it is done.", size: 11.5, line: 17.25, color: \.inkSecondary)
                        .padding(.top, 4)
                }
                if let message = mcp.oauthErrors[server.name] {
                    DesktopText(verbatim: message, size: 11.5, line: 17.25, color: \.danger).padding(.top, 4)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if MCPServerRules.needsSignIn(server) {
                Button(server.auth == "expired" ? "Sign in again" : "Sign in") {
                    Task { await mcp.signIn(server, client: session.settingsClient) }
                }
                .buttonStyle(DesktopButtonStyle(kind: .accent, size: 12, weight: .medium, height: 30))
                .disabled(mcp.busy != nil || server.managedBy != nil || signingIn)
                .accessibilityIdentifier("desktop-plugins.mcp-sign-in.\(server.name)")
            }
            if admin {
                HStack(spacing: 4) {
                iconTextButton(.flaskConical, Text("Test"), id: "test", server) { await test(server) }
                iconTextButton(.circlePower, enabled ? Text("Turn off") : Text("Turn on"), id: "toggle", server) { await toggle(server) }
                Button { editing = DesktopMCPEditing(server: server) } label: {
                    DesktopSettingsIconView(icon: .pencil, size: 14)
                        .foregroundStyle(theme.inkSecondary)
                        .frame(width: 30, height: 30)
                }
                .buttonStyle(DesktopHoverFill(radius: 8, fill: \.raised))
                .disabled(busy != nil || server.managedBy != nil)
                .accessibilityLabel(Text(verbatim: pluginsFormat("Edit %@", server.name)))
                .accessibilityIdentifier("desktop-plugins.mcp-edit.\(server.name)")
                Button { removing = server } label: {
                    DesktopSettingsIconView(icon: .trash2, size: 14)
                        .foregroundStyle(theme.inkSecondary)
                        .frame(width: 30, height: 30)
                }
                .buttonStyle(DesktopHoverFill(radius: 8, fill: \.raised))
                .disabled(busy != nil)
                .accessibilityLabel(Text(verbatim: pluginsFormat("Remove %@", server.name)))
                .accessibilityIdentifier("desktop-plugins.mcp-remove.\(server.name)")
                }
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(1)
        .background(theme.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(theme.hairline.opacity(0.5), lineWidth: 1))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("desktop-plugins.mcp-row.\(server.name)")
    }

    private func iconTextButton(_ icon: DesktopSettingsIcon, _ label: Text, id: String, _ server: MCPServerListing,
                                action: @escaping () async -> Void) -> some View {
        Button { Task { await action() } } label: {
            HStack(spacing: 6) {
                if busy == "\(id):\(server.name)" { ProgressView().controlSize(.mini) } else { DesktopSettingsIconView(icon: icon, size: 14) }
                label.font(theme.font(12))
            }
            .foregroundStyle(theme.inkSecondary)
            .padding(.horizontal, 10)
            .frame(height: 34)
        }
        .buttonStyle(DesktopHoverFill(radius: 8, fill: \.raised))
        .disabled(busy != nil)
        .accessibilityIdentifier("desktop-plugins.mcp-\(id).\(server.name)")
    }

    @ViewBuilder
    private func authLine(_ server: MCPServerListing) -> some View {
        switch MCPServerRules.authLine(server) {
        case let .connected(issuer):
            DesktopText(verbatim: pluginsFormat("Signed in with %@.", issuer), size: 11.5, line: 17.25, color: \.success)
        case let .error(detail):
            (Text("Sign-in unavailable").fontWeight(.medium) + Text(verbatim: detail.map { ". \($0)" } ?? ""))
                .font(theme.font(11.5))
                .foregroundStyle(theme.danger)
                .desktopLine(11.5, 17.25, theme)
        case let .required(issuer, _):
            DesktopText(verbatim: pluginsFormat("Sign in with %@ so bots can use this server.", issuer), size: 11.5, line: 17.25, color: \.warning)
        case .expired:
            DesktopText("Sign in again so bots can keep using this server.", size: 11.5, line: 17.25, color: \.warning)
        case nil:
            EmptyView()
        }
    }

    private func toggle(_ server: MCPServerListing) async {
        guard let client = session.settingsClient else { return }
        busy = "toggle:\(server.name)"
        error = nil
        defer { busy = nil }
        do { adminServers = try await client.setMCPServerEnabled(server.name, enabled: server.enabled != true) }
        catch { self.error = error.localizedDescription }
    }

    private func test(_ server: MCPServerListing) async {
        guard let client = session.settingsClient else { return }
        busy = "test:\(server.name)"
        probes[server.name] = nil
        defer { busy = nil }
        do { probes[server.name] = try await client.testMCPServer(server.name) }
        catch { probes[server.name] = MCPProbeResult(ok: false, tools: nil, error: error.localizedDescription) }
    }

    private func remove(_ server: MCPServerListing) async {
        guard let client = session.settingsClient else { return }
        busy = "delete:\(server.name)"
        error = nil
        defer { busy = nil }
        do { adminServers = try await client.deleteMCPServer(server.name) }
        catch { self.error = error.localizedDescription }
    }
}

private extension ConnectorAccount {
    var desktopAlias: String? {
        let value = alias?.trimmingCharacters(in: .whitespacesAndNewlines)
        return value?.isEmpty == false ? value : nil
    }
}

/// An app's logo as the desktop draws it (`rounded-xl object-contain size-11`),
/// else its initial on the control fill.
struct DesktopAppMark: View {
    @Environment(\.desktopTheme) private var theme
    let card: ConnectorCard

    private var source: URL? {
        if let logo = card.logo, let url = URL(string: logo), url.scheme == "https" { return url }
        if let domain = card.domain, !domain.isEmpty {
            return URL(string: "https://www.google.com/s2/favicons?domain=\(domain)&sz=64")
        }
        return nil
    }

    var body: some View {
        Group {
            if let source {
                AsyncImage(url: source) { phase in
                    if let image = phase.image {
                        image.resizable().scaledToFit()
                    } else {
                        initial
                    }
                }
            } else {
                initial
            }
        }
        .frame(width: 44, height: 44)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .accessibilityHidden(true)
    }

    private var initial: some View {
        ZStack {
            theme.control
            Text(verbatim: String(card.label.prefix(1)).uppercased())
                .font(theme.font(15, .semibold))
                .foregroundStyle(theme.inkSecondary)
        }
    }
}

struct DesktopMCPEditing: Identifiable {
    let server: MCPServerListing?
    var id: String { server?.name ?? "new" }
}

/// Add or edit an MCP server (the desktop's inline editor, as a sheet).
struct DesktopMCPServerEditor: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var session: Session
    let existing: MCPServerListing?
    let saved: ([MCPServerListing]) -> Void
    @State private var draft = MCPServerDraft()
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Server name", text: $draft.name)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .disabled(existing != nil)
                        .accessibilityIdentifier("desktop-mcp.name")
                    if existing == nil {
                        Picker("Connection", selection: $draft.transport) {
                            Text("Run a command").tag(MCPServerDraft.Transport.command)
                            Text("Connect to a URL").tag(MCPServerDraft.Transport.url)
                        }
                        .pickerStyle(.segmented)
                    }
                }
                if draft.transport == .url {
                    Section {
                        TextField("Server URL", text: $draft.url)
                            .keyboardType(.URL)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .accessibilityIdentifier("desktop-mcp.url")
                        Picker("Connection", selection: $draft.type) {
                            Text("Streamable HTTP (most servers)").tag("http")
                            Text("SSE (older servers)").tag("sse")
                        }
                    }
                    Section {
                        TextEditor(text: $draft.headers)
                            .font(.system(.footnote, design: .monospaced))
                            .frame(minHeight: 90)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                    } header: {
                        Text("Headers · Name: value per line")
                    } footer: {
                        Text("Put tokens here, for example Authorization: Bearer …. Leave an existing value blank to keep it saved. Remove the line to delete it.")
                    }
                } else {
                    Section {
                        TextField("Executable command", text: $draft.command)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .accessibilityIdentifier("desktop-mcp.command")
                    }
                    Section("Arguments · one per line") {
                        TextEditor(text: $draft.args)
                            .font(.system(.footnote, design: .monospaced))
                            .frame(minHeight: 70)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                    }
                    Section {
                        TextEditor(text: $draft.env)
                            .font(.system(.footnote, design: .monospaced))
                            .frame(minHeight: 70)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                    } header: {
                        Text("Environment · KEY=value per line")
                    } footer: {
                        Text("Leave an existing value blank to keep it saved. Remove the line to delete it.")
                    }
                }
                if let error {
                    Section { Text(verbatim: error).foregroundStyle(.red) }
                }
            }
            .navigationTitle(existing.map { Text(verbatim: pluginsFormat("Edit %@", $0.name)) } ?? Text("Add MCP server"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save", action: save)
                        .disabled(saving)
                        .accessibilityIdentifier("desktop-mcp.save")
                }
            }
        }
        .onAppear { if let existing { draft = MCPServerDraft(editing: existing) } }
    }

    private func save() {
        if case let .failure(problem) = draft.body(existing: existing) {
            error = Self.message(problem)
            return
        }
        guard let client = session.settingsClient else { return }
        saving = true
        Task {
            defer { saving = false }
            do { saved(try await client.saveMCPServer(draft, existing: existing)) }
            catch { self.error = error.localizedDescription }
        }
    }

    static func message(_ problem: MCPServerDraft.Problem) -> String {
        switch problem {
        case .nameAndURL: AppStrings.localized("Add a server name and a full http:// or https:// address.")
        case .nameAndCommand: AppStrings.localized("Add a server name and executable command.")
        case let .line(line): pluginsFormat("Check “%@”: use KEY=value or Name: value.", line)
        case let .invalidName(key): pluginsFormat("“%@” is not a valid name.", key)
        case let .duplicate(key): pluginsFormat("“%@” is listed more than once.", key)
        }
    }
}

/// Paste config: the `{"mcpServers": {…}}` block other apps write.
struct DesktopMCPImport: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var session: Session
    let added: ([MCPServerListing]) -> Void
    @State private var text = ""
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextEditor(text: $text)
                        .font(.system(.footnote, design: .monospaced))
                        .frame(minHeight: 200)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .accessibilityIdentifier("desktop-mcp.import-text")
                } footer: {
                    Text("Paste the {\"mcpServers\": {…}} block from Claude Code, Cursor, or Claude Desktop. Servers are added switched off; test each one, then turn it on.")
                }
                if let error {
                    Section { Text(verbatim: error).foregroundStyle(.red) }
                }
            }
            .navigationTitle("Paste config")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add servers") {
                        guard let client = session.settingsClient else { return }
                        saving = true
                        Task {
                            defer { saving = false }
                            do { added(try await client.importMCPServers(text)) }
                            catch { self.error = error.localizedDescription }
                        }
                    }
                    .disabled(saving || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
    }
}
