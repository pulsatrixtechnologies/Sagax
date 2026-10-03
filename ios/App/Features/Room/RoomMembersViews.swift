// A room's people and bots (matrix RM6, RM18; ChannelMembers.tsx,
// ManageMembersPanel.tsx, GroupPeoplePicker.tsx): who is in it, and for
// the pairings that manage rooms, adding and removing them. The owner
// removes anyone and edits the roster; a member brings their own bots in
// and takes them out (server/group-ownership.ts).
import CompanionCore
import SwiftUI

struct RoomPeopleSection: View {
    let room: Room
    let access: RoomInfoAccess
    let directory: OrgDirectory?
    var pickPeople: () -> Void
    var addEmail: () -> Void
    @EnvironmentObject private var session: Session

    private struct Person: Identifiable {
        let id: String
        let label: String
        let detail: String?
        let removable: Bool
    }

    private var people: [Person] {
        let viewer = session.roomViewer
        let email = viewer.normalizedEmail
        let name = session.account?.name?.trimmingCharacters(in: .whitespacesAndNewlines)
        let me = (name?.isEmpty == false ? name : nil) ?? email ?? String(localized: "You")
        var out = [Person(id: viewer.actorId, label: me, detail: email != me ? email : nil, removable: false)]
        for raw in room.humanIds ?? [] {
            let id = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            guard !id.isEmpty, id != viewer.actorId, id != email else { continue }
            out.append(Person(id: id, label: directory?.label(for: id) ?? id, detail: nil, removable: access.canRemoveHumans))
        }
        return out
    }

    var body: some View {
        Section {
            ForEach(people) { person in
                HStack(spacing: 12) {
                    Text(verbatim: initials(person.label))
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.textPrimary)
                        .frame(width: 32, height: 32)
                        .background(Theme.inset, in: Circle())
                    VStack(alignment: .leading, spacing: 1) {
                        Text(verbatim: person.label)
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(Theme.textPrimary)
                            .lineLimit(1)
                        if let detail = person.detail {
                            Text(verbatim: detail)
                                .font(.system(size: 12))
                                .foregroundStyle(Theme.textSecondary)
                                .lineLimit(1)
                        }
                    }
                    Spacer(minLength: 0)
                    if person.removable {
                        Button {
                            Task { await session.patchRoom(room, RoomPatch(humanIds: RoomOwnership.humanIdsRemoving(person.id, from: room))) }
                        } label: {
                            Image(systemName: "xmark")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(Theme.textSecondary)
                                .frame(width: 32, height: 32)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text(String(localized: "Remove \(person.label)")))
                        .accessibilityIdentifier("room-remove-person-\(person.id)")
                    }
                }
            }
            if access.canAddHuman {
                Button {
                    if access.organization { pickPeople() } else { addEmail() }
                } label: {
                    Label(String(localized: "Add"), systemImage: "plus")
                }
                .accessibilityIdentifier("room-add-person")
            }
        } header: {
            Text(String(localized: "People"))
        }
    }

    private func initials(_ label: String) -> String {
        let parts = label.split(whereSeparator: { " @._-".contains($0) })
        let letters = String(parts.first?.prefix(1) ?? "") + String(parts.dropFirst().first?.prefix(1) ?? "")
        return (letters.isEmpty ? String(label.prefix(2)) : letters).uppercased()
    }
}

struct RoomBotsSection: View {
    let room: Room
    let access: RoomInfoAccess
    var manageMembers: () -> Void
    @EnvironmentObject private var session: Session

    var body: some View {
        Section {
            ForEach(room.memberIds, id: \.self) { id in
                let bot = session.state.bot(id)
                HStack(spacing: 12) {
                    if let bot {
                        BotMascotView(bot: bot, size: 32)
                            .frame(width: 32, height: 32)
                    } else {
                        Circle().fill(Theme.inset).frame(width: 32, height: 32)
                    }
                    VStack(alignment: .leading, spacing: 1) {
                        Text(verbatim: bot?.name ?? id)
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(Theme.textPrimary)
                            .lineLimit(1)
                        if let title = bot?.title, !title.isEmpty {
                            Text(verbatim: title)
                                .font(.system(size: 12))
                                .foregroundStyle(Theme.textSecondary)
                                .lineLimit(1)
                        }
                    }
                    Spacer(minLength: 0)
                    if access.removableBotIds.contains(id) {
                        Button {
                            Task { await session.patchRoom(room, RoomPatch(memberIds: room.memberIds.filter { $0 != id })) }
                        } label: {
                            Image(systemName: "xmark")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(Theme.textSecondary)
                                .frame(width: 32, height: 32)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text(String(localized: "Remove \(bot?.name ?? id)")))
                        .accessibilityIdentifier("room-remove-bot-\(id)")
                    }
                }
            }
            if access.canAddOwnBot {
                Button {
                    guard let own = RoomOwnership.ownBotToAdd(room, bots: session.state.bots, viewer: session.roomViewer) else { return }
                    Task { await session.patchRoom(room, RoomPatch(memberIds: room.memberIds + [own.id])) }
                } label: {
                    Label(access.owns ? String(localized: "Add") : String(localized: "Add my bot"), systemImage: "plus")
                }
                .accessibilityIdentifier("room-add-own-bot")
            }
            if access.editable {
                Button(String(localized: "Manage members"), action: manageMembers)
                    .accessibilityIdentifier("room-manage-members")
            }
        } header: {
            Text(String(localized: "Bots"))
        }
    }
}

