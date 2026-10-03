// Allowed commands (BA9, CommandAllowlistDialog.tsx): the bot's saved
// exact-command rules for the open thread's provider and folder, each
// removable (button or swipe). Adding one stays an admin's (the sidecar and
// a client session refuse POST); the form shows only there, and only for a
// provider that can use saved approvals.
import CompanionCore
import SwiftUI

struct CommandAllowlistSection: View {
    @Environment(\.themePalette) var themePalette
    let bot: Bot
    @EnvironmentObject private var session: Session
    @State private var data: CommandAllowlist?
    @State private var loading = true
    @State private var error: String?
    @State private var saving: String?
    @State private var command = ""
    @State private var cwd = ""
    @State private var providers: [String: String] = [:]

    private var canAdd: Bool { session.surfaceGate.allows(.commandAllowlistAdd) }

    var body: some View {
        Section {
            if loading {
                Text(String(localized: "Loading allowed commands…")).foregroundStyle(Theme.textSecondary)
            }
            if let error {
                VStack(alignment: .leading, spacing: 6) {
                    Text(verbatim: error).font(.footnote).foregroundStyle(Theme.danger)
                    if data == nil, !loading {
                        Button(String(localized: "Retry")) { Task { await load() } }.buttonStyle(.borderless)
                    }
                }
                .accessibilityIdentifier("allowlist-error")
            }
            if let data, !loading {
                if data.rules.isEmpty {
                    Text(String(localized: "No commands saved yet."))
                        .foregroundStyle(Theme.textSecondary)
                        .accessibilityIdentifier("allowlist-empty")
                }
                ForEach(data.rules) { rule in
                    HStack(alignment: .top, spacing: 10) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(verbatim: rule.command)
                                .font(.system(size: 12, design: .monospaced))
                                .foregroundStyle(Theme.textPrimary)
                                .textSelection(.enabled)
                            Text(verbatim: providerName(rule.providerInstanceId))
                                .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                            Text(verbatim: rule.cwd)
                                .font(.system(size: 11, design: .monospaced)).foregroundStyle(Theme.textSecondary)
                        }
                        Spacer(minLength: 6)
                        Button {
                            Task { await remove(rule) }
                        } label: {
                            if saving == rule.id { ProgressView() } else { Image(systemName: "trash") }
                        }
                        .buttonStyle(.borderless)
                        .foregroundStyle(Theme.textSecondary)
                        .disabled(saving != nil)
                        .accessibilityLabel(Text(String(localized: "Remove allowed command: \(rule.command)")))
                        .accessibilityIdentifier("allowlist-remove.\(rule.id)")
                    }
                    .swipeActions(edge: .trailing) {
                        Button(String(localized: "Remove command"), role: .destructive) { Task { await remove(rule) } }
                            .disabled(saving != nil)
                    }
                }
            }
        } header: {
            Text(String(localized: "Saved commands for \(bot.name)"))
        } footer: {
            Text(String(localized: "Each rule allows one exact command for this bot, provider and working folder, including other threads using that folder. Rules stay saved until removed."))
        }
        .task(id: bot.id) { await load() }

        if let data, !loading {
            if data.supported, canAdd, let context = data.context {
                Section {
                    LabeledContent(String(localized: "Provider"), value: providerName(context.providerInstanceId))
                    TextField(String(localized: "Command"), text: $command, axis: .vertical)
                        .font(.system(size: 12, design: .monospaced))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .lineLimit(2...4)
                        .disabled(saving != nil)
                    TextField(String(localized: "Working folder"), text: $cwd)
                        .font(.system(size: 12, design: .monospaced))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .disabled(saving != nil)
                    Button(saving == "add" ? String(localized: "Adding…") : String(localized: "Add command")) { Task { await add(context) } }
                        .disabled(saving != nil || !CommandAllowRules.canAdd(command: command, cwd: cwd, list: data))
                } footer: {
                    Text(String(localized: "Enter the complete command. Prefixes and wildcards do not create broader permissions."))
                }
            } else if !data.supported {
                Section {
                    Text(String(localized: "This provider cannot use saved command approvals. You can still remove existing rules."))
                        .font(.footnote).foregroundStyle(Theme.textSecondary)
                }
            }
        }
    }

    private func providerName(_ id: String) -> String { providers[id] ?? id }

    private func load() async {
        guard let client = session.profileClient else { return }
        loading = true
        error = nil
        defer { loading = false }
        if providers.isEmpty, let instances = try? await client.instances() {
            providers = Dictionary(instances.map { ($0.instanceId, $0.displayName ?? $0.instanceId) }, uniquingKeysWith: { a, _ in a })
        }
        do {
            let result = try await client.commandAllowlist(botId: bot.id, threadId: bot.threadId)
            data = result
            cwd = result.context?.cwd ?? ""
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func remove(_ rule: CommandAllowlistRule) async {
        guard saving == nil, let client = session.profileClient else { return }
        saving = rule.id
        error = nil
        defer { saving = nil }
        do {
            data = try await client.removeCommandRule(botId: bot.id, ruleId: rule.id, threadId: bot.threadId)
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func add(_ context: CommandAllowlist.Context) async {
        guard saving == nil, CommandAllowRules.canAdd(command: command, cwd: cwd, list: data), let client = session.profileClient else { return }
        saving = "add"
        error = nil
        defer { saving = nil }
        do {
            data = try await client.addCommandRule(botId: bot.id, command: command, cwd: cwd, providerInstanceId: context.providerInstanceId, threadId: bot.threadId)
            command = ""
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct CommandAllowlistPage: View {
    @Environment(\.themePalette) var themePalette
    let bot: Bot

    var body: some View {
        ThemedList { CommandAllowlistSection(bot: bot) }
            .navigationTitle(String(localized: "Command allowlist"))
            .navigationBarTitleDisplayMode(.inline)
            .accessibilityIdentifier("allowlist-page")
    }
}
