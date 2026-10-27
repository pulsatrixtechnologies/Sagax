// New Group Chat (reference 17): a full-height sheet 62 pt from the top with
// an X, the title and a "Next" capsule that stays grey until two members are
// picked. A "To:" token field filters the bots below it (32 pt mascot and
// name on a 54 pt pitch); picked bots become tokens. On an organization
// server the organization's people follow the bots, and a group may hold
// people only, with no bot (#1150). "Next" leads to a name
// step, then the room is made with `createRoom`. The server names it after
// the first member if the name is left blank, as the desktop's dialog does.
import SwiftUI
import CompanionCore

struct NewGroupSheet: View {
    @Environment(\.themePalette) var themePalette
    let close: () -> Void
    let created: (Room) -> Void

    @EnvironmentObject private var session: Session
    @State private var query = ""
    @State private var picked: [String] = []
    @State private var pickedPeople: [String] = []
    @ObservedObject private var directory = PeopleDirectory.shared
    @State private var step: Step = .members
    @State private var name = ""
    @State private var creating = false
    @FocusState private var focus: Field?

    private enum Step { case members, name }
    private enum Field { case search, name }

    static let minimumMembers = 2

    private var bots: [Bot] {
        session.state.bots.filter { $0.hidden != true }
    }

    private var listed: [Bot] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { return bots }
        return bots.filter { $0.name.localizedCaseInsensitiveContains(q) || $0.title.localizedCaseInsensitiveContains(q) }
    }

    private var pickedBots: [Bot] { picked.compactMap { session.state.bot($0) } }

    /// The people one may add: the directory on an organization server.
    private var people: [OrgDirectoryPerson] {
        guard session.surfaceGate.allows(.people) else { return [] }
        return directory.directory?.messageable(viewer: session.roomViewer.actorId, query: query) ?? []
    }

    private var pickedPeopleRows: [OrgDirectoryPerson] {
        pickedPeople.compactMap { directory.directory?.person($0) }
    }

    private var canContinue: Bool { picked.count + pickedPeople.count >= Self.minimumMembers && !creating }

    var body: some View {
        ZStack(alignment: .top) {
            Theme.dim
                .ignoresSafeArea()
                .onTapGesture { if !creating { close() } }
            VStack(spacing: 0) {
                header
                switch step {
                case .members: membersStep
                case .name: nameStep
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .background(Theme.bg, in: SheetTopShape(radius: Theme.continuous(38)))
            .clipShape(SheetTopShape(radius: Theme.continuous(38)))
            .padding(.top, SearchSheet.top)
            .ignoresSafeArea(edges: [.top, .bottom])
        }
        .ignoresSafeArea(.keyboard)
        .onAppear { focus = .search }
        .task(id: session.connection?.id) { await directory.load(session) }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("new-group-sheet")
    }

    // MARK: Header

    private var header: some View {
        HStack(spacing: 0) {
            if step == .name {
                GlassCircleButton(systemImage: "chevron.left", accessibilityLabel: "Back") {
                    step = .members
                    focus = .search
                }
            } else {
                GlassCircleButton(systemImage: "xmark", accessibilityLabel: "Close", action: close)
            }
            Text(step == .members ? "New Group Chat" : "Name Group Chat")
                .font(HomeMetrics.name)
                .foregroundStyle(Theme.textPrimary)
                .lineLimit(1)
                .padding(.leading, 16)
            Spacer(minLength: 8)
            nextButton
        }
        .padding(.horizontal, Theme.Metric.screenEdge)
        .padding(.top, 80 - SearchSheet.top)
    }

    private var nextButton: some View {
        Button {
            guard canContinue else { return }
            Haptics.selection()
            switch step {
            case .members:
                step = .name
                focus = .name
            case .name:
                create()
            }
        } label: {
            ZStack {
                if creating {
                    ProgressView().tint(Theme.disabledCapsuleText)
                } else {
                    Text(step == .members ? "Next" : "Create")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(canContinue ? Theme.primaryInk : Theme.disabledCapsuleText)
                }
            }
            .padding(.horizontal, 12)
            .frame(minWidth: 59.67)
            .frame(height: Theme.Metric.glassLarge)
            .background(canContinue ? Theme.primaryFill : Theme.disabledCapsule, in: Capsule())
            .overlay(
                Capsule().strokeBorder(
                    LinearGradient(colors: [Theme.parity(Color(hex: 0xC9C9C9), Theme.hairline), Theme.disabledCapsule, Theme.parity(Color(hex: 0xC9C9C9), Theme.hairline)], startPoint: .top, endPoint: .bottom),
                    lineWidth: 1
                )
            )
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        // not `.disabled`: that dims the grey capsule below the reference's
        .allowsHitTesting(canContinue)
        .accessibilityAddTraits(canContinue ? [] : .isStaticText)
        .accessibilityIdentifier(step == .members ? "new-group-next" : "new-group-create")
    }

    // MARK: Members

    private var membersStep: some View {
        VStack(spacing: 0) {
            toField
                .padding(.horizontal, Theme.Metric.screenEdge)
                .padding(.top, 10)
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(listed) { bot in
                        Button { toggle(bot) } label: { memberRow(bot) }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("new-group-row.\(bot.id)")
                            .accessibilityAddTraits(picked.contains(bot.id) ? .isSelected : [])
                    }
                    ForEach(people) { person in
                        Button { togglePerson(person) } label: { personRow(person) }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("new-group-person.\(person.principalId)")
                            .accessibilityAddTraits(pickedPeople.contains(person.principalId) ? .isSelected : [])
                    }
                }
                .padding(.top, 208 - 176)
                .padding(.bottom, 24)
            }
            .scrollDismissesKeyboard(.interactively)
        }
    }

    private var toField: some View {
        HStack(spacing: 0) {
            Text("To:")
                .font(.system(size: 13.75))
                .foregroundStyle(Theme.parity(Color(hex: 0x6B6B6D), Theme.placeholder))
                .padding(.leading, 14.67)
                .padding(.trailing, 6)
            HStack(spacing: 4) {
                // the last two picks as tokens, the rest counted
                let tokens: [(id: String, name: String, remove: () -> Void)] =
                    pickedBots.map { bot in (bot.id, bot.name, { toggle(bot) }) }
                    + pickedPeopleRows.map { person in (person.principalId, People.displayName(person), { togglePerson(person) }) }
                let shown = tokens.suffix(2)
                if tokens.count > shown.count {
                    Text(verbatim: "+\(tokens.count - shown.count)")
                        .font(.system(size: 14))
                        .foregroundStyle(Theme.textSecondary)
                }
                ForEach(Array(shown), id: \.id) { token in
                    Button { token.remove() } label: {
                        Text(verbatim: token.name)
                            .font(.system(size: 14))
                            .foregroundStyle(Theme.accentInk)
                            .lineLimit(1)
                            .padding(.horizontal, 8)
                            .frame(height: 26)
                            .background(Theme.accent, in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .fixedSize()
                    .accessibilityLabel(Text("Remove \(token.name)"))
                }
                ZStack(alignment: .leading) {
                    if query.isEmpty && picked.isEmpty && pickedPeople.isEmpty {
                        Text(people.isEmpty ? "Search Bots" : "Search bots and people")
                            .font(.system(size: 14))
                            .foregroundStyle(Theme.parity(Color(hex: 0x6B6B6D), Theme.placeholder))
                            .padding(.leading, 1.4)
                            .allowsHitTesting(false)
                    }
                    TextField("", text: $query)
                        .font(.system(size: 14))
                        .foregroundStyle(Theme.textPrimary)
                        .tint(Theme.caret)
                        .withoutKeyboardSuggestions()
                        .submitLabel(.search)
                        .focused($focus, equals: .search)
                        .accessibilityLabel(Text(people.isEmpty ? "Search Bots" : "Search bots and people"))
                        .accessibilityIdentifier("new-group-search")
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.trailing, 12)
        }
        .frame(height: 42)
        .themeGlass(Capsule())
    }

    private func memberRow(_ bot: Bot) -> some View {
        HStack(spacing: 0) {
            BotMascotView(bot: bot, size: 32)
                .frame(width: 32, height: 32)
                .accessibilityHidden(true)
                .padding(.leading, 22)
            Text(verbatim: bot.name)
                .font(Theme.Font.body)
                .foregroundStyle(Theme.textPrimary)
                .lineLimit(1)
                .padding(.leading, 14)
            Spacer(minLength: 8)
            if picked.contains(bot.id) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 20))
                    .foregroundStyle(Theme.blue)
                    .padding(.trailing, 23)
            }
        }
        .frame(height: 54)
        .contentShape(Rectangle())
    }

    private func personRow(_ person: OrgDirectoryPerson) -> some View {
        let label = People.displayName(person)
        return HStack(spacing: 0) {
            Text(verbatim: People.initials(label))
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Theme.textSecondary)
                .frame(width: 32, height: 32)
                .background(Theme.card, in: Circle())
                .accessibilityHidden(true)
                .padding(.leading, 22)
            Text(verbatim: label)
                .font(Theme.Font.body)
                .foregroundStyle(Theme.textPrimary)
                .lineLimit(1)
                .padding(.leading, 14)
            Spacer(minLength: 8)
            if pickedPeople.contains(person.principalId) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 20))
                    .foregroundStyle(Theme.blue)
                    .padding(.trailing, 23)
            }
        }
        .frame(height: 54)
        .contentShape(Rectangle())
    }

    private func togglePerson(_ person: OrgDirectoryPerson) {
        Haptics.selection()
        if let index = pickedPeople.firstIndex(of: person.principalId) {
            pickedPeople.remove(at: index)
        } else {
            pickedPeople.append(person.principalId)
            query = ""
        }
    }

    private func toggle(_ bot: Bot) {
        Haptics.selection()
        if let index = picked.firstIndex(of: bot.id) {
            picked.remove(at: index)
        } else {
            picked.append(bot.id)
            query = ""
        }
    }

    // MARK: Name

    private var nameStep: some View {
        VStack(spacing: 0) {
            if pickedBots.isEmpty {
                Image(systemName: "person.2.fill")
                    .font(.system(size: 34))
                    .foregroundStyle(Theme.textSecondaryHome)
                    .frame(width: HomeMetrics.pinnedMascot, height: HomeMetrics.pinnedMascot)
                    .background(Theme.card, in: Circle())
                    .padding(.top, 40)
                    .accessibilityHidden(true)
            } else {
                GroupMascotView(members: pickedBots, size: HomeMetrics.pinnedMascot, background: Theme.bg)
                    .padding(.top, 40)
                    .accessibilityHidden(true)
            }
            Text(verbatim: (pickedBots.map(\.name) + pickedPeopleRows.map(People.displayName)).joined(separator: ", "))
                .font(HomeMetrics.font12)
                .foregroundStyle(Theme.textSecondaryHome)
                .lineLimit(2)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
                .padding(.top, 12)
            ZStack {
                if name.isEmpty {
                    Text("Group name (optional)")
                        .font(.system(size: 17.5, weight: .medium))
                        .foregroundStyle(Theme.parity(Color(hex: 0x5E5E60), Theme.placeholder))
                        .allowsHitTesting(false)
                }
                TextField("", text: $name)
                    .font(.system(size: 17.5, weight: .medium))
                    .foregroundStyle(Theme.textPrimary)
                    .multilineTextAlignment(.center)
                    .tint(Theme.caret)
                    .autocorrectionDisabled()
                    .submitLabel(.done)
                    .focused($focus, equals: .name)
                    // As in Create Bot: on iOS 27 a create run inside the submit
                    // callback does nothing; one main-actor turn later it does.
                    .onSubmit { Task { @MainActor in await Task.yield(); create() } }
                    .accessibilityLabel(Text("Group name (optional)"))
                    .accessibilityIdentifier("new-group-name")
            }
            .padding(.horizontal, 16)
            .frame(height: 47.33)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.continuous(15.5), style: .continuous))
            .padding(.horizontal, 23.33)
            .padding(.top, 28)
            Spacer()
        }
    }

    private func create() {
        guard canContinue else { return }
        creating = true
        focus = nil
        let members = picked
        let humans = pickedPeople
        let chosen = name.trimmingCharacters(in: .whitespacesAndNewlines)
        Task {
            let room = await session.createRoom(name: chosen.isEmpty ? nil : chosen, memberIds: members, humanIds: humans)
            creating = false
            if let room {
                Haptics.success()
                created(room)
            }
        }
    }
}
