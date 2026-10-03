// Room info (matrix RM6, RM7, RM8, RM14-RM19; GroupPanel.tsx): the room's
// faces, name and bot count, then what the desktop panel's tabs hold —
// Details (people, bots, leave), Instructions, Memory, Advanced (who
// answers) — as rows, plus the threads row that used to be the header's
// tap. Owner items follow `RoomInfoAccess` and are never drawn disabled.
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

            Section {
                Button(action: openThreads) {
                    row(String(localized: "Threads"), systemImage: "square.stack", value: "\(room.tasks?.count ?? 1)")
                }
                .accessibilityIdentifier("room-threads")
                NavigationLink {
                    RoomInstructionsView(roomId: roomId, editable: access.editable)
                } label: {
                    row(String(localized: "Instructions"), systemImage: "text.alignleft",
                        value: room.bulletin.split(separator: "\n").first.map(String.init) ?? "")
                }
                .accessibilityIdentifier("room-instructions")
                if access.memory {
                    NavigationLink {
                        RoomMemoryView(room: room)
                    } label: {
                        row(String(localized: "Memory"), systemImage: "brain", value: "")
                    }
                    .accessibilityIdentifier("room-memory")
                }
            }

            RoomPeopleSection(
                room: room, access: access, directory: directory,
                pickPeople: { pickingPeople = true },
                addEmail: { emailDraft = ""; addingEmail = true }
            )
            RoomBotsSection(room: room, access: access, manageMembers: { managingMembers = true })

            if access.editable {
                RoomResponderSection(room: room, jevOn: jevOn)
            }

            Section {
                if access.canMoveSection {
                    NavigationLink {
                        RoomSectionPicker(roomId: roomId, actions: actions)
                    } label: {
                        row(String(localized: "Move to section"), systemImage: "folder", value: room.section ?? "")
                    }
                    .accessibilityIdentifier("room-section")
                }
                Button {
                    actions.copyConversationId(room)
                } label: {
                    Label(String(localized: "Copy conversation ID"), systemImage: "doc.on.clipboard")
                }
                .accessibilityIdentifier("room-copy-id")
            }
            .foregroundStyle(Theme.textPrimary)

            if access.canLeave || access.canDelete {
                Section {
                    if access.canLeave {
                        Button(String(localized: "Leave group"), role: .destructive) {
                            Task {
                                await session.patchRoom(room, RoomPatch(humanIds: RoomOwnership.humanIdsLeaving(room, viewer: session.roomViewer)))
                            }
                        }
                        .accessibilityIdentifier("room-leave")
                    }
                    if access.canDelete {
                        Button(String(localized: "Delete group chat"), role: .destructive) { actions.deleting = room }
                            .accessibilityIdentifier("room-delete")
                    }
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
