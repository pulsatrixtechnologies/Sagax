// The organization's people, for everything WP15 draws about them (matrix
// RM21, RM22): the directory asked once per pairing (`useOrgPeople`), the
// person sheet's presentation, and opening the direct conversation with
// someone (store.tsx `openPeopleDm`). Organization servers only: on any
// other pairing the directory stays empty and nothing here is drawn.
import CompanionCore
import SwiftUI

@MainActor
final class PeopleDirectory: ObservableObject {
    static let shared = PeopleDirectory()

    /// Nil until it answers, or off an organization server.
    @Published private(set) var directory: OrgDirectory?
    /// The console's admin role (`GET /api/org` `viewerRole`), for "Manage
    /// in Perspicax".
    @Published private(set) var viewerIsAdmin = false
    /// The person whose sheet is open, wherever it was asked for.
    @Published var sheetPersonId: String?
    @Published var opening = false
    private var loadedFor: String?

    /// `loadOrgPeople`: once per pairing; `force` asks again.
    func load(_ session: Session, force: Bool = false) async {
        guard session.surfaceGate.allows(.people), let connection = session.connection else {
            directory = nil
            loadedFor = nil
            return
        }
        guard force || loadedFor != connection.id || directory == nil else { return }
        loadedFor = connection.id
        directory = await session.orgDirectory()
        if let client = session.settingsClient {
            viewerIsAdmin = (try? await client.organization())?.isAdmin ?? false
        }
    }

    /// A people-only conversation as the viewer reads it: the other person.
    func peer(_ room: Room, session: Session) -> PeopleDMPeer? {
        room.peopleDMPeer(viewerId: session.roomViewer.actorId, directory: directory)
    }

    /// How a chat is named on the home and in its header: a people-only
    /// conversation by the other person, everything else as before.
    func name(_ chat: Chat, session: Session) -> String {
        if case let .room(room) = chat, let peer = peer(room, session: session) { return peer.name }
        return chat.name
    }

    func showPerson(_ id: String) {
        Haptics.selection()
        sheetPersonId = id
    }

    /// `openPeopleDm`: the conversation that exists, else a new one.
    func openConversation(with principalId: String, session: Session) async -> Chat? {
        if let room = session.state.rooms.first(where: { room in
            room.peopleDm == true && (room.humanIds ?? []).contains { $0.lowercased() == principalId.lowercased() }
        }) {
            return .room(room)
        }
        guard let client = session.settingsClient else { return nil }
        opening = true
        defer { opening = false }
        do {
            let room = try await client.openPeopleDM(principalId: principalId)
            session.applyRoom(room)
            return .room(room)
        } catch {
            session.actionError = error.localizedDescription
            return nil
        }
    }
}

/// A person's round face: their initials on the inset surface (the
/// desktop's `InitialsAvatar`; a Perspicax picture needs the session's
/// bearer and is not fetched yet).
struct PersonAvatar: View {
    @Environment(\.themePalette) var themePalette
    let initials: String
    var size: CGFloat = 28

    var body: some View {
        Text(verbatim: initials)
            .font(.system(size: size * 0.4, weight: .semibold))
            .foregroundStyle(Theme.textPrimary)
            .frame(width: size, height: size)
            .background(Theme.inset, in: Circle())
            .accessibilityHidden(true)
    }
}

extension View {
    /// Mounts the person sheet once per host.
    func personSheetPresenter(onOpenChat: @escaping (Chat) -> Void) -> some View {
        modifier(PersonSheetPresenter(onOpenChat: onOpenChat))
    }
}

private struct PersonSheetPresenter: ViewModifier {
    let onOpenChat: (Chat) -> Void
    @ObservedObject private var people = PeopleDirectory.shared

    func body(content: Content) -> some View {
        content.sheet(item: Binding(
            get: { people.sheetPersonId.map(PersonRef.init) },
            set: { people.sheetPersonId = $0?.id }
        )) { ref in
            PersonSheet(personId: ref.id) { chat in
                people.sheetPersonId = nil
                onOpenChat(chat)
            }
        }
    }
}

private struct PersonRef: Identifiable {
    let id: String
}