/// The roster editor (ManageMembersPanel): the bots, ticked for who is in.
/// Archived bots stay listed while they are still members.
struct RoomManageMembersSheet: View {
    @Environment(\.themePalette) var themePalette
    let room: Room
    @EnvironmentObject private var session: Session
    @Environment(\.dismiss) private var dismiss
    @State private var picked: Set<String>
    @State private var saveError: String?
    @State private var saving = false

    init(room: Room) {
        self.room = room
        _picked = State(initialValue: Set(room.memberIds))
    }

    private var bots: [Bot] {
        session.state.bots.filter { $0.hidden != true || room.memberIds.contains($0.id) }
    }

    private var memberIds: [String] {
        RoomOwnership.nextMemberIds(current: room.memberIds, picked: picked, order: bots.map(\.id))
    }

    var body: some View {
        NavigationStack {
            ThemedList {
                Section {
                    if bots.isEmpty {
                        Text(String(localized: "Create a bot first: groups are made of bots."))
                            .foregroundStyle(Theme.textSecondary)
                    }
                    ForEach(bots) { bot in
                        Button {
                            if picked.contains(bot.id) { picked.remove(bot.id) } else { picked.insert(bot.id) }
                        } label: {
                            HStack(spacing: 12) {
                                BotMascotView(bot: bot, size: 32).frame(width: 32, height: 32)
                                Text(verbatim: bot.name).foregroundStyle(Theme.textPrimary)
                                Spacer(minLength: 0)
                                Image(systemName: picked.contains(bot.id) ? "checkmark.circle.fill" : "circle")
                                    .foregroundStyle(picked.contains(bot.id) ? Theme.accent : Theme.textTertiary)
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(picked.contains(bot.id) ? .isSelected : [])
                        .accessibilityValue(Text(verbatim: picked.contains(bot.id) ? "on" : "off"))
                        .accessibilityIdentifier("room-pick-\(bot.id)")
                    }
                } header: {
                    Text(verbatim: room.name)
                } footer: {
                    if memberIds.isEmpty {
                        Text(String(localized: "A group needs at least one bot."))
                    } else if let saveError {
                        Text(verbatim: saveError).foregroundStyle(Theme.danger)
                    }
                }
            }
            .navigationTitle(String(localized: "Manage members"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(String(localized: "Cancel")) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saveTitle) { save() }
                        .disabled(memberIds.isEmpty || saving)
                        .accessibilityIdentifier("room-members-save")
                }
            }
        }
    }

    private var saveTitle: String {
        let count = memberIds.count
        if count == 0 { return String(localized: "Save") }
        return count == 1 ? String(localized: "Save · 1 bot") : String(localized: "Save · \(count) bots")
    }

    private func save() {
        guard !memberIds.isEmpty else { return }
        let live = session.state.rooms.first { $0.id == room.id }?.memberIds ?? room.memberIds
        guard live == room.memberIds else {
            saveError = String(localized: "This group's members changed while the panel was open. Close it and try again.")
            return
        }
        guard memberIds != room.memberIds else { dismiss(); return }
        saving = true
        Task {
            let kept = await session.patchRoom(room, RoomPatch(memberIds: memberIds))
            saving = false
            if kept { dismiss() } else { saveError = session.actionError }
        }
    }
}

/// The organization's people picker (GroupPeoplePicker): anyone active in
/// the directory, added by principal id.
struct RoomPeoplePickerSheet: View {
    @Environment(\.themePalette) var themePalette
    let roomId: String
    let directory: OrgDirectory?
    @EnvironmentObject private var session: Session
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    var body: some View {
        let room = session.state.rooms.first { $0.id == roomId }
        let taken = [session.roomViewer.actorId] + (room?.humanIds ?? [])
        let candidates = directory?.candidates(taken: taken, query: query) ?? []
        NavigationStack {
            ThemedList {
                if directory != nil, candidates.isEmpty {
                    Text(String(localized: "No one to add"))
                        .foregroundStyle(Theme.textSecondary)
                }
                ForEach(candidates) { person in
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(verbatim: person.name.isEmpty ? person.login : person.name)
                                .foregroundStyle(Theme.textPrimary)
                            if !person.name.isEmpty, !person.login.isEmpty {
                                Text(verbatim: person.login)
                                    .font(.system(size: 12))
                                    .foregroundStyle(Theme.textSecondary)
                            }
                        }
                        Spacer(minLength: 0)
                        Button(String(localized: "Add")) {
                            guard let room else { return }
                            query = ""
                            Task { await session.patchRoom(room, RoomPatch(humanIds: RoomOwnership.humanIdsAdding(person.principalId, to: room))) }
                        }
                        .buttonStyle(.borderedProminent)
                        .accessibilityIdentifier("room-add-\(person.principalId)")
                    }
                }
            }
            .searchable(text: $query, prompt: Text(String(localized: "Search people")))
            .navigationTitle(String(localized: "Add people"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(String(localized: "Done")) { dismiss() }
                }
            }
        }
    }
}
