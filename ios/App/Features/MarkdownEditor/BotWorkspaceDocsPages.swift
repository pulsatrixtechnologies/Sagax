// Rules and documents of a bot (desktop #269, bot-settings/RulesSection.tsx
// and WorkspaceFilesSection.tsx) in the markdown editor: RULES.md, read every
// turn, with its counter against 60 lines and 8,000 bytes; docs/*.md, read on
// demand, created, renamed, edited and deleted here. Opened beside the
// bot's instructions. A file the bot changed meanwhile asks before it is
// overwritten (409), as the memory editor does.
import CompanionCore
import SwiftUI

/// "Rules" and "Documents" under a bot's instructions.
struct BotWorkspaceShortcuts: View {
    @EnvironmentObject private var session: Session
    let bot: Bot
    @State private var open: BotWorkspaceSheet?

    var body: some View {
        if session.surfaceGate.scope != .sidecar {
            HStack(spacing: 10) {
                Button { open = .rules } label: { Label("Rules", systemImage: "list.bullet.rectangle") }
                    .accessibilityIdentifier("workspace-rules")
                Button { open = .docs } label: { Label("Documents", systemImage: "doc.text") }
                    .accessibilityIdentifier("workspace-docs")
            }
            .buttonStyle(.bordered)
            .buttonBorderShape(.capsule)
            .font(.subheadline.weight(.medium))
            .sheet(item: $open) { sheet in
                NavigationStack {
                    switch sheet {
                    case .rules: BotWorkspaceDocEditor(bot: bot, path: BotWorkspaceFiles.rulesPath)
                    case .docs: BotDocsList(bot: bot)
                    }
                }
                .environmentObject(session)
            }
        }
    }
}

enum BotWorkspaceSheet: String, Identifiable {
    case rules, docs
    var id: String { rawValue }
}

/// The documents in docs/.
struct BotDocsList: View {
    @EnvironmentObject private var session: Session
    @Environment(\.dismiss) private var dismiss
    let bot: Bot
    @State private var listing: BotWorkspaceListing?
    @State private var failure: String?
    @State private var naming: String?
    @State private var name = ""
    @State private var renaming: BotWorkspaceEntry?
    @State private var creating: String?

    var body: some View {
        List {
            Section {
                if let listing {
                    if listing.docs.isEmpty { Text("No documents yet.").foregroundStyle(Theme.textSecondary) }
                    ForEach(listing.docs) { entry in
                        NavigationLink(value: entry.path) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(verbatim: entry.name)
                                if let modified = entry.modifiedAt {
                                    Text(Date(timeIntervalSince1970: modified / 1000), style: .relative)
                                        .font(.caption)
                                        .foregroundStyle(Theme.textSecondary)
                                }
                            }
                        }
                        .swipeActions {
                            Button(role: .destructive) { Task { await delete(entry) } } label: { Label("Delete", systemImage: "trash") }
                            Button { name = entry.name; renaming = entry } label: { Label("Rename", systemImage: "pencil") }.tint(.blue)
                        }
                    }
                } else if let failure {
                    Text(verbatim: failure).foregroundStyle(Theme.textSecondary)
                } else {
                    ProgressView()
                }
            } footer: {
                Text("Documents in docs/ are read when the bot needs them, not every turn.")
            }
        }
        .navigationTitle("Documents")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(for: String.self) { path in
            BotWorkspaceDocEditor(bot: bot, path: path, startsNew: path == creating)
        }
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
            ToolbarItem(placement: .primaryAction) {
                Button { name = ""; naming = "" } label: { Label("New document", systemImage: "plus") }
                    .accessibilityIdentifier("workspace-new-doc")
            }
        }
        .alert("New document", isPresented: Binding(get: { naming != nil }, set: { if !$0 { naming = nil } })) {
            TextField("Name", text: $name)
            Button("Cancel", role: .cancel) {}
            Button("Create") {
                guard let path = BotWorkspaceFiles.docPath(fromName: name) else { return }
                creating = path
                Task { await createAndOpen(path) }
            }
        }
        .alert("Rename", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Name", text: $name)
            Button("Cancel", role: .cancel) {}
            Button("Rename") { if let entry = renaming { Task { await rename(entry) } } }
        }
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        guard let client = session.profileClient else { return }
        do { listing = try await client.botWorkspace(botId: bot.id) } catch { failure = error.localizedDescription }
    }

    private func createAndOpen(_ path: String) async {
        guard let client = session.profileClient else { return }
        do {
            _ = try await client.saveWorkspaceDoc(botId: bot.id, path: path, text: "", expectedHash: nil)
            await load()
        } catch { session.actionError = error.localizedDescription }
    }

    private func delete(_ entry: BotWorkspaceEntry) async {
        guard let client = session.profileClient else { return }
        do { try await client.deleteWorkspaceDoc(botId: bot.id, path: entry.path); await load() }
        catch { session.actionError = error.localizedDescription }
    }

    private func rename(_ entry: BotWorkspaceEntry) async {
        guard let client = session.profileClient, let to = BotWorkspaceFiles.docPath(fromName: name), to != entry.path else { return }
        do { try await client.renameWorkspaceDoc(botId: bot.id, from: entry.path, to: to); await load() }
        catch { session.actionError = error.localizedDescription }
    }
}

