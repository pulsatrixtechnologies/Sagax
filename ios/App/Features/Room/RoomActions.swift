// The room menu (Sidebar.tsx RoomContextMenu, matrix RM13, RM14, RM15,
// RM16): rename, move to section, copy the conversation ID, delete. The
// items are drawn by `RoomRowMenu` wherever a room row is long-pressed and
// by the Room info sheet; their prompts live in `RoomActionsPresenter`,
// mounted once by each host. Owner items follow `RoomInfoAccess`: the
// remote client (a sidecar pairing) never draws them.
import CompanionCore
import SwiftUI
import UIKit

@MainActor
final class RoomActions: ObservableObject {
    @Published var renaming: Room?
    @Published var renameDraft = ""
    @Published var deleting: Room?
    @Published var newSectionFor: Room?
    @Published var sectionDraft = ""
    @Published var notice: String?
    /// Set when a delete went through: the host leaves the room's screen.
    @Published var deleted: String?

    func startRename(_ room: Room) {
        renameDraft = room.name
        renaming = room
    }

    func commitRename(_ session: Session) {
        guard let room = renaming else { return }
        renaming = nil
        guard let name = RoomPatch.rename(room.name, to: renameDraft) else { return }
        Task { await session.patchRoom(room, RoomPatch(name: name)) }
    }

    func move(_ room: Room, to section: String, _ session: Session) {
        Task { await session.patchRoom(room, RoomPatch(section: section)) }
    }

    func commitNewSection(_ session: Session) {
        guard let room = newSectionFor else { return }
        newSectionFor = nil
        guard let name = RoomSections.valid(sectionDraft) else { return }
        move(room, to: name, session)
    }

    func confirmDelete(_ session: Session) {
        guard let room = deleting else { return }
        deleting = nil
        Task {
            if await session.deleteRoom(room) { deleted = room.id }
        }
    }

    /// The desktop copies the room's conversation (thread) id.
    func copyConversationId(_ room: Room) {
        UIPasteboard.general.string = room.threadId
        flash(String(localized: "Conversation ID copied"))
    }

    private func flash(_ text: String) {
        withAnimation { notice = text }
        Task {
            try? await Task.sleep(nanoseconds: 1_600_000_000)
            withAnimation { if notice == text { notice = nil } }
        }
    }
}

/// The long-press items for one room, in the desktop's order
/// (NavigationMenus.room): View profile, Rename, Move to team, Copy
/// conversation ID, Hide from sidebar; the phone's group pin; Delete.
struct RoomRowMenu: View {
    let room: Room
    @ObservedObject var actions: RoomActions
    /// WP6: on an organization server a group goes in the person's own
    /// sections (personal-sections.ts), never in the server's.
    var personalLayout: SidebarLayout? = nil
    var sectionActions: SidebarSectionActions? = nil
    @EnvironmentObject private var session: Session

    var body: some View {
        let access = session.roomAccess(room)
        let peer = room.peopleDm == true ? PeopleDirectory.shared.peer(room, session: session) : nil
        let groups = NavigationMenus.room(room, RoomMenuContext(
            gate: session.surfaceGate,
            access: access,
            personalSections: personalLayout != nil && sectionActions != nil,
            knowsPeer: peer != nil,
            groupPinsSupported: session.groupPinsSupported
        ))
        ForEach(Array(groups.enumerated()), id: \.offset) { index, group in
            if index > 0 { Divider() }
            ForEach(group, id: \.self) { item in
                entry(item, peer: peer)
            }
        }
    }

    @ViewBuilder
    private func entry(_ item: RoomMenuItem, peer: PeopleDMPeer?) -> some View {
        switch item {
        case .viewProfile:
            Button {
                if let peer { PeopleDirectory.shared.showPerson(peer.id) }
            } label: {
                Label(String(localized: "View profile"), systemImage: "person.crop.circle")
            }
            .accessibilityIdentifier("room-view-profile")
        case .rename:
            Button {
                actions.startRename(room)
            } label: {
                Label(room.dm == true ? String(localized: "Rename thread") : String(localized: "Rename group chat"), systemImage: "pencil")
            }
        case .moveTo:
            if let personalLayout, let sectionActions {
                PersonalSectionPicker(key: PersonalSections.itemKey(group: room.id), layout: personalLayout, actions: sectionActions,
                                      title: String(localized: "Move to team"))
            } else {
                RoomSectionMenu(room: room, actions: actions)
            }
        case .copyConversationId:
            Button {
                actions.copyConversationId(room)
            } label: {
                Label(String(localized: "Copy conversation ID"), systemImage: "doc.on.clipboard")
            }
        case .hide:
            // WP6 (SB25, RM13): only this person's sidebar; a direct
            // conversation with someone is hidden as that person
            Button {
                SidebarPrefsModel.shared.hide(session, room: room)
            } label: {
                Label(String(localized: "Hide from sidebar"), systemImage: "eye.slash")
            }
        case .pin, .unpin:
            Button {
                Task { await session.setPinned(room, pinned: item == .pin) }
            } label: {
                Label(item == .pin ? String(localized: "Pin") : String(localized: "Unpin"),
                      systemImage: item == .pin ? "pin" : "pin.slash")
            }
        case .delete:
            Button(role: .destructive) {
                actions.deleting = room
            } label: {
                Label(room.dm == true ? String(localized: "Delete thread") : String(localized: "Delete group chat"), systemImage: "trash")
            }
        }
    }
}

