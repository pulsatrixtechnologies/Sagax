// The thread, folder and bot-row menus of matrix package WP5, drawn from
// the plans in CompanionCore (`ThreadMenuPlan`, `FolderMenuPlan`) so every
// surface offers the desktop's entries in the desktop's order. They are
// menu content only: a phone puts them in `.contextMenu` or a `Menu`, the
// iPad desktop sidebar in its row menus.
import CompanionCore
import SwiftUI

/// The desktop's thread row menu (SidebarThreadRow.tsx).
struct ThreadMenu: View {
    let task: BotTask
    let plan: ThreadMenuPlan
    var folders: [BotProject] = []
    var regenerating = false
    let perform: (ThreadMenuAction) -> Void

    var body: some View {
        ForEach(plan.items, id: \.self) { item in
            entry(item)
        }
    }

    @ViewBuilder private func entry(_ item: ThreadMenuItem) -> some View {
        let enabled = plan.enables(item)
        switch item {
        case .copyLink:
            Button { perform(.copyLink) } label: { Label("Copy link", systemImage: "link") }
        case .rename:
            Button { perform(.rename) } label: { Label("Rename", systemImage: "pencil") }
        case .regenerateTitle:
            Button { perform(.regenerateTitle) } label: {
                Label(regenerating ? "Regenerating…" : "Regenerate title", systemImage: "arrow.clockwise")
            }
            .disabled(regenerating)
        case .moveToFolder:
            Menu {
                Picker(selection: Binding(
                    get: { folders.contains { $0.id == task.projectId } ? task.projectId ?? "" : "" },
                    set: { value in perform(.move(folderId: value.isEmpty ? nil : value)) }
                )) {
                    Text("No folder").tag("")
                    ForEach(folders) { folder in
                        Text(verbatim: folder.emoji.map { $0.isEmpty ? folder.name : "\($0) \(folder.name)" } ?? folder.name)
                            .tag(folder.id)
                    }
                } label: {
                    EmptyView()
                }
                .pickerStyle(.inline)
            } label: {
                Label("Move to folder", systemImage: "folder")
            }
        case .pin:
            Button { perform(.pin(task.pinned != true)) } label: {
                Label(task.pinned == true ? "Unpin" : "Pin", systemImage: task.pinned == true ? "pin.slash" : "pin")
            }
        case .archive:
            Button { perform(.archive(!task.isArchived)) } label: {
                Label(task.isArchived ? "Unarchive" : "Archive",
                      systemImage: task.isArchived ? "arrow.uturn.backward" : "archivebox")
            }
            .disabled(!enabled)
        case .snooze:
            Menu {
                Button("Until new activity") { perform(.snooze(until: 0)) }
                Button("Until 6 PM") { perform(.snooze(until: ThreadSnoozePreset.tonight())) }
                Button("Until 9 AM tomorrow") { perform(.snooze(until: ThreadSnoozePreset.tomorrowMorning())) }
            } label: {
                Label("Snooze", systemImage: "moon.zzz")
            }
            .disabled(!enabled)
        case .stopSnoozing:
            Button { perform(.stopSnoozing) } label: { Label("Stop snoozing", systemImage: "bell") }
        case .delete:
            Button(role: .destructive) { perform(.delete) } label: { Label("Delete", systemImage: "trash") }
                .disabled(!enabled)
        }
    }
}

/// The desktop's folder menu (FolderActions in BotProjects.tsx, and the
/// folder row's "+").
struct FolderMenu: View {
    let folder: BotProject
    let plan: FolderMenuPlan
    let perform: (FolderMenuAction) -> Void

    var body: some View {
        ForEach(plan.items, id: \.self) { item in
            switch item {
            case .newThread:
                Button { perform(.newThread) } label: {
                    Label("New thread in \(folder.name)", systemImage: "square.and.pencil")
                }
            case .settings:
                Button { perform(.settings) } label: { Label("Folder settings", systemImage: "pencil") }
            case .markRead:
                Button { perform(.markRead) } label: { Label("Mark folder as read", systemImage: "checkmark.circle") }
                    .disabled(!plan.enables(.markRead))
            case .moveUp:
                Button { perform(.move(direction: -1)) } label: { Label("Move folder up", systemImage: "arrow.up") }
                    .disabled(!plan.enables(.moveUp))
            case .moveDown:
                Button { perform(.move(direction: 1)) } label: { Label("Move folder down", systemImage: "arrow.down") }
                    .disabled(!plan.enables(.moveDown))
            }
        }
    }
}

/// The bot row's thread entries (the desktop bot menu): New folder for a
/// pairing that may manage folders, Mark as Unread, Copy conversation ID.
struct BotThreadsMenu: View {
    let bot: Bot
    @ObservedObject var actions: ThreadActions
    /// Settings > Appearance > Threads (WP6): off drops New folder, as the
    /// desktop bot menu does.
    var showsThreads = true
    @EnvironmentObject private var session: Session

    var body: some View {
        if showsThreads && session.surfaceGate.allows(.threadFolders) {
            Button { actions.newFolder(for: bot) } label: {
                Label("New folder", systemImage: "folder.badge.plus")
            }
        }
        Button { actions.markUnread(bot, session: session) } label: {
            Label("Mark as Unread", systemImage: "circle.fill")
        }
        Button { actions.copyConversationId(bot) } label: {
            Label("Copy conversation ID", systemImage: "doc.on.doc")
        }
    }
}

/// A folder's quiet status while it is closed (the desktop folder row):
/// waiting, working, or an unread dot.
struct FolderStatusMark: View {
    @Environment(\.themePalette) var themePalette
    let status: FolderStatus?

    var body: some View {
        switch status {
        case .waiting?:
            Text("Waiting on you")
                .font(.caption2.weight(.medium))
                .foregroundStyle(Theme.parity(Color.orange, Theme.warning))
        case .working?:
            ProgressView().controlSize(.mini)
                .accessibilityLabel(Text("Working"))
        case .unread?:
            Circle()
                .fill(Theme.parity(Color.accentColor, Theme.accentText))
                .frame(width: 6, height: 6)
                .accessibilityLabel(Text("Unread threads"))
        case nil:
            EmptyView()
        }
    }
}

extension View {
    /// The thread menu for one row, from the shared model.
    func threadMenu(_ task: BotTask, owner: Chat, actions: ThreadActions, session: Session) -> some View {
        contextMenu {
            ThreadMenu(
                task: task,
                plan: actions.plan(for: task, owner: owner, in: session),
                folders: actions.liveOwner(owner, in: session).botFolders,
                regenerating: actions.regenerating.contains(task.threadId)
            ) { action in
                actions.perform(action, on: ThreadTarget(task: task, owner: actions.liveOwner(owner, in: session)), session: session)
            }
        }
    }

    /// The folder menu for one folder header, from the shared model.
    func folderMenu(_ folder: BotProject, of bot: Bot, actions: ThreadActions, session: Session) -> some View {
        contextMenu {
            FolderMenu(folder: folder, plan: actions.folderPlan(folder, of: bot, in: session)) { action in
                actions.perform(action, folder: folder, of: session.state.bot(bot.id) ?? bot, session: session)
            }
        }
    }
}

extension Chat {
    /// A bot's folders in saved order; a room has none.
    var botFolders: [BotProject] {
        if case let .bot(bot) = self { return bot.folders }
        return []
    }
}
