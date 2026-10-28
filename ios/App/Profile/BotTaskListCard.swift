// The bot panel's Tasks card (src/components/bot-settings/BotTaskSection.tsx):
// what the bot is doing for the person (CompanionCore/BotTodoList.swift).
// Rows in rounded cards like Routines: a state glyph, the title, a line on
// when it last moved. "Needs you" comes first, in the accent, with Answer on
// the row; then In progress; then Done, folded. A row opens its detail (the
// bot's note, its history, every action); a long press or "..." offers the
// same actions. An older server without the route says it comes with the
// server update, never a red error. Shown on the desktop panel's Details
// and on the phone panel, next to Suggestions.
import CompanionCore
import SwiftUI

// MARK: - Wording

enum BotTodoWording {
    static func stateLabel(_ state: BotTodoState) -> String {
        switch state {
        case .waiting: String(localized: "botTasks.state.waiting")
        case .doing: String(localized: "botTasks.state.doing")
        case .done: String(localized: "botTasks.state.done")
        }
    }

    /// The row's second line: when it last moved.
    static func subtitle(_ task: BotTodo, now: Date = Date()) -> String {
        let ago = BotAdvancedWording.ago(task.updatedAt, now: now)
        switch task.state {
        case .waiting: return String(localized: "Needs your answer · \(ago)")
        case .doing: return String(localized: "Updated \(ago)")
        case .done: return String(localized: "Done \(ago)")
        }
    }

    static func actor(_ by: BotTodoEvent.Actor) -> String {
        switch by {
        case .bot: String(localized: "by the bot")
        case .person: String(localized: "by you")
        }
    }

    static func historyLine(_ event: BotTodoEvent, now: Date = Date()) -> String {
        "\(stateLabel(event.state)) · \(actor(event.by)) · \(BotAdvancedWording.ago(event.at, now: now))"
    }

    static func answerDraft(_ task: BotTodo) -> String {
        BotTodoList.answerDraft(title: task.title, format: String(localized: "About the task “%@”: "))
    }

    static func actionTitle(_ action: BotTodoAction) -> String {
        switch action {
        case .complete: String(localized: "Mark done")
        case .resume: String(localized: "Put back in progress")
        case .reopen: String(localized: "Reopen")
        case .remove: String(localized: "Remove")
        }
    }

    static func actionSymbol(_ action: BotTodoAction) -> String {
        switch action {
        case .complete: "checkmark.circle"
        case .resume: "arrow.uturn.backward.circle"
        case .reopen: "arrow.counterclockwise.circle"
        case .remove: "trash"
        }
    }

    static func symbol(_ state: BotTodoState) -> String {
        switch state {
        case .waiting: "exclamationmark.bubble.fill"
        case .doing: "circle.dotted"
        case .done: "checkmark.circle.fill"
        }
    }
}

// MARK: - Card

struct BotTaskListCard: View {
    @Environment(\.themePalette) var themePalette
    @Environment(\.scenePhase) private var scenePhase
    @EnvironmentObject private var session: Session
    let bot: Bot
    /// Opens a conversation of this bot (the task's, else the bot's main one).
    let openThread: (String) -> Void

    @State private var tasks: [BotTodo]?
    @State private var load: Load = .ok
    @State private var showsDone = false
    @State private var working: Set<String> = []
    @State private var opened: OpenedTask?
    @State private var removing: BotTodo?

    private enum Load: Equatable { case ok, needsUpdate, failed }

    struct OpenedTask: Identifiable, Hashable { let id: String }

