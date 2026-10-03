// The name above another person's lines in a group chat (matrix RM21;
// GroupView.tsx `RoomPersonLabel`, src/lib/room-authors.ts): their face and
// directory name once per run, and for a person of the directory, a tap
// opens their sheet. Organization servers only (`SurfaceGate.people`); the
// bubbles keep the phone's sides, so the reference screens do not move.
import CompanionCore
import SwiftUI

struct RoomPersonLabel: View {
    @Environment(\.themePalette) var themePalette
    let name: String
    let initials: String
    let personId: String?

    var body: some View {
        let face = HStack(spacing: 6) {
            PersonAvatar(initials: initials, size: 20)
            Text(verbatim: name)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Theme.textSecondary)
                .lineLimit(1)
        }
        Group {
            if let personId {
                Button {
                    PeopleDirectory.shared.showPerson(personId)
                } label: { face }
                .buttonStyle(.plain)
                .accessibilityHint(Text(String(localized: "View \(name)'s profile")))
                .accessibilityIdentifier("room-person-\(personId)")
            } else {
                face
                    .accessibilityIdentifier("room-person")
            }
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
        .padding(.bottom, 4)
    }
}

extension ChatView {
    /// The person label row `index` opens with, or nil: another person's
    /// first line of a run in a room, on an organization server.
    func roomPersonLabel(at index: Int, in rows: [TranscriptRow]) -> RoomAuthor? {
        guard case .room = current, session.surfaceGate.allows(.people),
              case let .message(message) = rows[index] else { return nil }
        let viewer = session.roomViewer
        let directory = PeopleDirectory.shared.directory
        let author = RoomAuthor.of(message, viewer: viewer, directory: directory)
        guard case .person = author else { return nil }
        var previous: (at: Double, author: RoomAuthor)?
        if index > 0 {
            let row = rows[index - 1]
            if case let .message(prior) = row, prior.comm == nil {
                previous = (prior.at, RoomAuthor.of(prior, viewer: viewer, directory: directory))
            } else {
                previous = (row.endAt, .none)
            }
        }
        return RoomAuthor.continuesRun(previous: previous, next: (message.at, author)) ? nil : author
    }
}
