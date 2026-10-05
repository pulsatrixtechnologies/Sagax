// Room info (matrix RM6, RM7, RM8, RM14-RM19; GroupPanel.tsx): the desktop
// panel's tabs (`GROUP_PANEL_TABS`) as a segmented control — Details (the
// room's faces and name, People, Bots and Manage, Leave), Instructions,
// Memory, Advanced (Default responder, Working folder). Rename, Move to
// team, Copy ID and Delete are the row menu's (RoomRowMenu), as on the
// desktop. Owner items follow `RoomInfoAccess` and are never drawn disabled.
//
// `RoomInfoView` is the presentation-free body; the phone wraps it in a
// sheet (`RoomInfoSheet`), the iPad desktop shell will dock it as the
// `group-panel`.
import CompanionCore
import SwiftUI

struct RoomInfoSheet: View {
    let roomId: String
    var openThreads: () -> Void = {}
    var onDeleted: () -> Void = {}
    @EnvironmentObject private var session: Session
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            RoomInfoView(roomId: roomId, openThreads: openThreads, onDeleted: onDeleted)
                .navigationTitle(String(localized: "Group info"))
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button(String(localized: "Done")) { dismiss() }
                            .accessibilityIdentifier("room-info-done")
                    }
                }
        }
    }
}

struct RoomInfoView: View {
    @Environment(\.themePalette) var themePalette
    let roomId: String
    var openThreads: () -> Void = {}
    var onDeleted: () -> Void = {}
    @EnvironmentObject private var session: Session
    @StateObject private var actions = RoomActions()
    @State private var jevOn = false
    @State private var directory: OrgDirectory?
    @State private var managingMembers = false
    @State private var pickingPeople = false
    @State private var addingEmail = false
    @State private var emailDraft = ""
    @State private var tab: RoomInfoTab = .details

    private var room: Room? { session.state.rooms.first { $0.id == roomId } }

    var body: some View {
        Group {
            if let room {
                content(room)
            } else {
                Color.clear
            }
        }
        .roomActionsPresenter(actions)
        .onValueChange(of: actions.deleted) { deleted in
            if deleted == roomId { onDeleted() }
        }
        .task(id: session.connection?.id) {
            jevOn = await session.configStatus()?.jevRoomRoutingOn ?? false
            if session.surfaceGate.organization { directory = await session.orgDirectory() }
        }
    }

