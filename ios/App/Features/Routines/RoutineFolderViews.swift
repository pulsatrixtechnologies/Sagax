import CompanionCore
import SwiftUI

// Routine folders on the phone (2026-10-28, RoutineFolders.swift): the
// folder header of a routine list (chevron, name, count, its menu), the
// row's "Move to folder" menu, and the prompts they open (New folder, Rename,
// Delete). Used by Automations / Threads & Routines and the bot panel's
// Routines page. Whoever may change a bot's routines arranges its folders:
// no admin right, the server is the judge.

@MainActor
final class RoutineFolderController: ObservableObject {
    enum Prompt: Identifiable {
        /// A new folder; with routines, they move into it.
        case create(botId: String, routineIds: [String])
        case rename(botId: String, folder: String)

        var id: String {
            switch self {
            case let .create(botId, ids): "create:\(botId):\(ids.joined(separator: ","))"
            case let .rename(botId, folder): "rename:\(botId):\(folder)"
            }
        }
    }

    struct Deleting: Identifiable {
        let botId: String
        let folder: String
        var id: String { "\(botId):\(folder)" }
    }

    @Published var prompt: Prompt?
    @Published var promptText = ""
    @Published var deleting: Deleting?
    /// A row's swipe "Folder": the folder choice as a dialog.
    @Published var moving: Routine?
    @Published var busy = false
    @Published private var foldTick = 0
    private let collapse = RoutineFolderCollapse()

    func isCollapsed(botId: String, folder: String) -> Bool {
        _ = foldTick
        return collapse.isCollapsed(botId: botId, folder: folder)
    }

    func toggle(botId: String, folder: String) {
        collapse.setCollapsed(!collapse.isCollapsed(botId: botId, folder: folder), botId: botId, folder: folder)
        foldTick += 1
    }

    func askNewFolder(botId: String, moving routineIds: [String] = []) {
        promptText = ""
        prompt = .create(botId: botId, routineIds: routineIds)
    }

    func askRename(botId: String, folder: String) {
        promptText = folder
        prompt = .rename(botId: botId, folder: folder)
    }

    /// Run an action, then let the screen reload its list.
    func perform(_ action: RoutineFolderAction, session: Session, reload: @escaping () async -> Void) async {
        busy = true
        defer { busy = false }
        if await session.routineFolderAction(action) != nil {
            if case let .rename(botId, from, to) = action, let clean = RoutineFolders.clean(to) {
                collapse.rename(botId: botId, from: from, to: clean)
                foldTick += 1
            }
        }
        await reload()
    }

    func submitPrompt(session: Session, reload: @escaping () async -> Void) async {
        guard let prompt, let name = RoutineFolders.clean(promptText) else { return }
        self.prompt = nil
        switch prompt {
        case let .create(botId, ids):
            // a move to a name the bot lacks creates the folder
            let action: RoutineFolderAction = ids.isEmpty
                ? .create(botId: botId, name: name)
                : .move(botId: botId, routineIds: ids, folder: name)
            await perform(action, session: session, reload: reload)
        case let .rename(botId, folder):
            guard name != folder else { return }
            await perform(.rename(botId: botId, from: folder, to: name), session: session, reload: reload)
        }
    }

    func setEnabled(_ routines: [Routine], enabled: Bool, session: Session, reload: @escaping () async -> Void) async {
        busy = true
        defer { busy = false }
        await session.setRoutinesEnabled(routines, enabled: enabled)
        await reload()
    }
}

/// The section header of one folder: chevron, folder glyph, name, count,
/// the bot's name when the list mixes bots, and the folder's menu.
struct RoutineFolderHeader: View {
    @Environment(\.themePalette) var themePalette
    let group: RoutineFolderGroup
    let botId: String
    let folder: String
    /// Shown after the name in a list of several bots.
    var botName: String?
    @ObservedObject var controller: RoutineFolderController
    let onSetEnabled: (_ enabled: Bool) -> Void

    private var collapsed: Bool { controller.isCollapsed(botId: botId, folder: folder) }
    private var editable: Bool { group.routines.allSatisfy(\.mayEdit) }
    private var pausable: [Routine] { RoutinePauseAll.pausable(group.routines) }
    private var resumable: [Routine] { RoutinePauseAll.resumable(group.routines) }
    private var paused: Int { group.routines.filter { !$0.enabled }.count }

    var body: some View {
        HStack(spacing: 6) {
            Button {
                Haptics.selection()
                withAnimation(.snappy) { controller.toggle(botId: botId, folder: folder) }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: collapsed ? "chevron.right" : "chevron.down")
                        .font(.system(size: 10, weight: .semibold))
                        .frame(width: 12)
                    Image(systemName: "folder")
                    Text(verbatim: folder).lineLimit(1)
                    Text(verbatim: "\(group.routines.count)").monospacedDigit().opacity(0.6)
                    if let botName {
                        Text(verbatim: "· \(botName)").lineLimit(1).opacity(0.6)
                    }
                    // folded: the paused count stays visible
                    if collapsed && paused > 0 {
                        Image(systemName: "pause.circle.fill").opacity(0.6)
                            .accessibilityHidden(true)
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: botName.map { "\(folder), \($0)" } ?? folder))
            .accessibilityValue(collapsed
                ? Text("Collapsed, \(group.routines.count) routines")
                : Text("Expanded, \(group.routines.count) routines"))
            .accessibilityIdentifier("routine-folder.\(botId).\(folder)")

            if editable {
                Menu {
                    Button(String(localized: "Rename folder…"), systemImage: "pencil") {
                        controller.askRename(botId: botId, folder: folder)
                    }
                    if !pausable.isEmpty {
                        Button(String(localized: "Pause all in folder"), systemImage: "pause") { onSetEnabled(false) }
                    }
                    if !resumable.isEmpty {
                        Button(String(localized: "Resume all in folder"), systemImage: "play") { onSetEnabled(true) }
                    }
                    Divider()
                    Button(String(localized: "Delete folder"), systemImage: "folder.badge.minus", role: .destructive) {
                        controller.deleting = .init(botId: botId, folder: folder)
                    }
                } label: {
                    Image(systemName: "ellipsis")
                        .frame(width: 32, height: 28)
                        .contentShape(Rectangle())
                }
                .accessibilityLabel(Text("Folder actions"))
                .accessibilityIdentifier("routine-folder-menu.\(botId).\(folder)")
                .disabled(controller.busy)
            }
        }
        .font(.footnote.weight(.semibold))
        .foregroundStyle(Theme.textSecondary)
        .textCase(nil)
    }
}

