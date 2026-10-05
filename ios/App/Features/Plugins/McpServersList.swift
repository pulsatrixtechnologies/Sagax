// MCP servers on the phone (iOS parity matrix PL8, PL9): the desktop's MCP
// servers tab (src/components/McpServersPanel.tsx) read-only. Each server
// with its on/off state, its organization note, its address or command, the
// names of its saved secrets, and for a URL server whether bots reach it
// signed in, with Sign in / Sign in again. Adding, editing, switching,
// testing, importing, removing and signing out stay on the computer (PL10:
// the sidecar refuses them). The sign-in opens in the system sheet and the
// row then waits on `GET .../oauth/status` the way the desktop does: every
// two seconds, for up to ten minutes. Gate: `SurfaceFeature.mcpServers`.
import CompanionCore
import SwiftUI

@MainActor
final class McpServersModel: ObservableObject {
    @Published private(set) var servers: [MCPServerListing]?
    @Published private(set) var loading = false
    @Published private(set) var busy: String?
    @Published private(set) var waiting: Set<String> = []
    @Published private(set) var oauthErrors: [String: String] = [:]
    @Published var error: String?
    @Published var notice: String?

    private var generation = 0
    private var waiters: [String: Task<Void, Never>] = [:]

    func load(_ client: CompanionClient?, reprobe: Bool = false) async {
        guard let client else { return }
        generation += 1
        let mine = generation
        loading = true
        error = nil
        defer { if mine == generation { loading = false } }
        do {
            let response = try await client.mcpServers(reprobe: reprobe)
            if mine == generation { servers = response.servers }
        } catch {
            if mine == generation { self.error = error.localizedDescription }
        }
    }

    private func reloadQuietly(_ client: CompanionClient) async {
        if let response = try? await client.mcpServers(reprobe: false) { servers = response.servers }
    }

    func signIn(_ server: MCPServerListing, client: CompanionClient?) async {
        guard let client, busy == nil else { return }
        let name = server.name
        busy = "oauth:\(name)"
        oauthErrors[name] = nil
        notice = nil
        let url: URL
        do {
            url = try await client.startPluginSignIn(serverName: name)
        } catch {
            busy = nil
            oauthErrors[name] = error.localizedDescription
            return
        }
        busy = nil
        waitForSignIn(name, client: client)
        do {
            let callback = try await WebSignIn.run(url: url)
            if case let .failed(reason) = PluginSignIn.outcome(of: callback) {
                stopWaiting(name)
                oauthErrors[name] = reason.map { pluginsFormat("The sign-in did not finish: %@", $0) }
                    ?? AppStrings.localized("The sign-in did not finish.")
                await reloadQuietly(client)
            }
            // A finished sheet: the status poll reports the outcome.
        } catch WebSignIn.Failure.cancelled {
            // The person closed the sheet: nothing will come back to this row.
            stopWaiting(name)
            await reloadQuietly(client)
        } catch {
            stopWaiting(name)
            oauthErrors[name] = error.localizedDescription
        }
    }

    /// `waitForSignIn`: poll until connected, a final answer, or the deadline.
    private func waitForSignIn(_ name: String, client: CompanionClient) {
        waiters[name]?.cancel()
        waiting.insert(name)
        let deadline = Date().addingTimeInterval(MCPServerRules.signInWait)
        waiters[name] = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(MCPServerRules.signInPoll * 1_000_000_000))
                guard !Task.isCancelled, let self else { return }
                if Date() > deadline {
                    self.stopWaiting(name)
                    self.oauthErrors[name] = AppStrings.localized("The sign-in was not completed. Try again.")
                    return
                }
                guard let status = try? await client.mcpSignInStatus(serverName: name) else { continue }
                switch MCPServerRules.poll(status) {
                case .keepWaiting:
                    continue
                // Reload before stopping: stopping cancels this very task,
                // and a cancelled task's request never reaches the server.
                case .connected:
                    await self.reloadQuietly(client)
                    self.notice = pluginsFormat("%@ is signed in.", name)
                    self.stopWaiting(name)
                    return
                case let .stopped(error):
                    await self.reloadQuietly(client)
                    if let error { self.oauthErrors[name] = error }
                    self.stopWaiting(name)
                    return
                }
            }
        }
    }

    private func stopWaiting(_ name: String) {
        waiters[name]?.cancel()
        waiters[name] = nil
        waiting.remove(name)
    }

    func stopAll() {
        for task in waiters.values { task.cancel() }
        waiters.removeAll()
        waiting.removeAll()
    }
}

