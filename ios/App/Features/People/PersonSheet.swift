// The person sheet (matrix RM21; PersonPanel.tsx): someone of the
// organization as the directory knows them, the groups the viewer shares
// with them, their bots shared with the viewer, and what the viewer may do:
// write to them, hide or show their conversation in the sidebar, and for
// an organization admin, their page in the Perspicax console. Nothing from
// a private thread shows here.
//
// `PersonSheetContent` is presentation-free so the iPad shell can dock it
// as the desktop's right panel; the phone wraps it in a sheet.
import CompanionCore
import SwiftUI

struct PersonSheet: View {
    let personId: String
    var openChat: (Chat) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            PersonSheetContent(personId: personId, openChat: openChat)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button(String(localized: "Close")) { dismiss() }
                            .accessibilityIdentifier("person-close")
                    }
                }
        }
    }
}

struct PersonSheetContent: View {
    @Environment(\.themePalette) var themePalette
    let personId: String
    var openChat: (Chat) -> Void
    @EnvironmentObject private var session: Session
    @ObservedObject private var people = PeopleDirectory.shared
    @ObservedObject private var sidebarPrefs = SidebarPrefsModel.shared
    @Environment(\.openURL) private var openURL

    private var model: PersonSheetModel {
        PersonSheetModel(
            personId: personId, directory: people.directory, state: session.state,
            viewerId: session.roomViewer.actorId, viewerIsAdmin: people.viewerIsAdmin
        )
    }

    var body: some View {
        let model = self.model
        ThemedList {
            Section {
                header(model)
                    .listRowBackground(Color.clear)
            }
            if model.person == nil, people.directory != nil {
                Section {
                    Text(String(localized: "This person is not in your organization's directory."))
                        .font(.footnote)
                        .foregroundStyle(Theme.textSecondary)
                        .accessibilityIdentifier("person-not-in-directory")
                }
            }
            if let person = model.person {
                Section {
                    if let email = person.email, !email.isEmpty {
                        field(String(localized: "Email"), email)
                    }
                    if !person.login.isEmpty, person.login != person.email {
                        field(String(localized: "Login"), person.login)
                    }
                    field(
                        String(localized: "Teams"),
                        model.teams.isEmpty
                            ? String(localized: "None")
                            : model.teams.map { $0.manager ? String(localized: "\($0.name) (manager)") : $0.name }.joined(separator: ", "),
                        dim: model.teams.isEmpty
                    )
                    .accessibilityIdentifier("person-teams")
                }
            }
            Section {
                if model.sharedRooms.isEmpty {
                    Text(String(localized: "No group in common."))
                        .font(.footnote)
                        .foregroundStyle(Theme.textSecondary)
                } else {
                    ForEach(model.sharedRooms) { room in
                        Button { openChat(.room(room)) } label: {
                            Label(room.name, systemImage: "person.2")
                                .foregroundStyle(Theme.textPrimary)
                        }
                        .accessibilityIdentifier("person-group-\(room.id)")
                    }
                }
            } header: {
                Text(String(localized: "Groups in common"))
            }
            Section {
                if model.sharedBots.isEmpty {
                    Text(String(localized: "None of their bots is shared with you."))
                        .font(.footnote)
                        .foregroundStyle(Theme.textSecondary)
                } else {
                    ForEach(model.sharedBots) { bot in
                        Button { openChat(.bot(bot)) } label: {
                            HStack(spacing: 10) {
                                BotMascotView(bot: bot, size: 24)
                                    .frame(width: 24, height: 24)
                                Text(verbatim: bot.name)
                                    .foregroundStyle(Theme.textPrimary)
                                    .lineLimit(1)
                                Spacer(minLength: 8)
                                if !bot.title.isEmpty {
                                    Text(verbatim: bot.title)
                                        .font(.footnote)
                                        .foregroundStyle(Theme.textSecondary)
                                        .lineLimit(1)
                                }
                            }
                        }
                        .accessibilityIdentifier("person-bot-\(bot.id)")
                    }
                }
            } header: {
                Text(String(localized: "Their bots shared with you"))
            }
            if let url = model.manageURL {
                Section {
                    Button { openURL(url) } label: {
                        Label(String(localized: "Manage in Perspicax"), systemImage: "arrow.up.right.square")
                    }
                    .accessibilityIdentifier("person-manage")
                }
            }
        }
        .task(id: session.connection?.id) { await people.load(session) }
    }

    private func header(_ model: PersonSheetModel) -> some View {
        VStack(spacing: 6) {
            PersonAvatar(initials: model.initials, size: 88)
            Text(verbatim: model.name)
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(Theme.textPrimary)
                .lineLimit(1)
                .accessibilityIdentifier("person-name")
            if let person = model.person {
                Text(verbatim: roleLine(person))
                    .font(.footnote)
                    .foregroundStyle(Theme.textSecondary)
                    .accessibilityIdentifier("person-role")
            }
            HStack(spacing: 10) {
                if model.canMessage, let person = model.person {
                    Button {
                        Task {
                            if let chat = await people.openConversation(with: person.principalId, session: session) {
                                openChat(chat)
                            }
                        }
                    } label: {
                        Label(String(localized: "Message"), systemImage: "bubble.left")
                    }
                    .buttonStyle(.bordered)
                    .tint(Theme.textPrimary)
                    .disabled(people.opening)
                    .accessibilityIdentifier("person-message")
                }
                if let room = model.directRoom {
                    let key = SidebarHidden.groupKey(room, viewerId: session.roomViewer.actorId)
                    let hidden = sidebarPrefs.prefs.hidden.keys.contains(key)
                    Button {
                        if hidden { sidebarPrefs.show(session, [key]) } else { sidebarPrefs.hide(session, room: room) }
                    } label: {
                        Label(
                            hidden ? String(localized: "Show") : String(localized: "Hide from sidebar"),
                            systemImage: hidden ? "eye" : "eye.slash"
                        )
                    }
                    .buttonStyle(.bordered)
                    .tint(Theme.textPrimary)
                    .accessibilityIdentifier(hidden ? "person-show" : "person-hide")
                }
            }
            .padding(.top, 10)
        }
        .frame(maxWidth: .infinity)
    }

    private func roleLine(_ person: OrgDirectoryPerson) -> String {
        let role = person.role == "admin" ? String(localized: "Administrator") : String(localized: "Member")
        return person.disabled == true ? "\(role) · \(String(localized: "Disabled"))" : role
    }

    private func field(_ label: String, _ value: String, dim: Bool = false) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(verbatim: label)
                .foregroundStyle(Theme.textSecondary)
            Spacer(minLength: 8)
            Text(verbatim: value)
                .foregroundStyle(dim ? Theme.textSecondary : Theme.textPrimary)
                .multilineTextAlignment(.trailing)
                .textSelection(.enabled)
        }
        .font(.subheadline)
    }
}