/// One file in the markdown editor, saved with the hash it was read at.
struct BotWorkspaceDocEditor: View {
    @EnvironmentObject private var session: Session
    @Environment(\.dismiss) private var dismiss
    let bot: Bot
    let path: String
    var startsNew = false

    @State private var doc: MemoryDoc?
    @State private var draft = ""
    @State private var failure: String?
    @State private var saving = false
    @State private var conflict: (current: String, hash: String)?
    @State private var template: String?

    private var isRules: Bool { path == BotWorkspaceFiles.rulesPath }
    private var dirty: Bool { doc.map { $0.text != draft } ?? false }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if isRules {
                    Text("Rules load every turn, after the instructions. Keep them short: what the bot must always or never do.")
                        .font(.footnote)
                        .foregroundStyle(Theme.textSecondary)
                }
                if doc != nil {
                    MarkdownEditor(
                        text: $draft, minHeight: 320, footer: footer.text, footerIsWarning: footer.over,
                        accessibilityLabel: isRules ? String(localized: "Rules") : (path as NSString).lastPathComponent,
                        identifier: isRules ? "rules-editor" : "doc-editor"
                    )
                } else if let failure {
                    Text(verbatim: failure).foregroundStyle(Theme.textSecondary)
                } else {
                    ProgressView().frame(maxWidth: .infinity)
                }
            }
            .padding()
        }
        .navigationTitle(isRules ? String(localized: "Rules") : (path as NSString).lastPathComponent)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if isRules {
                ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
            }
            ToolbarItem(placement: .confirmationAction) {
                Button("Save") { Task { await save(expectedHash: doc?.hash) } }
                    .disabled(!dirty || saving)
                    .accessibilityIdentifier("workspace-save")
            }
        }
        .alert("This file changed", isPresented: Binding(get: { conflict != nil }, set: { if !$0 { conflict = nil } })) {
            Button("Reload") {
                if let conflict { doc = MemoryDoc(path: path, text: conflict.current, hash: conflict.hash); draft = conflict.current }
            }
            Button("Overwrite with mine", role: .destructive) {
                let hash = conflict?.hash
                Task { await save(expectedHash: hash) }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("The bot or someone else saved it since you opened it.")
        }
        .task { await load() }
    }

    private var footer: (text: String?, over: Bool) {
        guard isRules else { return (nil, false) }
        let count = BotWorkspaceFiles.rulesCount(draft)
        return (String(localized: "\(count.lines) of \(BotWorkspaceFiles.maxRulesLines) lines · \(count.bytes.formatted()) of \(BotWorkspaceFiles.maxRulesBytes.formatted()) bytes load each turn"), count.over)
    }

    private func load() async {
        guard let client = session.profileClient else { return }
        do {
            let loaded = try await client.workspaceDoc(botId: bot.id, path: path)
            doc = loaded
            draft = loaded.text
            // a new RULES.md starts from the server's template
            if isRules, loaded.exists == false, loaded.text.isEmpty,
               let template = try? await client.botWorkspace(botId: bot.id).rulesTemplate {
                draft = template
            }
        } catch { failure = error.localizedDescription }
    }

    private func save(expectedHash: String?) async {
        guard let client = session.profileClient else { return }
        saving = true
        defer { saving = false }
        do {
            switch try await client.saveWorkspaceDoc(botId: bot.id, path: path, text: draft, expectedHash: expectedHash) {
            case let .saved(saved, _):
                doc = saved
                Haptics.selection()
            case let .conflict(current, hash):
                conflict = (current, hash)
            }
        } catch { session.actionError = error.localizedDescription }
    }
}
