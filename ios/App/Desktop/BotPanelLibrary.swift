// iPad I-sync: the bot panel's Library tab (`bot-settings/LibraryTab.tsx`):
// the bot's files, its skills and its Claude Code plugins, one at a time
// (Files | Skills | Plugins: 12.5 pt tabs, px 8, py 4, radius 6, the chosen
// one `elevated-hover`), 16 pt in, 8 pt from the panel tabs, 12 pt gaps.
// Plugins (`BotPluginsCard.tsx`) needs a server pairing: the companion
// sidecar does not list `/api/bots/:id/plugins`, so a sidecar pairing shows
// Files and Skills only (`SurfaceFeature.botPlugins`).
//
// Each sub-tree is type-erased (`AnyView`), as in BotPanel.swift.
import SwiftUI
import CompanionCore

enum BotPanelLibraryView: String, CaseIterable, Identifiable {
    case files, skills, plugins
    var id: String { rawValue }

    var title: LocalizedStringKey {
        switch self {
        case .files: "Files"
        case .skills: "Skills"
        case .plugins: "Plugins"
        }
    }
}

struct BotPanelLibrary: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    let bot: Bot
    let docked: Bool

    @State private var view: BotPanelLibraryView = .files

    private var views: [BotPanelLibraryView] {
        BotPanelLibraryView.allCases.filter { $0 != .plugins || session.surfaceGate.allows(.botPlugins) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            AnyView(tabs)
                .padding(.top, 8)
                .padding(.leading, 17)
                .padding(.trailing, 16)
            AnyView(content)
                .padding(.top, 4)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("desktop-panel-library")
    }

    private var tabs: some View {
        HStack(spacing: 4) {
            ForEach(views) { item in
                let selected = view == item
                Button { view = item } label: {
                    Text(item.title)
                        .font(theme.font(12.5))
                        .foregroundStyle(selected ? theme.ink : theme.inkSecondary)
                        .padding(.horizontal, 8)
                        .frame(height: 26)
                        .background(selected ? theme.elevatedHover : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .hoverEffect(.highlight)
                .accessibilityAddTraits(selected ? [.isSelected, .isButton] : .isButton)
                .accessibilityIdentifier("desktop-panel-library.\(item.rawValue)")
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Library views"))
    }

    @ViewBuilder
    private var content: some View {
        switch view {
        case .files:
            AnyView(BotPanelFiles(bot: bot, docked: docked))
        case .skills:
            AnyView(BotPanelSkills(bot: bot))
                .padding(.top, 8)
                .padding(.leading, 17)
                .padding(.trailing, 16)
                .padding(.bottom, 24)
        case .plugins:
            AnyView(BotPanelPlugins(bot: bot))
                .padding(.top, 8)
                .padding(.leading, 17)
                .padding(.trailing, 16)
                .padding(.bottom, 24)
        }
    }
}

// MARK: - Plugins

@MainActor
final class BotPluginsModel: ObservableObject {
    @Published var view: BotPluginsView?
    @Published var error: String?
    @Published var busy: String?
    var client: CompanionClient?
    let botId: String

    init(botId: String) { self.botId = botId }

    func refresh() async {
        guard let client else { return }
        do {
            view = try await client.botPlugins(botId: botId)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    func run(_ key: String, _ work: @escaping (CompanionClient) async throws -> BotPluginsView) async -> Bool {
        guard let client, busy == nil else { return false }
        busy = key
        error = nil
        defer { busy = nil }
        do {
            view = try await work(client)
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }
}

/// Library > Plugins (`BotPluginsCard.tsx`): the intro, the notices, the
/// installed list (switch, Uninstall), then each marketplace with its
/// plugins (Install / Update) and the Add a marketplace field.
struct BotPanelPlugins: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    let bot: Bot

    @StateObject private var model: BotPluginsModel
    @State private var source = ""

    init(bot: Bot) {
        self.bot = bot
        _model = StateObject(wrappedValue: BotPluginsModel(botId: bot.id))
    }

    var body: some View {
        AnyView(content)
            .task(id: bot.id) {
                model.client = session.profileClient
                await model.refresh()
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("desktop-panel-plugins")
    }

    @ViewBuilder
    private var content: some View {
        if let view = model.view {
            AnyView(loaded(view))
        } else if let error = model.error {
            Text(verbatim: error).font(theme.font(12.5)).foregroundStyle(theme.danger)
        } else {
            Text("Loading plugins…").font(theme.font(12.5)).foregroundStyle(theme.inkSecondary)
        }
    }

    private func loaded(_ view: BotPluginsView) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Claude Code plugins from a marketplace (owner/repo or an https git address). Their skills, commands and agents load in this bot's turns; hooks and the plugin's own MCP servers are left out because they would run on the server.")
                .font(theme.font(12.5))
                .lineSpacing(4)
                .foregroundStyle(theme.inkSecondary)
                .fixedSize(horizontal: false, vertical: true)
            if !view.engine.loadsPlugins {
                notice("Plugins load only when this bot runs on Claude Code.")
            }
            if view.managedByAdmin == true {
                notice("Your administrator manages plugins and MCP servers.")
            } else if !view.canChange {
                notice("Only the bot's owner, or someone who manages it, can change its plugins.")
            }
            AnyView(installed(view))
            AnyView(marketplaces(view))
            if let error = model.error {
                Text(verbatim: error).font(theme.font(12)).foregroundStyle(theme.danger)
            }
        }
    }

    private func notice(_ text: LocalizedStringKey) -> some View {
        Text(text)
            .font(theme.font(12))
            .foregroundStyle(theme.inkSecondary)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    private func heading(_ text: LocalizedStringKey) -> some View {
        Text(text).font(theme.font(13, .medium)).foregroundStyle(theme.ink)
    }

    private func installed(_ view: BotPluginsView) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            heading("Installed")
            if view.plugins.isEmpty {
                Text("No plugin installed.").font(theme.font(12)).foregroundStyle(theme.inkSecondary)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(view.plugins.enumerated()), id: \.element.key) { index, plugin in
                        if index > 0 { Rectangle().fill(theme.hairline40).frame(height: 1) }
                        AnyView(installedRow(plugin, canChange: view.canChange))
                    }
                }
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline40, lineWidth: 1))
            }
        }
    }

    private func installedRow(_ plugin: BotPluginsView.Installed, canChange: Bool) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                (Text(verbatim: plugin.name).foregroundColor(theme.ink)
                 + Text(verbatim: "@\(plugin.marketplace)").foregroundColor(theme.inkSecondary)
                 + Text(verbatim: plugin.version.map { " \($0)" } ?? "").foregroundColor(theme.inkSecondary))
                    .font(.system(size: 12.5, design: .monospaced))
                    .lineLimit(1)
                if let description = plugin.description, !description.isEmpty {
                    Text(verbatim: description).font(theme.font(11.5)).foregroundStyle(theme.inkSecondary).lineLimit(2)
                }
                if !plugin.removed.isEmpty {
                    Text("Left out: \(plugin.removed.joined(separator: ", "))").font(theme.font(11.5)).foregroundStyle(theme.inkSecondary)
                }
                if !plugin.declaredMcpServers.isEmpty {
                    Text("Declares MCP servers \(plugin.declaredMcpServers.joined(separator: ", ")): add them in Settings > My connections to use them.")
                        .font(theme.font(11.5)).foregroundStyle(theme.inkSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if canChange {
                PanelSwitch(label: "Use \(plugin.name)", isOn: plugin.enabled, disabled: model.busy != nil) { enabled in
                    Task { _ = await model.run("toggle:\(plugin.key)") { try await $0.setBotPluginEnabled(botId: bot.id, key: plugin.key, enabled: enabled) } }
                }
                pillButton("Uninstall") {
                    Task { _ = await model.run("rm:\(plugin.key)") { try await $0.uninstallBotPlugin(botId: bot.id, key: plugin.key) } }
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
    }

    private func marketplaces(_ view: BotPluginsView) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            heading("Marketplaces")
            if view.policy.isList {
                let list = (view.policy.allow ?? []).joined(separator: ", ")
                Text("Your organization allows: \(list.isEmpty ? "-" : list)").font(theme.font(12)).foregroundStyle(theme.inkSecondary)
            }
            ForEach(view.marketplaces) { market in
                AnyView(marketplace(market, canChange: view.canChange))
            }
            if view.canChange {
                HStack(spacing: 8) {
                    PanelTextField(placeholder: "owner/repo or https://…", text: $source) { addMarketplace() }
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .accessibilityLabel(Text("Add a marketplace"))
                    pillButton(model.busy == "add" ? "Adding…" : "Add a marketplace", primary: true,
                               disabled: source.trimmingCharacters(in: .whitespaces).isEmpty) { addMarketplace() }
                }
            }
        }
    }

    private func marketplace(_ market: BotPluginsView.Listing, canChange: Bool) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                VStack(alignment: .leading, spacing: 1) {
                    (Text(verbatim: market.name).foregroundColor(theme.ink)
                     + Text(verbatim: " (\(market.source))").foregroundColor(theme.inkSecondary))
                        .font(theme.font(12.5))
                        .lineLimit(1)
                    if let description = market.description, !description.isEmpty {
                        Text(verbatim: description).font(theme.font(11.5)).foregroundStyle(theme.inkSecondary).lineLimit(1)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if canChange {
                    pillButton("Update") {
                        Task { _ = await model.run("up:\(market.name)") { try await $0.updatePluginMarketplace(botId: bot.id, name: market.name) } }
                    }
                    pillButton("Remove") {
                        Task { _ = await model.run("rmm:\(market.name)") { try await $0.removePluginMarketplace(botId: bot.id, name: market.name) } }
                    }
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(theme.inset)
            if market.plugins.isEmpty {
                Text("No plugin in this marketplace.")
                    .font(theme.font(12)).foregroundStyle(theme.inkSecondary)
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            ForEach(market.plugins) { plugin in
                Rectangle().fill(theme.hairline40).frame(height: 1)
                HStack(spacing: 8) {
                    VStack(alignment: .leading, spacing: 1) {
                        (Text(verbatim: plugin.name).foregroundColor(theme.ink)
                         + Text(verbatim: plugin.version.map { " \($0)" } ?? "").foregroundColor(theme.inkSecondary))
                            .font(.system(size: 12.5, design: .monospaced))
                            .lineLimit(1)
                        if let description = plugin.description, !description.isEmpty {
                            Text(verbatim: description).font(theme.font(11.5)).foregroundStyle(theme.inkSecondary).lineLimit(2)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    if canChange {
                        let key = "in:\(market.name):\(plugin.name)"
                        pillButton(model.busy == key ? "Installing…" : plugin.installed ? "Update" : "Install", primary: !plugin.installed) {
                            Task { _ = await model.run(key) { try await $0.installBotPlugin(botId: bot.id, marketplace: market.name, plugin: plugin.name) } }
                        }
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline40, lineWidth: 1))
    }

    /// `.ui-button` (30 tall, px 13, a pill in `hover`) and `.ui-button-primary`
    /// (`ink` on `app`).
    private func pillButton(_ title: LocalizedStringKey, primary: Bool = false, disabled: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(theme.font(13))
                .foregroundStyle(primary ? theme.app : theme.ink)
                .lineLimit(1)
                .padding(.horizontal, 13)
                .frame(height: 30)
                .background(primary ? theme.ink : theme.hover, in: Capsule())
        }
        .buttonStyle(.plain)
        .disabled(disabled || model.busy != nil)
        .opacity(disabled || model.busy != nil ? 0.5 : 1)
    }

    private func addMarketplace() {
        let text = source.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        Task {
            if await model.run("add", { try await $0.addPluginMarketplace(botId: bot.id, source: text) }) { source = "" }
        }
    }
}