    @ViewBuilder
    private func content(_ room: Room) -> some View {
        let access = session.roomAccess(room)
        let tabs = RoomInfoTab.available(access: access, gate: session.surfaceGate)
        VStack(spacing: 0) {
            Picker(String(localized: "Group info"), selection: $tab) {
                ForEach(tabs, id: \.self) { tab in
                    Text(tab.title).tag(tab)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .accessibilityIdentifier("room-tabs")
            switch tabs.contains(tab) ? tab : .details {
            case .details: AnyView(details(room, access: access))
            case .instructions: AnyView(RoomInstructionsView(roomId: roomId, editable: access.editable))
            case .memory: AnyView(RoomMemoryView(room: room))
            case .advanced: AnyView(advanced(room, access: access))
            }
        }
        .background(Theme.bg)
    }

    private func advanced(_ room: Room, access: RoomInfoAccess) -> some View {
        ThemedList {
            RoomResponderSection(room: room, jevOn: jevOn)
                .disabled(!access.editable)
            if session.surfaceGate.scope == .serverAdmin {
                RoomFolderSection(room: room, editable: access.editable)
            }
        }
        .accessibilityIdentifier("room-advanced")
    }

    @ViewBuilder
    private func details(_ room: Room, access: RoomInfoAccess) -> some View {
        let members = room.memberIds.compactMap { session.state.bot($0) }
        ThemedList {
            Section {
                header(room, members: members, access: access)
                    .listRowBackground(Color.clear)
            }
            if access.readOnlyNote {
                Section {
                    Text(String(localized: "Only the group's owner can change these settings."))
                        .font(.footnote)
                        .foregroundStyle(Theme.textSecondary)
                        .accessibilityIdentifier("room-owner-only")
                }
            }

            RoomPeopleSection(
                room: room, access: access, directory: directory,
                pickPeople: { pickingPeople = true },
                addEmail: { emailDraft = ""; addingEmail = true }
            )
            RoomBotsSection(room: room, access: access, manageMembers: { managingMembers = true })

            Section {
                // the phone's way into the room's threads (the header's tap)
                Button(action: openThreads) {
                    row(String(localized: "Threads"), systemImage: "square.stack", value: "\(room.tasks?.count ?? 1)")
                }
                .accessibilityIdentifier("room-threads")
            }

            if access.canLeave {
                Section {
                    Button(String(localized: "Leave group"), role: .destructive) {
                        Task {
                            await session.patchRoom(room, RoomPatch(humanIds: RoomOwnership.humanIdsLeaving(room, viewer: session.roomViewer)))
                        }
                    }
                    .accessibilityIdentifier("room-leave")
                }
            }
        }
        .accessibilityIdentifier("room-info")
        .sheet(isPresented: $managingMembers) {
            RoomManageMembersSheet(room: room).environmentObject(session)
        }
        .sheet(isPresented: $pickingPeople) {
            RoomPeoplePickerSheet(roomId: roomId, directory: directory).environmentObject(session)
        }
        .alert(String(localized: "Add a person"), isPresented: $addingEmail) {
            TextField(String(localized: "Email address"), text: $emailDraft)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            Button(String(localized: "Cancel"), role: .cancel) {}
            Button(String(localized: "Add")) {
                let email = emailDraft.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                guard !email.isEmpty else { return }
                Task { await session.patchRoom(room, RoomPatch(humanIds: RoomOwnership.humanIdsAdding(email, to: room))) }
            }
        }
    }

    private func header(_ room: Room, members: [Bot], access: RoomInfoAccess) -> some View {
        VStack(spacing: 8) {
            ChatAvatarView(chat: .room(room), size: 96, background: Theme.bg)
                .frame(width: 112, height: 112)
                .accessibilityHidden(true)
            Button {
                if access.editable { actions.startRename(room) }
            } label: {
                HStack(spacing: 6) {
                    Text(verbatim: room.name)
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(Theme.textPrimary)
                        .lineLimit(2)
                        .multilineTextAlignment(.center)
                    if access.editable {
                        Image(systemName: "pencil")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Theme.textSecondary)
                    }
                }
            }
            .buttonStyle(.plain)
            .disabled(!access.editable)
            .accessibilityIdentifier("room-info-name")
            .accessibilityHint(access.editable ? Text(String(localized: "Rename group chat")) : Text(verbatim: ""))
            Text(members.count == 1 ? String(localized: "1 bot") : String(localized: "\(members.count) bots"))
                .font(.system(size: 13))
                .foregroundStyle(Theme.textSecondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 6)
    }

    private func row(_ title: String, systemImage: String, value: String) -> some View {
        HStack(spacing: 12) {
            Label(title, systemImage: systemImage)
                .foregroundStyle(Theme.textPrimary)
            Spacer(minLength: 8)
            if !value.isEmpty {
                Text(verbatim: value)
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(1)
            }
        }
    }
}

/// Who answers a plain message (DefaultResponderSelect, RM19): the owner's,
/// in the desktop's Advanced tab.
struct RoomResponderSection: View {
    let room: Room
    let jevOn: Bool
    @EnvironmentObject private var session: Session

    var body: some View {
        let members = room.memberIds.compactMap { session.state.bot($0) }
        let selection = Binding<RoomResponder.Choice>(
            get: { RoomResponder.choice(room) },
            set: { choice in
                let next = RoomResponder.value(for: choice, in: room)
                guard next != room.defaultResponder else { return }
                Task { await session.patchRoom(room, RoomPatch(defaultResponder: next)) }
            }
        )
        Section {
            Picker(String(localized: "Default responder"), selection: selection) {
                Section(String(localized: "Group lead")) {
                    ForEach(members) { bot in
                        Text(String(localized: "Lead: \(bot.name)")).tag(RoomResponder.Choice.lead(botId: bot.id))
                    }
                }
                Section(String(localized: "Group behavior")) {
                    Text(jevOn ? String(localized: "Auto (Jev)") : String(localized: "Auto")).tag(RoomResponder.Choice.auto)
                    Text(String(localized: "Everyone responds")).tag(RoomResponder.Choice.everyone)
                    Text(String(localized: "Only when mentioned")).tag(RoomResponder.Choice.mentions)
                }
            }
            .pickerStyle(.menu)
            .accessibilityIdentifier("room-responder")
        } header: {
            Text(String(localized: "Default responder"))
        } footer: {
            Text(explanation(members: members))
        }
    }

    /// The select's title on the desktop: what a plain message does.
    private func explanation(members: [Bot]) -> String {
        let lead = RoomResponder.answeringBotId(room).flatMap { id in members.first { $0.id == id }?.name }
            ?? String(localized: "the lead bot")
        switch RoomResponder.choice(room) {
        case .everyone: return String(localized: "Plain messages go to every group member; @mentions override this")
        case .mentions: return String(localized: "Only explicitly @mentioned bots respond")
        case .auto:
            return jevOn
                ? String(localized: "Jev picks who answers each plain message; @mentions override this")
                : String(localized: "Jev is off, so plain messages go to \(lead); @mentions override this")
        case .lead: return String(localized: "Plain messages go to \(lead); @mentions override this")
        }
    }
}

/// The desktop panel's tabs (GroupPanel.tsx `GROUP_PANEL_TABS`): Memory for
/// a pairing that reaches it, Advanced off the remote client.
enum RoomInfoTab: String, Hashable, CaseIterable {
    case details, instructions, memory, advanced

    var title: String {
        switch self {
        case .details: String(localized: "Details")
        case .instructions: String(localized: "Instructions")
        case .memory: String(localized: "Memory")
        case .advanced: String(localized: "Advanced")
        }
    }

    static func available(access: RoomInfoAccess, gate: SurfaceGate) -> [RoomInfoTab] {
        var tabs: [RoomInfoTab] = [.details, .instructions]
        if access.memory { tabs.append(.memory) }
        if access.manages, gate.scope != .sidecar { tabs.append(.advanced) }
        return tabs
    }
}

/// Working folder (`RoomWorkingFolder`): where every bot in the group runs
/// its shell and file tools. Fixed once the room pinned it on a first turn.
struct RoomFolderSection: View {
    let room: Room
    let editable: Bool
    @EnvironmentObject private var session: Session
    @State private var draft: String?
    @State private var saving = false

    var body: some View {
        let locked = room.pinnedCwd != nil
        Section {
            if locked || !editable {
                Text(verbatim: (locked ? room.pinnedCwd : room.cwd) ?? String(localized: "Each bot’s own folder"))
                    .font(.footnote.monospaced())
                    .foregroundStyle(Theme.textSecondary)
                    .accessibilityIdentifier("room-folder-value")
            } else {
                TextField(String(localized: "Each bot’s own folder, or an absolute path"), text: Binding(
                    get: { draft ?? room.cwd ?? "" },
                    set: { draft = $0 }
                ))
                .font(.footnote.monospaced())
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.done)
                .onSubmit(save)
                .accessibilityIdentifier("room-folder-field")
                Button(String(localized: "Save"), action: save)
                    .disabled(saving || draft == nil)
                    .accessibilityIdentifier("room-folder-save")
            }
        } header: {
            Text(String(localized: "Working folder"))
        } footer: {
            Text(locked
                 ? String(localized: "Fixed for this thread after its first turn. Start a new thread to work somewhere else.")
                 : String(localized: "Where every bot in this group runs its shell and file tools."))
        }
    }

    private func save() {
        guard let value = draft else { return }
        saving = true
        Task {
            if await session.setRoomFolder(room, cwd: value) { draft = nil }
            saving = false
        }
    }
}
