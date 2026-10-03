// "Message a person" (matrix RM22; ComposeToPicker.tsx person rows): the
// organization's active people the viewer may write to, searched by name,
// login or address. Choosing one opens the direct conversation with them,
// made on first use (`POST /api/people-dms`).
import CompanionCore
import SwiftUI

struct MessagePersonSheet: View {
    @Environment(\.themePalette) var themePalette
    var openChat: (Chat) -> Void
    @EnvironmentObject private var session: Session
    @ObservedObject private var people = PeopleDirectory.shared
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    var body: some View {
        NavigationStack {
            let rows = people.directory?.messageable(viewer: session.roomViewer.actorId, query: query) ?? []
            ThemedList {
                Section {
                    ForEach(rows) { person in
                        Button {
                            Task {
                                if let chat = await people.openConversation(with: person.principalId, session: session) {
                                    openChat(chat)
                                }
                            }
                        } label: {
                            HStack(spacing: 12) {
                                let label = People.label(person, fallback: person.principalId)
                                PersonAvatar(initials: People.initials(label), size: 28)
                                Text(verbatim: label)
                                    .foregroundStyle(Theme.textPrimary)
                                    .lineLimit(1)
                                Spacer(minLength: 8)
                                Text(String(localized: "Direct message"))
                                    .font(.footnote)
                                    .foregroundStyle(Theme.textSecondary)
                            }
                        }
                        .disabled(people.opening)
                        .accessibilityIdentifier("compose-person-\(person.principalId)")
                    }
                    if rows.isEmpty, people.directory != nil {
                        Text(query.isEmpty
                            ? String(localized: "Nobody to write to yet.")
                            : String(localized: "Nothing matches \u{201C}\(query)\u{201D}"))
                            .font(.footnote)
                            .foregroundStyle(Theme.textSecondary)
                    }
                }
            }
            .overlay {
                if people.directory == nil { ProgressView() }
            }
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always))
            .navigationTitle(String(localized: "Message a person"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(String(localized: "Cancel")) { dismiss() }
                }
            }
            .task(id: session.connection?.id) { await people.load(session) }
        }
    }
}