/// Move to section: the known sections, a new one, or out of its section
/// (Sidebar.tsx SectionPicker; "" clears).
struct RoomSectionMenu: View {
    let room: Room
    @ObservedObject var actions: RoomActions
    @EnvironmentObject private var session: Session

    var body: some View {
        let current = room.section?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        Menu {
            ForEach(RoomSections.names(session.state), id: \.self) { name in
                Button {
                    if name != current { actions.move(room, to: name, session) }
                } label: {
                    if name == current {
                        Label(name, systemImage: "checkmark")
                    } else {
                        Text(verbatim: name)
                    }
                }
            }
            Button {
                actions.sectionDraft = ""
                actions.newSectionFor = room
            } label: {
                Label(String(localized: "New section"), systemImage: "folder.badge.plus")
            }
            if !current.isEmpty {
                Button(role: .destructive) {
                    actions.move(room, to: "", session)
                } label: {
                    Label(String(localized: "Remove from section"), systemImage: "folder.badge.minus")
                }
            }
        } label: {
            Label(String(localized: "Move to team"), systemImage: "folder")
        }
    }
}

/// The same choices as a page, for the Room info sheet (a menu inside a
/// list row is a long reach on a phone).
struct RoomSectionPicker: View {
    @Environment(\.themePalette) var themePalette
    let roomId: String
    @ObservedObject var actions: RoomActions
    @EnvironmentObject private var session: Session
    @State private var naming = false
    @State private var draft = ""

    private var room: Room? { session.state.rooms.first { $0.id == roomId } }

    var body: some View {
        let current = room?.section?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        ThemedList {
            Section {
                ForEach(RoomSections.names(session.state), id: \.self) { name in
                    Button {
                        if let room, name != current { actions.move(room, to: name, session) }
                    } label: {
                        HStack {
                            Text(verbatim: name).foregroundStyle(Theme.textPrimary)
                            Spacer(minLength: 8)
                            if name == current { Image(systemName: "checkmark").foregroundStyle(Theme.accent) }
                        }
                    }
                }
                Button {
                    draft = ""
                    naming = true
                } label: {
                    Label(String(localized: "New section"), systemImage: "folder.badge.plus")
                }
                .accessibilityIdentifier("room-section-new")
            }
            if let room, !current.isEmpty {
                Section {
                    Button(String(localized: "Remove from section"), role: .destructive) {
                        actions.move(room, to: "", session)
                    }
                }
            }
        }
        .navigationTitle(String(localized: "Move to section"))
        .navigationBarTitleDisplayMode(.inline)
        // Its own prompt: the host's would sit under this pushed page.
        .alert(String(localized: "New section"), isPresented: $naming) {
            TextField(String(localized: "Section name"), text: $draft)
                .accessibilityIdentifier("room-section-field")
            Button(String(localized: "Cancel"), role: .cancel) {}
            Button(String(localized: "Add")) {
                if let room, let name = RoomSections.valid(draft) { actions.move(room, to: name, session) }
            }
        }
    }
}

struct RoomActionsPresenter: ViewModifier {
    @ObservedObject var actions: RoomActions
    @EnvironmentObject private var session: Session

    func body(content: Content) -> some View {
        content
            .alert(String(localized: "Rename group chat"), isPresented: Binding(
                get: { actions.renaming != nil },
                set: { if !$0 { actions.renaming = nil } }
            )) {
                TextField(String(localized: "Group chat name"), text: $actions.renameDraft)
                    .autocorrectionDisabled()
                    .accessibilityIdentifier("room-rename-field")
                Button(String(localized: "Cancel"), role: .cancel) { actions.renaming = nil }
                Button(String(localized: "Save")) { actions.commitRename(session) }
                    .accessibilityIdentifier("room-rename-save")
            }
            .alert(String(localized: "New section"), isPresented: Binding(
                get: { actions.newSectionFor != nil },
                set: { if !$0 { actions.newSectionFor = nil } }
            )) {
                TextField(String(localized: "Section name"), text: $actions.sectionDraft)
                    .accessibilityIdentifier("room-section-field")
                Button(String(localized: "Cancel"), role: .cancel) { actions.newSectionFor = nil }
                Button(String(localized: "Add")) { actions.commitNewSection(session) }
            }
            .confirmationDialog(
                actions.deleting.map { String(localized: "Delete \($0.name)?") } ?? "",
                isPresented: Binding(
                    get: { actions.deleting != nil },
                    set: { if !$0 { actions.deleting = nil } }
                ),
                titleVisibility: .visible
            ) {
                Button(String(localized: "Delete group chat"), role: .destructive) { actions.confirmDelete(session) }
                    .accessibilityIdentifier("room-delete-confirm")
                Button(String(localized: "Cancel"), role: .cancel) { actions.deleting = nil }
            } message: {
                if let room = actions.deleting {
                    Text(String(localized: "This permanently deletes the \(room.name) group chat, its messages, and every thread in it, and turns off the routines that run there. The bots in it are not deleted. This cannot be undone."))
                }
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
                        .accessibilityIdentifier("room-action-notice")
                }
            }
    }
}

extension View {
    func roomActionsPresenter(_ actions: RoomActions) -> some View {
        modifier(RoomActionsPresenter(actions: actions))
    }
}
