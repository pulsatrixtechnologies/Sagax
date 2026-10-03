// The prompts behind the shared thread and folder menus: rename, delete,
// the folder dialog, the folder order, failures and the copy notice. Any
// surface that mounts `ThreadMenu` or `FolderMenu` mounts this once.
import CompanionCore
import SwiftUI

struct ThreadActionsPresenter: ViewModifier {
    @ObservedObject var actions: ThreadActions
    /// Hosts with their own rename or delete UI (the Threads sheet) turn
    /// these off and read `actions.renaming` / `actions.deleting` instead.
    var presentsRename = true
    var presentsDelete = true
    /// Hosts with their own error banner turn this off.
    var presentsErrors = true
    @EnvironmentObject private var session: Session

    func body(content: Content) -> some View {
        content
            .alert("Rename thread", isPresented: Binding(
                get: { presentsRename && actions.renaming != nil },
                set: { if !$0 { actions.renaming = nil } }
            )) {
                TextField("Thread title", text: $actions.renameDraft)
                    .autocorrectionDisabled()
                    .accessibilityIdentifier("thread-rename-field")
                Button("Cancel", role: .cancel) { actions.renaming = nil }
                Button("Save") { actions.commitRename(session) }
                    .accessibilityIdentifier("thread-rename-save")
            }
            .confirmationDialog(
                "Delete thread?",
                isPresented: Binding(
                    get: { presentsDelete && actions.deleting != nil },
                    set: { if !$0 { actions.deleting = nil } }
                ),
                titleVisibility: .visible
            ) {
                Button("Delete thread", role: .destructive) { actions.confirmDelete(session) }
                Button("Cancel", role: .cancel) { actions.deleting = nil }
            } message: {
                if let target = actions.deleting {
                    Text("“\(target.task.displayTitle)” and its conversation will be deleted. This cannot be undone.")
                }
            }
            .sheet(item: $actions.editingFolder) { target in
                FolderEditorSheet(target: target, actions: actions)
                    .environmentObject(session)
            }
            .sheet(item: $actions.orderingFolders) { target in
                FolderOrderSheet(botId: target.botId, actions: actions)
                    .environmentObject(session)
            }
            .alert("Couldn't update", isPresented: Binding(
                get: { presentsErrors && actions.error != nil && actions.editingFolder == nil && actions.orderingFolders == nil },
                set: { if !$0 { actions.error = nil } }
            )) {
                Button("OK", role: .cancel) { actions.error = nil }
            } message: {
                Text(verbatim: actions.error ?? "")
            }
            .overlay(alignment: .bottom) {
                if let notice = actions.notice {
                    Text(verbatim: notice)
                        .font(.subheadline.weight(.medium))
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(.regularMaterial, in: Capsule())
                        .padding(.bottom, 24)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                        .accessibilityIdentifier("thread-action-notice")
                }
            }
            .task(id: session.connection?.id) { await actions.loadFeatures(session) }
    }
}

extension View {
    func threadActionsPresenter(
        _ actions: ThreadActions,
        presentsRename: Bool = true,
        presentsDelete: Bool = true,
        presentsErrors: Bool = true
    ) -> some View {
        modifier(ThreadActionsPresenter(
            actions: actions, presentsRename: presentsRename,
            presentsDelete: presentsDelete, presentsErrors: presentsErrors
        ))
    }
}