    private var groups: BotTodoGroups { BotTodoList.grouped(tasks ?? []) }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Tasks")
                    .font(Theme.Font.label)
                    .foregroundStyle(Theme.textTertiary)
                    .accessibilityAddTraits(.isHeader)
                Text("What this bot is doing for you. Anything that needs you comes first.")
                    .font(Theme.Font.label)
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, 4)
            content
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("panel-tasks")
        .task(id: "\(session.connection?.id ?? "")|\(bot.id)") {
            tasks = nil
            load = .ok
            await reload()
        }
        .onValueChange(of: scenePhase) { phase in
            if phase == .active { Task { await reload() } }
        }
        .onReceive(NotificationCenter.default.publisher(for: .sagaxBotTasksChanged)) { note in
            guard (note.object as? String) == bot.id else { return }
            Task { await reload() }
        }
        .sheet(item: $opened) { open in
            NavigationStack {
                if let task = tasks?.first(where: { $0.id == open.id }) {
                    BotTaskDetailView(
                        task: task,
                        working: working.contains(task.id),
                        answer: { answerFromDetail(task) },
                        openConversation: { openFromDetail(task) },
                        perform: { action in await perform(action, on: task) }
                    )
                } else {
                    // removed meanwhile: nothing left to show
                    Color.clear.onAppear { opened = nil }
                }
            }
            .environmentObject(session)
        }
        .confirmationDialog(Text("Remove this task?"), isPresented: Binding(
            get: { removing != nil }, set: { if !$0 { removing = nil } }
        ), titleVisibility: .visible, presenting: removing) { task in
            Button(String(localized: "Remove"), role: .destructive) {
                Task { await perform(.remove, on: task) }
            }
            .accessibilityIdentifier("panel-task-remove-confirm")
            Button(String(localized: "Cancel"), role: .cancel) {}
        } message: { task in
            Text(verbatim: task.title)
        }
    }

    @ViewBuilder
    private var content: some View {
        switch load {
        case .needsUpdate:
            note("Available after the server update.", color: Theme.textTertiary)
                .accessibilityIdentifier("panel-tasks-needs-update")
        case .failed where tasks == nil:
            note("The task list could not be loaded.", color: Theme.danger)
        default:
            if let tasks {
                VStack(alignment: .leading, spacing: 8) {
                    if load == .failed {
                        note("The task list could not be loaded.", color: Theme.danger)
                    }
                    if tasks.isEmpty {
                        note("No tasks yet. Ask your bot to note a task, for example \"Add a task: renew the domain\".", color: Theme.textTertiary)
                            .accessibilityIdentifier("panel-tasks-empty")
                    } else {
                        list(groups)
                    }
                }
            } else {
                ProgressView()
                    .controlSize(.small)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
            }
        }
    }

    private func list(_ groups: BotTodoGroups) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            if !groups.waiting.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    groupHeader("botTasks.group.waiting", count: groups.waiting.count, accent: true)
                    rows(groups.waiting, accent: true)
                }
                .accessibilityIdentifier("panel-tasks-waiting")
            }
            if !groups.doing.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    groupHeader("botTasks.group.doing", count: groups.doing.count, accent: false)
                    rows(groups.doing, accent: false)
                }
                .accessibilityIdentifier("panel-tasks-doing")
            }
            if !groups.done.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Button {
                        Haptics.selection()
                        withAnimation(.snappy(duration: 0.2)) { showsDone.toggle() }
                    } label: {
                        HStack(spacing: 6) {
                            groupHeader("botTasks.group.done", count: groups.done.count, accent: false)
                            Image(systemName: "chevron.right")
                                .font(.system(size: 10, weight: .semibold))
                                .foregroundStyle(Theme.textTertiary)
                                .rotationEffect(.degrees(showsDone ? 90 : 0))
                            Spacer(minLength: 0)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(Text("\(String(localized: "botTasks.group.done")), \(groups.done.count)"))
                    .accessibilityValue(showsDone ? Text("Expanded") : Text("Collapsed"))
                    .accessibilityAddTraits([.isHeader, .isButton])
                    .accessibilityIdentifier("panel-tasks-done-toggle")
                    if showsDone {
                        rows(groups.done, accent: false)
                    }
                }
                .accessibilityIdentifier("panel-tasks-done")
            }
        }
    }

    private func groupHeader(_ key: LocalizedStringKey, count: Int, accent: Bool) -> some View {
        HStack(spacing: 6) {
            Text(key)
                .font(Theme.Font.labelMedium)
                .foregroundStyle(accent ? Theme.accentText : Theme.textSecondary)
            Text(verbatim: "\(count)")
                .font(Theme.Font.labelMedium)
                .monospacedDigit()
                .foregroundStyle(accent ? Theme.accentText : Theme.textTertiary)
                .padding(.horizontal, 6)
                .padding(.vertical, 1)
                .background((accent ? Theme.accentText : Theme.textTertiary).opacity(0.14), in: Capsule())
        }
        .padding(.horizontal, 4)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }

    private func rows(_ items: [BotTodo], accent: Bool) -> some View {
        VStack(spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.element.id) { index, task in
                if index > 0 { CardHairline(leadingInset: 44) }
                row(task)
            }
        }
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay {
            if accent {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(Theme.accentText.opacity(0.5), lineWidth: 1)
            }
        }
    }

    private func row(_ task: BotTodo) -> some View {
        let busy = working.contains(task.id)
        return HStack(alignment: .center, spacing: 12) {
            Button {
                Haptics.selection()
                opened = OpenedTask(id: task.id)
            } label: {
                HStack(alignment: .top, spacing: 12) {
                    stateGlyph(task.state)
                        .frame(width: 20, height: 20)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(verbatim: task.title)
                            .font(Theme.Font.body)
                            .foregroundStyle(task.state == .done ? Theme.textSecondary : Theme.textPrimary)
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                        Text(verbatim: BotTodoWording.subtitle(task))
                            .font(Theme.Font.label)
                            .foregroundStyle(task.state == .waiting ? Theme.accentText : Theme.textTertiary)
                            .lineLimit(1)
                        if task.state == .waiting, let preview = task.notePreview {
                            Text(verbatim: preview)
                                .font(Theme.Font.label)
                                .foregroundStyle(Theme.textSecondary)
                                .lineLimit(1)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if task.state == .waiting, BotTodoList.answerThread(task, botThreadId: bot.threadId) != nil {
                Button {
                    Haptics.selection()
                    answer(task)
                } label: {
                    Text("Answer")
                        .font(Theme.Font.labelMedium)
                        .foregroundStyle(Theme.accentText)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(Theme.accentText.opacity(0.14), in: Capsule())
                        .fixedSize()
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("panel-task-answer.\(task.id)")
            }
            Menu {
                menuItems(task)
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.textTertiary)
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("More actions"))
            .accessibilityIdentifier("panel-task-menu.\(task.id)")
        }
        .padding(.leading, 12)
        .padding(.trailing, 8)
        .padding(.vertical, 10)
        .opacity(busy ? 0.5 : 1)
        .disabled(busy)
        .contentShape(Rectangle())
        .contextMenu { menuItems(task) }
        // VoiceOver: one element that reads the title and the state, with
        // every action of the menu as a custom action.
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: "\(task.title), \(BotTodoWording.stateLabel(task.state))"))
        .accessibilityValue(Text(verbatim: BotTodoWording.subtitle(task)))
        .accessibilityHint(task.notePreview.map { Text(verbatim: $0) } ?? Text(verbatim: ""))
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { opened = OpenedTask(id: task.id) }
        .accessibilityActions {
            if task.state == .waiting, BotTodoList.answerThread(task, botThreadId: bot.threadId) != nil {
                Button(String(localized: "Answer")) { answer(task) }
            }
            ForEach(BotTodoList.actions(for: task.state), id: \.self) { action in
                Button(BotTodoWording.actionTitle(action)) { request(action, on: task) }
            }
        }
        .accessibilityIdentifier("panel-task.\(task.id)")
    }

    @ViewBuilder
    private func menuItems(_ task: BotTodo) -> some View {
        if task.state == .waiting, BotTodoList.answerThread(task, botThreadId: bot.threadId) != nil {
            Button(String(localized: "Answer"), systemImage: "arrowshape.turn.up.left") { answer(task) }
        }
        if let thread = BotTodoList.answerThread(task, botThreadId: bot.threadId) {
            Button(String(localized: "Open the conversation"), systemImage: "bubble.left.and.bubble.right") { openThread(thread) }
        }
        ForEach(BotTodoList.moves(for: task.state), id: \.self) { action in
            Button(BotTodoWording.actionTitle(action), systemImage: BotTodoWording.actionSymbol(action)) { request(action, on: task) }
        }
        Divider()
        Button(String(localized: "Remove"), systemImage: "trash", role: .destructive) { removing = task }
    }

    private func stateGlyph(_ state: BotTodoState) -> some View {
        Image(systemName: BotTodoWording.symbol(state))
            .font(.system(size: state == .doing ? 15 : 16, weight: .regular))
            .foregroundStyle(glyphColor(state))
            .accessibilityHidden(true)
    }

    private func glyphColor(_ state: BotTodoState) -> Color {
        switch state {
        case .waiting: Theme.accentText
        case .doing: Theme.textSecondary
        case .done: Theme.textTertiary
        }
    }

    private func note(_ text: LocalizedStringKey, color: Color) -> some View {
        Text(text)
            .font(Theme.Font.label)
            .foregroundStyle(color)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    // MARK: Actions

    /// Remove asks first; every other move goes at once.
    private func request(_ action: BotTodoAction, on task: BotTodo) {
        if action == .remove {
            removing = task
        } else {
            Task { await perform(action, on: task) }
        }
    }

    /// Answer: the conversation opens with a draft about the task, unsent.
    private func answer(_ task: BotTodo) {
        guard let thread = BotTodoList.answerThread(task, botThreadId: bot.threadId) else { return }
        ComposerPrefill.shared.set(BotTodoWording.answerDraft(task), threadId: thread)
        openThread(thread)
    }

    /// From the detail: the sheet closes first, a change under a closing
    /// sheet is dropped.
    private func answerFromDetail(_ task: BotTodo) {
        opened = nil
        Task {
            try? await Task.sleep(nanoseconds: 500_000_000)
            answer(task)
        }
    }

    private func openFromDetail(_ task: BotTodo) {
        guard let thread = BotTodoList.answerThread(task, botThreadId: bot.threadId) else { return }
        opened = nil
        Task {
            try? await Task.sleep(nanoseconds: 500_000_000)
            openThread(thread)
        }
    }

    /// One action, then the list again. True when the server took it.
    @discardableResult
    private func perform(_ action: BotTodoAction, on task: BotTodo) async -> Bool {
        guard let client = session.settingsClient, !working.contains(task.id) else { return false }
        working.insert(task.id)
        defer { working.remove(task.id) }
        do {
            try await client.act(action, onBotTodo: task.id, botId: task.botId)
            Haptics.success()
            if action == .remove, opened?.id == task.id { opened = nil }
            await reload()
            return true
        } catch {
            // a task gone meanwhile (404) is not a failure: read the list again
            if case .loaded = BotTodoList.outcome(of: error) {
                await reload()
            } else {
                apply(BotTodoList.outcome(of: error))
            }
            return false
        }
    }

    private func reload() async {
        guard let client = session.settingsClient else { return }
        let botId = bot.id
        do {
            let next = try await client.botTodos(botId: botId)
            guard botId == bot.id else { return }
            tasks = next
            load = .ok
        } catch is CancellationError {
            return
        } catch {
            guard botId == bot.id else { return }
            apply(BotTodoList.outcome(of: error))
        }
    }

    private func apply(_ outcome: BotTodoLoad) {
        switch outcome {
        case let .loaded(list):
            tasks = list
            load = .ok
        case .needsUpdate:
            load = .needsUpdate
        case .failed:
            load = .failed
        }
    }
}

// MARK: - Detail

/// One task: its full title and state, the bot's note, its history and every
/// action. Built on the routine screens (RoutineDetailView).
struct BotTaskDetailView: View {
    @Environment(\.themePalette) var themePalette
    let task: BotTodo
    let working: Bool
    let answer: () -> Void
    let openConversation: () -> Void
    let perform: (BotTodoAction) async -> Bool

    @State private var confirmingRemove = false
    @Environment(\.dismiss) private var dismiss

    private let margin = Theme.Profile.routineMargin

    var body: some View {
        RoutineScreen(title: task.title) {
            Menu {
                actionButtons
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(Theme.textPrimary)
                    .frame(width: 44, height: 44)
                    .contentShape(Circle())
            }
            .accessibilityLabel(Text("More actions"))
            .accessibilityIdentifier("task-detail-menu")
        } content: {
            ProfileCard(margin: margin) {
                VStack(alignment: .leading, spacing: 10) {
                    Text(verbatim: task.title)
                        .font(Theme.Font.bodyMedium)
                        .foregroundStyle(Theme.textPrimary)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("task-detail-title")
                    HStack(spacing: 8) {
                        statePill
                        Text(verbatim: BotTodoWording.subtitle(task))
                            .font(Theme.Font.label)
                            .foregroundStyle(Theme.textTertiary)
                            .lineLimit(1)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, Theme.Profile.textInset)
                .padding(.vertical, 14)
            }

            if let note = task.noteText {
                ProfileSectionLabel(text: "Note from the bot", margin: margin)
                    .padding(.top, Theme.Profile.cardGap)
                ProfileCard(margin: margin) {
                    Text(verbatim: note)
                        .font(Theme.Font.body)
                        .foregroundStyle(Theme.textPrimary)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, Theme.Profile.textInset)
                        .padding(.vertical, 14)
                        .accessibilityIdentifier("task-detail-note")
                }
            }

            ProfileCard(margin: margin) {
                VStack(spacing: 0) {
                    if task.state == .waiting {
                        actionRow(Text("Answer"), systemImage: "arrowshape.turn.up.left", tint: Theme.accentText, id: "answer") { answer() }
                        ProfileDivider(leading: Theme.Profile.textInset)
                    }
                    actionRow(Text("Open the conversation"), systemImage: "bubble.left.and.bubble.right", tint: Theme.textPrimary, id: "open") { openConversation() }
                    ForEach(BotTodoList.moves(for: task.state), id: \.self) { action in
                        ProfileDivider(leading: Theme.Profile.textInset)
                        actionRow(Text(verbatim: BotTodoWording.actionTitle(action)), systemImage: BotTodoWording.actionSymbol(action),
                                  tint: Theme.textPrimary, id: action.rawValue) {
                            Task { _ = await perform(action) }
                        }
                    }
                    ProfileDivider(leading: Theme.Profile.textInset)
                    actionRow(Text("Remove"), systemImage: "trash", tint: Theme.danger, id: "remove") { confirmingRemove = true }
                }
                .disabled(working)
                .opacity(working ? 0.5 : 1)
            }
            .padding(.top, Theme.Profile.cardGap)

            let history = task.historyNewestFirst
            if !history.isEmpty {
                ProfileSectionLabel(text: "History", margin: margin)
                    .padding(.top, Theme.Profile.cardGap)
                ProfileCard(margin: margin) {
                    ForEach(Array(history.enumerated()), id: \.offset) { index, event in
                        if index > 0 { ProfileDivider(leading: Theme.Profile.textInset) }
                        HStack(spacing: 10) {
                            Image(systemName: BotTodoWording.symbol(event.state))
                                .font(.system(size: 13))
                                .foregroundStyle(event.state == .waiting ? Theme.accentText : Theme.textTertiary)
                                .accessibilityHidden(true)
                            Text(verbatim: BotTodoWording.historyLine(event))
                                .font(Theme.Font.label)
                                .foregroundStyle(Theme.textSecondary)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .padding(.horizontal, Theme.Profile.textInset)
                        .padding(.vertical, 11)
                        .accessibilityElement(children: .combine)
                    }
                }
                .accessibilityIdentifier("task-detail-history")
            }
        }
        .confirmationDialog(Text("Remove this task?"), isPresented: $confirmingRemove, titleVisibility: .visible) {
            Button(String(localized: "Remove"), role: .destructive) {
                Task { if await perform(.remove) { dismiss() } }
            }
            .accessibilityIdentifier("task-detail-remove-confirm")
            Button(String(localized: "Cancel"), role: .cancel) {}
        } message: {
            Text(verbatim: task.title)
        }
    }

    private var statePill: some View {
        HStack(spacing: 4) {
            Image(systemName: BotTodoWording.symbol(task.state))
                .font(.system(size: 10, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: BotTodoWording.stateLabel(task.state))
                .font(Theme.Font.labelMedium)
        }
        .foregroundStyle(task.state == .waiting ? Theme.accentText : Theme.textSecondary)
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background((task.state == .waiting ? Theme.accentText : Theme.textTertiary).opacity(0.14), in: Capsule())
        .accessibilityIdentifier("task-detail-state")
    }

    @ViewBuilder
    private var actionButtons: some View {
        if task.state == .waiting {
            Button(String(localized: "Answer"), systemImage: "arrowshape.turn.up.left") { answer() }
        }
        Button(String(localized: "Open the conversation"), systemImage: "bubble.left.and.bubble.right") { openConversation() }
        ForEach(BotTodoList.moves(for: task.state), id: \.self) { action in
            Button(BotTodoWording.actionTitle(action), systemImage: BotTodoWording.actionSymbol(action)) {
                Task { _ = await perform(action) }
            }
        }
        Divider()
        Button(String(localized: "Remove"), systemImage: "trash", role: .destructive) { confirmingRemove = true }
    }

    private func actionRow(_ title: Text, systemImage: String, tint: Color, id: String,
                           action: @escaping () -> Void) -> some View {
        Button {
            Haptics.selection()
            action()
        } label: {
            HStack(spacing: 12) {
                Image(systemName: systemImage)
                    .font(.system(size: 15))
                    .frame(width: 22)
                    .accessibilityHidden(true)
                title
                    .font(Theme.Font.body)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .foregroundStyle(tint)
            .padding(.horizontal, Theme.Profile.textInset)
            .frame(minHeight: Theme.Profile.singleRow)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("task-detail-\(id)")
    }
}
