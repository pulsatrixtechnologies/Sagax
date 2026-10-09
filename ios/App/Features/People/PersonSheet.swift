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
    @State private var card: PublicAchievementCard?
    @State private var editingLabel = false
    @State private var labelDraft = ""
    @State private var labelError: String?

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

    /// PersonPanel.tsx's header (#219): the name, then their title and
    /// points, then their label (editable by them, an admin or their team's
    /// manager), the role line only for an admin or a disabled account, then
    /// Message and Close conversation.
    private func header(_ model: PersonSheetModel) -> some View {
        VStack(spacing: 6) {
            PersonAvatar(initials: model.initials, size: 88, presenceId: personId)
            Text(verbatim: model.name)
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(Theme.textPrimary)
                .lineLimit(1)
                .accessibilityIdentifier("person-name")
            if let entry = people.presence.entry(personId) {
                Text(verbatim: PresenceDot.words(entry))
                    .font(.footnote)
                    .foregroundStyle(Theme.textSecondary)
                    .accessibilityIdentifier("person-presence")
            }
            if let line = memberLine {
                Text(verbatim: line)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(1)
                    .accessibilityIdentifier("person-member-line")
            }
            labelLine
            if let person = model.person, let role = roleLine(person) {
                Text(verbatim: role)
                    .font(.footnote)
                    .foregroundStyle(Theme.textSecondary)
                    .accessibilityIdentifier("person-role")
            }
            HStack(spacing: 10) {
                if model.canMessage, let person = model.person {
                    Button {
                        Task {
                            if let chat = await people.openConversation(with: person.principalId, session: session) {
                                if case let .room(room) = chat { sidebarPrefs.reopenIfClosed(session, room: room) }
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
                // #219: an open conversation closes; a closed one only
                // offers Message
                if let room = model.directRoom,
                   !sidebarPrefs.prefs.hidden.keys.contains(SidebarHidden.groupKey(room, viewerId: session.roomViewer.actorId)) {
                    Button {
                        sidebarPrefs.hide(session, room: room)
                    } label: {
                        Label(String(localized: "Close conversation"), systemImage: "xmark")
                    }
                    .buttonStyle(.bordered)
                    .tint(Theme.textPrimary)
                    .accessibilityIdentifier("person-close-conversation")
                }
            }
            .padding(.top, 10)
        }
        .frame(maxWidth: .infinity)
        .task(id: personId) {
            card = nil
            card = try? await session.settingsClient?.publicAchievementCard(principalId: personId)
        }
    }

    /// Title, then points, as their public card carries them.
    private var memberLine: String? {
        guard let card else { return nil }
        var parts: [String] = []
        if let title = card.titleName { parts.append(title.resolved(AchievementLanguage.current ?? Locale.current.language.languageCode?.identifier)) }
        if let points = card.points {
            let formatter = NumberFormatter()
            formatter.numberStyle = .decimal
            parts.append(String(localized: "\(formatter.string(from: NSNumber(value: points)) ?? String(points)) points"))
        }
        return parts.isEmpty ? nil : parts.joined(separator: "  ·  ")
    }

    /// The label under the name, as under a bot's name in its panel.
    @ViewBuilder
    private var labelLine: some View {
        let label = people.label(personId)
        if people.canEditLabel(personId, session: session) {
            Button {
                labelDraft = label ?? ""
                editingLabel = true
            } label: {
                Text(verbatim: label ?? String(localized: "Add a label"))
                    .font(.system(size: 12.5))
                    .foregroundStyle(Theme.textSecondary)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(String(localized: "Edit the label")))
            .accessibilityValue(Text(verbatim: label ?? ""))
            .accessibilityIdentifier("person-label-edit")
            .alert(String(localized: "Label"), isPresented: $editingLabel) {
                TextField(String(localized: "Add a label"), text: $labelDraft)
                Button(String(localized: "Cancel"), role: .cancel) {}
                Button(String(localized: "Save")) {
                    let text = labelDraft
                    Task {
                        if let problem = await people.saveLabel(personId, text, session: session) { labelError = problem }
                    }
                }
            } message: {
                Text(String(localized: "Shown beside the name, like a bot's label. 40 characters at most."))
            }
            .alert(String(localized: "Label"), isPresented: Binding(get: { labelError != nil }, set: { if !$0 { labelError = nil } })) {
                Button(String(localized: "OK"), role: .cancel) {}
            } message: {
                Text(verbatim: labelError ?? "")
            }
        } else if let label {
            Text(verbatim: label)
                .font(.system(size: 12.5))
                .foregroundStyle(Theme.textSecondary)
                .accessibilityIdentifier("person-label")
        }
    }

    /// "Member" is not shown (#219): only an admin or a disabled account.
    private func roleLine(_ person: OrgDirectoryPerson) -> String? {
        let admin = person.role == "admin"
        let disabled = person.disabled == true
        switch (admin, disabled) {
        case (true, true): return "\(String(localized: "Administrator")) · \(String(localized: "Disabled"))"
        case (true, false): return String(localized: "Administrator")
        case (false, true): return String(localized: "Disabled")
        case (false, false): return nil
        }
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
        .accessibilityElement(children: .combine)
    }
}