/// The MCP servers page, pushed from Plugins.
struct McpServersList: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @StateObject private var model = McpServersModel()

    var body: some View {
        SettingsPage(title: "MCP servers", contentTop: 80) {
            PluginsRefreshButton(label: "Refresh MCP servers", spinning: model.loading && model.servers != nil, identifier: "mcp-refresh") {
                Task { await model.load(session.settingsClient, reprobe: true) }
            }
        } content: {
            McpServersSection(model: model)
        }
        .task { await model.load(session.settingsClient) }
        .onDisappear { model.stopAll() }
    }
}

/// The page's body, layout-agnostic: an iPad shell can host it in a column.
struct McpServersSection: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @ObservedObject var model: McpServersModel

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Your MCP servers")
                    .font(Theme.Font.headerTitle)
                    .foregroundStyle(Theme.textPrimary)
                Text("Add an MCP server once (a command that runs on this computer, or a server at a URL) and every compatible bot can use its tools. Tool calls still follow your normal approval settings.")
                    .font(Theme.Font.label)
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, 21.7)
            .padding(.bottom, 14)

            PluginsCallout {
                Text("Commands run on this computer with the environment variables you provide; URL servers receive the headers you provide. Only add software and addresses you trust. New servers stay off until you enable them.")
            }
            if let error = model.error {
                PluginsCallout(tone: .danger) { Text(verbatim: error) }
            }
            if let notice = model.notice {
                PluginsCallout(tone: .success) { Text(verbatim: notice) }
                    .accessibilityIdentifier("mcp-notice")
            }

            if let servers = model.servers {
                if servers.isEmpty {
                    VStack(spacing: 6) {
                        PluginsGlyphTile(systemImage: "server.rack", size: 44)
                        Text("No custom MCP servers yet").font(Theme.Font.bodyMedium).foregroundStyle(Theme.textPrimary)
                        Text("Add a trusted MCP server (a local command or a URL) to give your bots more tools.")
                            .font(Theme.Font.label)
                            .foregroundStyle(Theme.textSecondary)
                    }
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .padding(.horizontal, 30)
                    .padding(.vertical, 50)
                    .accessibilityIdentifier("mcp-empty")
                } else {
                    ForEach(servers) { server in row(server) }
                }
            } else {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small).tint(Theme.textSecondary)
                    Text("Loading MCP servers…").font(Theme.Font.label).foregroundStyle(Theme.textSecondary)
                }
                .frame(maxWidth: .infinity)
                .padding(.top, 50)
            }
        }
    }

    private func row(_ server: MCPServerListing) -> some View {
        let enabled = server.enabled == true
        let signingIn = model.busy == "oauth:\(server.name)" || model.waiting.contains(server.name)
        return VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 0) {
                PluginsGlyphTile(systemImage: server.isRemote ? "globe" : "server.rack", active: enabled)
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(verbatim: server.name)
                            .font(Theme.Font.rowTitle)
                            .tracking(SettingsMetrics.tracking135)
                            .foregroundStyle(Theme.textPrimary)
                            .lineLimit(1)
                        PluginsBadge(text: enabled ? Text("On") : Text("Off"), tone: enabled ? .success : .neutral)
                        if let organization = server.managedBy {
                            PluginsBadge(text: Text(verbatim: pluginsFormat("Managed by %@", organization)))
                        }
                    }
                    if let organization = server.managedBy {
                        Text(verbatim: pluginsFormat("Not approved by %@; bots do not get this server.", organization))
                            .font(Theme.Font.label)
                            .foregroundStyle(Theme.textSecondary)
                    }
                    Text(verbatim: MCPServerRules.detailLine(server))
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    if server.isRemote, let keys = server.headerKeys, !keys.isEmpty {
                        Text(verbatim: pluginsFormat("Headers saved: %@", keys.joined(separator: ", ")))
                            .font(Theme.Font.label).foregroundStyle(Theme.textSecondary).lineLimit(1)
                    } else if !server.isRemote, let keys = server.envKeys, !keys.isEmpty {
                        Text(verbatim: pluginsFormat("Secrets saved: %@", keys.joined(separator: ", ")))
                            .font(Theme.Font.label).foregroundStyle(Theme.textSecondary).lineLimit(1)
                    }
                    authLine(server)
                }
                .padding(.leading, 14)
                Spacer(minLength: 10)
                if MCPServerRules.needsSignIn(server) {
                    PluginsPillButton(
                        title: server.auth == "expired" ? Text("Sign in again") : Text("Sign in"),
                        enabled: model.busy == nil && server.managedBy == nil,
                        busy: signingIn,
                        prominent: true,
                        identifier: "mcp-sign-in.\(server.name)"
                    ) {
                        Task { await model.signIn(server, client: session.settingsClient) }
                    }
                    .accessibilityLabel(Text(verbatim: pluginsFormat("Sign in to %@", server.name)))
                }
            }
            if model.waiting.contains(server.name) {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.mini).tint(Theme.textSecondary)
                    Text("Finish the sign-in in your browser. This row updates when it is done.")
                }
                .font(Theme.Font.label)
                .foregroundStyle(Theme.textSecondary)
                .padding(.top, 10)
                .padding(.leading, 52.5)
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("mcp-waiting.\(server.name)")
            }
            if let error = model.oauthErrors[server.name] {
                Text(verbatim: error)
                    .font(Theme.Font.label)
                    .foregroundStyle(Theme.danger)
                    .padding(.top, 8)
                    .padding(.leading, 52.5)
                    .accessibilityIdentifier("mcp-error.\(server.name)")
            }
        }
        .padding(.horizontal, 21)
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("mcp-row.\(server.name)")
    }

    @ViewBuilder
    private func authLine(_ server: MCPServerListing) -> some View {
        switch MCPServerRules.authLine(server) {
        case let .connected(issuer):
            Label {
                Text(verbatim: pluginsFormat("Signed in with %@.", issuer))
            } icon: {
                Image(systemName: "checkmark.circle.fill").accessibilityHidden(true)
            }
            .font(Theme.Font.label)
            .foregroundStyle(Theme.success)
            .lineLimit(1)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("mcp-auth.\(server.name)")
        case let .error(detail):
            (Text("Sign-in unavailable").fontWeight(.medium) + Text(verbatim: detail.map { ". \($0)" } ?? ""))
                .font(Theme.Font.label)
                .foregroundStyle(Theme.danger)
                .accessibilityIdentifier("mcp-auth.\(server.name)")
        case let .required(issuer, detail):
            authNeeded(badge: Text("Sign-in required"), hint: Text(verbatim: pluginsFormat("Sign in with %@ so bots can use this server.", issuer)), detail: detail, name: server.name)
        case let .expired(detail):
            authNeeded(badge: Text("Sign-in expired"), hint: Text("Sign in again so bots can keep using this server."), detail: detail, name: server.name)
        case nil:
            EmptyView()
        }
    }

    private func authNeeded(badge: Text, hint: Text, detail: String?, name: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            PluginsBadge(text: badge, tone: .warning)
            hint.font(Theme.Font.label).foregroundStyle(Theme.textSecondary)
            if let detail { Text(verbatim: detail).font(Theme.Font.label).foregroundStyle(Theme.danger) }
        }
        .padding(.top, 2)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("mcp-auth.\(name)")
    }
}