/// A row's "Move to folder" submenu: the bot's folders, New folder…, and
/// Remove from folder when it sits in one.
struct RoutineFolderMoveMenu: View {
    let routine: Routine
    let folders: [String]
    @ObservedObject var controller: RoutineFolderController
    let move: (_ folder: String?) -> Void

    var body: some View {
        Menu {
            ForEach(folders, id: \.self) { folder in
                let here = routine.folder.map { RoutineFolders.key($0) == RoutineFolders.key(folder) } ?? false
                Button {
                    move(folder)
                } label: {
                    if here { Label { Text(verbatim: folder) } icon: { Image(systemName: "checkmark") } }
                    else { Text(verbatim: folder) }
                }
                .disabled(here)
            }
            if !folders.isEmpty { Divider() }
            Button(String(localized: "New folder…"), systemImage: "folder.badge.plus") {
                controller.askNewFolder(botId: routine.botId, moving: [routine.id])
            }
            if routine.folder?.isEmpty == false {
                Button(String(localized: "Remove from folder"), systemImage: "folder.badge.minus") { move(nil) }
            }
        } label: {
            Label(String(localized: "Move to folder"), systemImage: "folder")
        }
        .accessibilityIdentifier("routine-move-folder.\(routine.name)")
    }
}

/// The prompts the header and the rows open: New folder / Rename (a text
/// alert), Delete (a confirmation), and the swipe's folder choice.
struct RoutineFolderPrompts: ViewModifier {
    @ObservedObject var controller: RoutineFolderController
    let session: Session
    /// The folder order of a bot, for the swipe's choice.
    let folders: (_ botId: String) -> [String]
    let reload: () async -> Void

    private var promptTitle: String {
        switch controller.prompt {
        case .rename: String(localized: "Rename folder")
        default: String(localized: "New folder")
        }
    }

    func body(content: Content) -> some View {
        content
            .alert(promptTitle, isPresented: Binding(
                get: { controller.prompt != nil },
                set: { if !$0 { controller.prompt = nil } }
            )) {
                TextField(String(localized: "Folder name"), text: $controller.promptText)
                    .accessibilityIdentifier("routine-folder-name")
                Button(String(localized: "Cancel"), role: .cancel) { controller.prompt = nil }
                Button({ if case .rename = controller.prompt { String(localized: "Rename") } else { String(localized: "Create") } }()) {
                    Task { await controller.submitPrompt(session: session, reload: reload) }
                }
                .disabled(RoutineFolders.clean(controller.promptText) == nil)
            } message: {
                if case .create(_, let ids) = controller.prompt, !ids.isEmpty {
                    Text("The routine moves into the new folder.")
                }
            }
            .confirmationDialog(
                controller.deleting.map { String(localized: "Delete the folder \($0.folder)?") } ?? "",
                isPresented: Binding(get: { controller.deleting != nil }, set: { if !$0 { controller.deleting = nil } }),
                titleVisibility: .visible,
                presenting: controller.deleting
            ) { target in
                Button(String(localized: "Delete folder"), role: .destructive) {
                    Task { await controller.perform(.delete(botId: target.botId, name: target.folder), session: session, reload: reload) }
                }
                Button(String(localized: "Cancel"), role: .cancel) {}
            } message: { _ in
                Text("Its routines go back to no folder. No routine is deleted.")
            }
            .confirmationDialog(
                String(localized: "Move to folder"),
                isPresented: Binding(get: { controller.moving != nil }, set: { if !$0 { controller.moving = nil } }),
                titleVisibility: .visible,
                presenting: controller.moving
            ) { routine in
                ForEach(folders(routine.botId).filter { name in
                    routine.folder.map { RoutineFolders.key($0) != RoutineFolders.key(name) } ?? true
                }, id: \.self) { folder in
                    Button(folder) {
                        Task { await controller.perform(.move(botId: routine.botId, routineIds: [routine.id], folder: folder), session: session, reload: reload) }
                    }
                }
                Button(String(localized: "New folder…")) {
                    // let the dialog leave before the text alert comes in
                    Task {
                        try? await Task.sleep(nanoseconds: 350_000_000)
                        controller.askNewFolder(botId: routine.botId, moving: [routine.id])
                    }
                }
                if routine.folder?.isEmpty == false {
                    Button(String(localized: "Remove from folder")) {
                        Task { await controller.perform(.move(botId: routine.botId, routineIds: [routine.id], folder: nil), session: session, reload: reload) }
                    }
                }
                Button(String(localized: "Cancel"), role: .cancel) {}
            }
    }
}

extension View {
    func routineFolderPrompts(
        _ controller: RoutineFolderController,
        session: Session,
        folders: @escaping (_ botId: String) -> [String],
        reload: @escaping () async -> Void
    ) -> some View {
        modifier(RoutineFolderPrompts(controller: controller, session: session, folders: folders, reload: reload))
    }
}
