// The folder dialog (BotProjectDialog in BotProjects.tsx): a name, an icon
// from the presets or any emoji, and for an existing folder "Delete
// folder…", which keeps its threads. Folders only group threads; they own
// no model, permission or conversation.
import CompanionCore
import SwiftUI

struct FolderEditorSheet: View {
    @Environment(\.themePalette) var themePalette
    let target: FolderEditTarget
    @ObservedObject var actions: ThreadActions
    @EnvironmentObject private var session: Session
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var emoji: String
    @State private var saving = false
    @State private var confirmingDelete = false
    @State private var failure: String?
    @FocusState private var nameFocused: Bool

    init(target: FolderEditTarget, actions: ThreadActions) {
        self.target = target
        self.actions = actions
        _name = State(initialValue: target.folder?.name ?? "")
        _emoji = State(initialValue: target.folder?.emoji ?? "")
    }

    private var bot: Bot? { session.state.bot(target.botId) }

    var body: some View {
        NavigationStack {
            ThemedList {
                Section {
                    TextField("Folder name", text: $name)
                        .focused($nameFocused)
                        .autocorrectionDisabled()
                        .submitLabel(.done)
                        .onSubmit(save)
                        .disabled(saving)
                        .accessibilityIdentifier("folder-name")
                } header: {
                    Text("Folder name")
                } footer: {
                    if let bot {
                        Text("Keep related threads together under \(bot.name). Moving a thread never changes its model, permissions, or conversation.")
                    }
                }

                Section {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 4), count: 7), spacing: 6) {
                        iconButton("", label: Text("Default folder icon"))
                        ForEach(FolderFields.emojiPresets, id: \.self) { preset in
                            iconButton(preset, label: Text(verbatim: preset))
                        }
                    }
                    .padding(.vertical, 4)
                    TextField("Custom emoji", text: $emoji)
                        .disabled(saving)
                        .accessibilityIdentifier("folder-emoji")
                } header: {
                    Text("Choose folder icon")
                } footer: {
                    Text("Choose an emoji or paste one below. Leave blank for the default folder icon.")
                }

                if let failure {
                    Section {
                        Label(failure, systemImage: "exclamationmark.circle")
                            .foregroundStyle(Theme.danger)
                            .accessibilityIdentifier("folder-error")
                    }
                }

                if target.folder != nil {
                    Section {
                        Button("Delete folder…", role: .destructive) { confirmingDelete = true }
                            .disabled(saving)
                            .accessibilityIdentifier("folder-delete")
                    }
                }
            }
            .navigationTitle(target.folder == nil ? "Create folder" : "Folder settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.disabled(saving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "Saving…" : target.folder == nil ? "Create folder" : "Save folder", action: save)
                        .disabled(saving || FolderFields.name(name) == nil)
                        .accessibilityIdentifier("folder-save")
                }
            }
            .confirmationDialog("Delete folder?", isPresented: $confirmingDelete, titleVisibility: .visible) {
                Button("Delete folder, keep threads", role: .destructive, action: delete)
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Delete this folder? Its threads move out of the folder. All conversation history is kept.")
            }
        }
        .interactiveDismissDisabled(saving)
        .onAppear { nameFocused = true }
    }

    private func iconButton(_ value: String, label: Text) -> some View {
        let selected = FolderFields.emoji(emoji) == FolderFields.emoji(value)
        return Button {
            emoji = value
        } label: {
            Group {
                if value.isEmpty {
                    Image(systemName: "folder").font(.title3)
                } else {
                    Text(verbatim: value).font(.title3)
                }
            }
            .frame(width: 40, height: 40)
            .background(selected ? Theme.parity(Color.accentColor, Theme.accentText).opacity(0.18) : .clear,
                        in: RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityAddTraits(selected ? .isSelected : [])
        .disabled(saving)
    }

    private func save() {
        guard !saving, let bot, let valid = FolderFields.name(name) else { return }
        saving = true
        failure = nil
        let icon = FolderFields.emoji(emoji)
        Task {
            let ok: Bool
            if let folder = target.folder {
                // Send only what changed; an emptied icon resets it (null).
                let newName = valid == folder.name ? nil : valid
                let newEmoji: String?? = icon == FolderFields.emoji(folder.emoji ?? "") ? nil : .some(icon)
                ok = newName == nil && newEmoji == nil
                    ? true
                    : await session.updateFolder(folder, for: bot, name: newName, emoji: newEmoji)
            } else {
                ok = await session.createFolder(for: bot, name: valid, emoji: icon) != nil
            }
            saving = false
            if ok { dismiss() } else { showFailure() }
        }
    }

    private func delete() {
        guard let bot, let folder = target.folder else { return }
        saving = true
        failure = nil
        Task {
            let ok = await session.deleteFolder(folder, for: bot)
            saving = false
            if ok { dismiss() } else { showFailure() }
        }
    }

    private func showFailure() {
        failure = session.actionError ?? String(localized: "Couldn't save the folder. Try again.")
        session.actionError = nil
    }
}

/// Folder order (SB20): the saved order, dragged into place. The desktop
/// drags folder rows in the sidebar; the phone uses a list in edit mode.
struct FolderOrderSheet: View {
    @Environment(\.themePalette) var themePalette
    let botId: String
    @ObservedObject var actions: ThreadActions
    @EnvironmentObject private var session: Session
    @Environment(\.dismiss) private var dismiss
    @State private var ids: [String] = []
    @State private var saving = false
    @State private var failure: String?

    private var bot: Bot? { session.state.bot(botId) }

    var body: some View {
        NavigationStack {
            ThemedList {
                Section {
                    ForEach(ids, id: \.self) { id in
                        if let folder = bot?.folders.first(where: { $0.id == id }) {
                            HStack(spacing: 8) {
                                if let emoji = folder.emoji, !emoji.isEmpty { Text(verbatim: emoji) }
                                else { Image(systemName: "folder") }
                                Text(verbatim: folder.name)
                            }
                            .accessibilityIdentifier("folder-order.\(id)")
                        }
                    }
                    .onMove { source, destination in
                        ids = FolderOrder.move(ids, fromOffsets: source, toOffset: destination)
                    }
                } footer: {
                    if let failure {
                        Text(verbatim: failure).foregroundStyle(Theme.danger)
                    }
                }
            }
            .environment(\.editMode, .constant(.active))
            .navigationTitle("Reorder folders")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.disabled(saving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "Saving…" : "Save", action: save)
                        .disabled(saving)
                        .accessibilityIdentifier("folder-order-save")
                }
            }
        }
        .interactiveDismissDisabled(saving)
        .onAppear { ids = bot?.folders.map(\.id) ?? [] }
    }

    private func save() {
        guard let bot else { dismiss(); return }
        saving = true
        failure = nil
        Task {
            let ok = await session.reorderFolders(for: bot, ids: ids)
            saving = false
            if ok {
                dismiss()
            } else {
                failure = session.actionError ?? String(localized: "Couldn't save the folder order. Try again.")
                session.actionError = nil
            }
        }
    }
}
