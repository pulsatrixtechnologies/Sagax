// iPad I2: what the desktop sidebar needs around it in the shell: the
// hardware-keyboard commands (KB1, KB2; src/lib/keyboard-shortcuts.ts and
// App.tsx), the prompts behind its menus (rename and delete a bot, and the
// WP5, WP6 and WP11 presenters, mounted once) and the keyboard shortcuts
// list. Connected apps is the Plugins modal (I5, DesktopPlugins.swift).
import SwiftUI
import UIKit
import CompanionCore

// MARK: - Keyboard

/// ⌘K palette, ⌘N New, ⌘1 to ⌘9 a bot, ⌘⇧[ / ⌘⇧] previous and next bot,
/// ⌘/ the shortcuts, ⌘\ the sidebar rail (⌘, Settings is the app menu's,
/// CompanionApp.swift). Invisible buttons:
/// iPadOS lists them in its ⌘ overlay under these titles.
struct DesktopKeyCommands: View {
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopShellModel

    var body: some View {
        ZStack {
            command("Search", key: "k") { model.menu = nil; model.modal = .search }
            command("New", key: "n") {
                model.menu = model.menu?.kind == .new ? nil : DesktopMenuRequest(kind: .new, anchor: newAnchor)
            }
            ForEach(1..<10, id: \.self) { number in
                command("Jump to bot \(number)", key: KeyEquivalent(Character("\(number)"))) {
                    model.menu = nil
                    model.jump(to: number - 1, in: session)
                }
            }
            command("Previous bot", key: "[", modifiers: [.command, .shift]) { model.step(-1, in: session) }
            command("Next bot", key: "]", modifiers: [.command, .shift]) { model.step(1, in: session) }
            command("Keyboard shortcuts", key: "/") { model.modal = .shortcuts }
            command("Toggle sidebar", key: "\\") { model.toggleCollapsed() }
        }
        .opacity(0)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    /// Under the New button (brand row, or the rail's third square).
    private var newAnchor: CGPoint {
        model.density == .icons ? CGPoint(x: 23.5, y: 148) : CGPoint(x: 201, y: 78)
    }

    private func command(
        _ title: LocalizedStringKey, key: KeyEquivalent, modifiers: EventModifiers = .command, action: @escaping () -> Void
    ) -> some View {
        Button(action: action) { Text(title) }
            .keyboardShortcut(key, modifiers: modifiers)
    }
}

// MARK: - Prompts

struct DesktopSidebarPrompts: ViewModifier {
    @ObservedObject var model: DesktopShellModel
    @EnvironmentObject private var session: Session

    func body(content: Content) -> some View {
        content
            .threadActionsPresenter(model.threadActions)
            .sidebarSectionActionsPresenter(model.sectionActions)
            .roomActionsPresenter(model.roomActions)
            .alert("Rename Bot", isPresented: Binding(
                get: { model.renamingBot != nil },
                set: { if !$0 { model.renamingBot = nil } }
            )) {
                TextField("Name", text: $model.renameDraft)
                    .autocorrectionDisabled()
                    .accessibilityIdentifier("desktop-rename-field")
                Button("Cancel", role: .cancel) { model.renamingBot = nil }
                Button("Save") { commitRename() }
                    .accessibilityIdentifier("desktop-rename-save")
            }
            .confirmationDialog(
                Text("Delete \(model.deletingBot?.name ?? "")?"),
                isPresented: Binding(
                    get: { model.deletingBot != nil },
                    set: { if !$0 { model.deletingBot = nil } }
                ),
                titleVisibility: .visible
            ) {
                Button("Delete", role: .destructive) { confirmDelete() }
                    .accessibilityIdentifier("desktop-delete-confirm")
                Button("Cancel", role: .cancel) { model.deletingBot = nil }
            } message: {
                Text("The bot and its conversations will be deleted. This cannot be undone.")
            }
    }

    /// The desktop renames in place; on iPad, the same `PATCH /profile`.
    private func commitRename() {
        guard let bot = model.renamingBot else { return }
        model.renamingBot = nil
        let name = model.renameDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name != bot.name else { return }
        Task { _ = await session.updateProfile(BotProfilePatch(name: name), for: bot) }
    }

    private func confirmDelete() {
        guard let bot = model.deletingBot else { return }
        model.deletingBot = nil
        Task {
            guard let client = session.profileClient else { return }
            do {
                try await client.deleteBot(botId: bot.id)
                if model.selected?.id == bot.id { model.selected = nil }
                session.applyBotDeleted(bot.id)
            } catch {
                session.actionError = error.localizedDescription
            }
        }
    }
}

// MARK: - Sheets

/// Templates (the team library) until its desktop modal lands: the catalog,
/// read-only; installing a team runs on the computer.
struct DesktopTemplatesSheet: View {
    @EnvironmentObject private var session: Session
    let close: () -> Void
    @State private var catalog: TeamLibraryCatalog?
    @State private var failure: String?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("Teams of bots ready to install. Install one from Sagax on your computer.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                if let catalog {
                    ForEach(catalog.teams) { team in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(verbatim: team.name).font(.body.weight(.medium))
                                Spacer(minLength: 8)
                                if let members = team.members {
                                    Text("\(members) bots").font(.footnote).foregroundStyle(.secondary)
                                }
                            }
                            Text(verbatim: team.summary).font(.footnote).foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 2)
                        .accessibilityElement(children: .combine)
                    }
                } else if let failure {
                    Text(verbatim: failure).foregroundStyle(.secondary)
                } else {
                    ProgressView()
                }
            }
            .navigationTitle("Templates")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done", action: close) }
            }
            .task {
                guard let client = session.profileClient else { return }
                do { catalog = try await client.teamLibraryCatalog() } catch { failure = error.localizedDescription }
            }
        }
        .accessibilityIdentifier("desktop-templates")
    }
}

/// The keyboard shortcuts (`KeyboardShortcutsDialog`) the iPad answers.
struct DesktopShortcutsSheet: View {
    let close: () -> Void

    private let rows: [(LocalizedStringKey, String)] = [
        ("Search bots and messages", "⌘ K"),
        ("Search or create a bot", "⌘ N"),
        ("Jump to bot 1–9 in the roster", "⌘ 1–9"),
        ("Switch to previous / next bot", "⌘ ⇧ [ / ]"),
        ("Keyboard shortcuts", "⌘ /"),
        ("Settings", "⌘ ,"),
        ("Collapse or expand the sidebar", "⌘ \\"),
    ]

    var body: some View {
        NavigationStack {
            List {
                ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                    HStack {
                        Text(row.0)
                        Spacer(minLength: 12)
                        Text(verbatim: row.1)
                            .font(.system(.body, design: .monospaced))
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle("Keyboard shortcuts")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done", action: close)
                }
            }
        }
    }
}
