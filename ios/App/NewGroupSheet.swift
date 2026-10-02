// New Group Chat (reference 17): a full-height sheet 62 pt from the top with
// an X, the title and a "Next" capsule that stays grey until two bots are
// picked. A "To:" token field filters the bots below it (32 pt mascot and
// name on a 54 pt pitch); picked bots become tokens. "Next" leads to a name
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
    private var canContinue: Bool { picked.count >= Self.minimumMembers && !creating }

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
                let shown = pickedBots.suffix(2)
                if pickedBots.count > shown.count {
                    Text(verbatim: "+\(pickedBots.count - shown.count)")
                        .font(.system(size: 14))
                        .foregroundStyle(Theme.textSecondary)
                }
                ForEach(Array(shown)) { bot in
                    Button { toggle(bot) } label: {
                        Text(verbatim: bot.name)
                            .font(.system(size: 14))
                            .foregroundStyle(Theme.accentInk)
                            .lineLimit(1)
                            .padding(.horizontal, 8)
                            .frame(height: 26)
                            .background(Theme.blue, in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .fixedSize()
                    .accessibilityLabel(Text("Remove \(bot.name)"))
                }
                ZStack(alignment: .leading) {
                    if query.isEmpty && picked.isEmpty {
                        Text("Search Bots")
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
                        .accessibilityLabel(Text("Search Bots"))
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
            GroupMascotView(members: pickedBots, size: HomeMetrics.pinnedMascot, background: Theme.bg)
                .padding(.top, 40)
                .accessibilityHidden(true)
            Text(verbatim: pickedBots.map(\.name).joined(separator: ", "))
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
                    .onSubmit(create)
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
        let chosen = name.trimmingCharacters(in: .whitespacesAndNewlines)
        Task {
            let room = await session.createRoom(name: chosen.isEmpty ? nil : chosen, memberIds: members)
            creating = false
            if let room {
                Haptics.success()
                created(room)
            }
        }
    }
}
