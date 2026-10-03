// What the bot is doing (matrix row BP10), as the desktop's bot panel shows
// it: the Coding and Activity sections of live work (ActivitySection.tsx,
// ActivityCard.tsx), the history from each section's title
// (ActivityListModal.tsx) and one entry in full with Stop, steer and Open
// thread (ActivityDetailModal.tsx, ActivitySteps.tsx).
//
// The views are layout-agnostic: `BotActivityCard` is the phone's Info-tab
// card and the iPad's `panel-details` block alike; the history and detail
// are plain navigation content that a sheet or a panel column hosts.
import CompanionCore
import SwiftUI
import UIKit

// MARK: - Row

/// One entry: status icon, title, status line, and Stop or a chevron. With
/// `onOpen` the text part is its own button beside Stop (a card); without it
/// the host makes the row tappable (a list's NavigationLink).
struct BotActivityRow: View {
    @Environment(\.themePalette) var themePalette
    let item: BotActivityItem
    var now: Double?
    var stopping = false
    var onStop: ((BotActivityItem) -> Void)?
    var onOpen: ((BotActivityItem) -> Void)?

    private var stoppable: Bool { onStop != nil && item.stoppable }

    var body: some View {
        HStack(spacing: 0) {
            if let onOpen {
                Button {
                    Haptics.selection()
                    onOpen(item)
                } label: {
                    summary.contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("activity-row.\(item.id)")
            } else {
                summary
            }
            if stoppable {
                Button {
                    Haptics.selection()
                    onStop?(item)
                } label: {
                    Group {
                        if stopping {
                            ProgressView().controlSize(.small)
                        } else {
                            Image(systemName: "stop.fill").font(.system(size: 11, weight: .semibold))
                        }
                    }
                    .foregroundStyle(Theme.danger)
                    .frame(width: 32, height: 32)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.borderless)
                .disabled(stopping)
                .padding(.trailing, 10)
                .accessibilityLabel(Text("Stop \(item.title)"))
                .accessibilityIdentifier("activity-stop.\(item.id)")
            } else if onOpen != nil {
                ProfileChevronTrailing()
            }
        }
        .frame(minHeight: Theme.Profile.routineRow - 1)
    }

    private var summary: some View {
        HStack(spacing: 0) {
            BotActivityStatusIcon(status: item.status)
                .frame(width: Theme.Profile.iconColumn, alignment: .center)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: item.title)
                    .font(Theme.Font.body)
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(1)
                Text(verbatim: BotActivityWording.subtitle(item, now: now))
                    .font(Theme.Profile.labelFont)
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(1)
                    .accessibilityIdentifier("activity-subtitle.\(item.id)")
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Spacer(minLength: 8)
        }
    }
}

struct BotActivityStatusIcon: View {
    @Environment(\.themePalette) var themePalette
    let status: BotActivityStatus
    var size: CGFloat = 16

    var body: some View {
        Group {
            if status == .running {
                ProgressView().controlSize(.small).tint(status.tint)
            } else {
                Image(systemName: status.symbol)
                    .font(.system(size: size, weight: .regular))
                    .foregroundStyle(status.tint)
            }
        }
        .accessibilityHidden(true)
    }
}

// MARK: - Card (Info tab)

/// The Info tab's Activity card: Coding and Activity, live work only, each
/// title opening the history. A tap on an entry opens its detail.
struct BotActivityCard: View {
    @Environment(\.themePalette) var themePalette
    let bot: Bot
    @ObservedObject var model: BotActivityModel
    let onOpen: (BotActivityItem) -> Void
    let onHistory: (BotActivityFilter) -> Void

    @EnvironmentObject private var session: Session

    var body: some View {
        ProfileCard {
            section(.coding, icon: "chevron.left.forwardslash.chevron.right", items: model.coding, showsError: true)
            ProfileDivider(leading: 0)
            section(.other, icon: "waveform.path.ecg", items: model.other, showsError: false)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("profile-activity")
    }

    @ViewBuilder
    private func section(_ filter: BotActivityFilter, icon: String, items: [BotActivityItem]?, showsError: Bool) -> some View {
        Button {
            Haptics.selection()
            onHistory(filter)
        } label: {
            ProfileRow(
                icon: ProfileRowIcon(systemImage: icon, size: 15),
                title: Text(verbatim: filter == .coding ? String(localized: "Coding") : String(localized: "Activity")),
                height: Theme.Profile.singleRow
            ) { ProfileChevronTrailing() }
        }
        .buttonStyle(.plain)
        .accessibilityHint(Text("Open history"))
        .accessibilityIdentifier("activity-section.\(filter.rawValue)")

        if let items {
            if items.isEmpty {
                quiet(Text("Nothing running."))
            } else {
                ForEach(items) { item in
                    ProfileDivider()
                    BotActivityRow(
                        item: item,
                        now: model.now.timeIntervalSince1970 * 1000,
                        stopping: model.stopping.contains(item.id),
                        onStop: { model.stopItem($0) { session.actionError = $0 } },
                        onOpen: onOpen
                    )
                    .opacity(model.fading(item) ? 0 : 1)
                    .animation(.easeOut(duration: BotActivityRules.finishedFade), value: model.fading(item))
                }
            }
        } else if showsError && model.failed {
            quiet(Text("Couldn't load this bot's activity."))
        } else if showsError {
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text("Loading activity…")
            }
            .font(Theme.Profile.labelFont)
            .foregroundStyle(Theme.textSecondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.leading, Theme.Profile.iconColumn)
            .padding(.bottom, 12)
        }
    }

    private func quiet(_ text: Text) -> some View {
        text
            .font(Theme.Profile.labelFont)
            .foregroundStyle(Theme.textTertiary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.leading, Theme.Profile.iconColumn)
            .padding(.bottom, 12)
    }
}

// MARK: - History

/// The last 7 days of one section, newest first, by status and words; an
/// entry opens its detail (ActivityListModal.tsx).
struct BotActivityHistoryView: View {
    @Environment(\.themePalette) var themePalette
    let botId: String
    @State var filter: BotActivityFilter
    let parent: BotActivityModel

    @EnvironmentObject private var session: Session
    @State private var items: [BotActivityItem]?
    @State private var failed = false
    @State private var status: BotActivityHistoryStatus = .all
    @State private var search = ""
    @State private var now = Date()

    private var shown: [BotActivityItem]? {
        items.map { BotActivityRules.history($0, status: status, search: search) }
    }

    var body: some View {
        List {
            Section {
                Picker("Filter", selection: $filter) {
                    ForEach(BotActivityFilter.allCases, id: \.self) { id in
                        Text(verbatim: BotActivityWording.filter(id)).tag(id)
                    }
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("activity-history-filter")
                Picker("Status", selection: $status) {
                    ForEach(BotActivityHistoryStatus.allCases, id: \.self) { id in
                        Text(verbatim: BotActivityWording.historyStatus(id)).tag(id)
                    }
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("activity-history-status")
            } footer: {
                Text("The last 7 days you may see.")
            }
            .listRowBackground(Theme.card)

            Section {
                if let shown {
                    if shown.isEmpty {
                        Text("Nothing in the last 7 days.")
                            .foregroundStyle(Theme.textSecondary)
                            .accessibilityIdentifier("activity-history-empty")
                    }
                    ForEach(shown) { item in
                        NavigationLink {
                            BotActivityDetailView(item: item, parent: parent)
                        } label: {
                            BotActivityRow(
                                item: item,
                                now: now.timeIntervalSince1970 * 1000,
                                stopping: parent.stopping.contains(item.id),
                                onStop: { parent.stopItem($0) { session.actionError = $0 } }
                            )
                        }
                        .accessibilityIdentifier("activity-history-row.\(item.id)")
                    }
                } else if failed {
                    Text("Couldn't load this bot's activity.").foregroundStyle(Theme.textSecondary)
                } else {
                    HStack { ProgressView(); Text("Loading activity…").foregroundStyle(Theme.textSecondary) }
                }
            }
            .listRowBackground(Theme.card)
            .listRowInsets(EdgeInsets())
        }
        .scrollContentBackground(.hidden)
        .background(Theme.bg)
        .searchable(text: $search, prompt: Text("Search"))
        .navigationTitle(Text("History"))
        .navigationBarTitleDisplayMode(.inline)
        .task(id: filter) { await poll() }
        .accessibilityIdentifier("activity-history")
    }

    /// Load, then follow every 4 s while something runs.
    private func poll() async {
        items = nil
        while !Task.isCancelled {
            await load()
            let running = items?.contains { $0.status.isActive } ?? false
            guard running else { return }
            for _ in 0..<4 {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                if Task.isCancelled { return }
                now = Date()
            }
        }
    }

    private func load() async {
        guard let client = session.profileClient else { return }
        do {
            let list = try await client.botActivity(botId: botId, filter: filter, limit: BotActivityRules.listLimit)
            items = list.all
            now = Date()
            failed = false
        } catch {
            failed = true
        }
    }
}

// MARK: - Detail

/// One entry in full: status, times, who started it, engine and payer, the
/// steer box, sub-agents, steps and files, with Stop and Open thread.
struct BotActivityDetailView: View {
    @Environment(\.themePalette) var themePalette
    @State var item: BotActivityItem
    let parent: BotActivityModel
    /// Open the entry's thread (the host closes what covers the chat).
    var onOpenThread: ((String, String) -> Void)?

    @EnvironmentObject private var session: Session
    @Environment(\.dismiss) private var dismiss
    @Environment(\.botActivityOpenThread) private var hostOpenThread
    @State private var detail: BotActivityDetail?
    @State private var failed = false
    @State private var now = Date()
    @State private var stopping = false
    @State private var instances: [Instance] = []
    // The steer box's draft and outcome live here: the detail reloads
    // after a send, and the box must keep saying it was sent.
    @State private var steerText = ""
    @State private var steerState: BotActivitySteerState = .idle

    private var shown: BotActivityItem { detail?.item ?? item }
    private var running: Bool { shown.status.isActive }

    var body: some View {
        List {
            Section {
                HStack(alignment: .top, spacing: 12) {
                    BotActivityStatusIcon(status: shown.status, size: 18).padding(.top, 2)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(verbatim: shown.title)
                            .font(Theme.font(15, .semibold))
                            .foregroundStyle(Theme.textPrimary)
                        Text(verbatim: (shown.parallel == true ? String(localized: "Parallel task") + " · " : "") + BotActivityWording.status(shown.status))
                            .font(Theme.Profile.labelFont)
                            .foregroundStyle(Theme.textSecondary)
                            .accessibilityIdentifier("activity-detail-status")
                    }
                }
                if detail == nil, failed {
                    Text("Couldn't load this activity.").foregroundStyle(Theme.danger)
                }
                if let note = detail?.note, !note.isEmpty {
                    Text(verbatim: note)
                        .font(Theme.Font.body)
                        .foregroundStyle(Theme.textPrimary)
                        .listRowBackground(Theme.warning.opacity(0.12))
                }
            }
            .listRowBackground(Theme.card)

            Section {
                fact("Started", BotActivityWording.time(shown.startedAt))
                if let ended = shown.endedAt { fact("Ended", BotActivityWording.time(ended)) }
                fact("Duration", BotActivityRules.duration((shown.endedAt ?? now.timeIntervalSince1970 * 1000) - shown.startedAt))
                if let by = shown.startedBy, !by.name.isEmpty {
                    fact("Started by", by.kind == .routine ? String(localized: "Routine \(by.name)") : by.name)
                }
                if shown.kind == .subagent, let name = shown.botName, !name.isEmpty { fact("Bot", name) }
                if let engine = detail?.engine {
                    let name = instances.first { $0.instanceId == engine.instanceId }?.displayName ?? engine.instanceId
                    fact("Engine", [name, engine.model].filter { !$0.isEmpty }.joined(separator: " · "))
                }
                if let via = detail?.via { fact("Paid with", BotActivityWording.via(via)) }
            } footer: {
                if let detail, detail.item.threadId == nil, detail.item.kind == .routine {
                    Text("This run's conversation belongs to the person it runs for: only its status is shown here.")
                }
            }
            .listRowBackground(Theme.card)

            if running, let detail, detail.stoppable, let threadId = detail.item.threadId {
                BotActivitySteerSection(botId: detail.item.botId, threadId: threadId, text: $steerText, state: $steerState) { await load() }
            }

            if let children = detail?.children, !children.isEmpty {
                Section("Sub-agents") {
                    ForEach(children) { child in
                        BotActivityRow(item: child, onOpen: { child in
                            // a sub-agent opens in place
                            guard child.threadId != nil else { return }
                            item = child
                            detail = nil
                        })
                    }
                }
                .listRowBackground(Theme.card)
                .listRowInsets(EdgeInsets())
            }

            if let detail, detail.item.threadId != nil || !detail.steps.isEmpty {
                Section("Steps") {
                    if detail.steps.isEmpty {
                        Text("No tool calls yet.").foregroundStyle(Theme.textSecondary)
                    } else {
                        if detail.stepsTruncated {
                            Text("Older steps are in the conversation.")
                                .font(Theme.Profile.labelFont)
                                .foregroundStyle(Theme.textSecondary)
                        }
                        let tree = BotActivityStepLabel.tree(detail.steps)
                        ForEach(tree.top) { step in
                            BotActivityStepRow(step: step, substeps: tree.children[step.id] ?? [])
                        }
                    }
                }
                .listRowBackground(Theme.card)
                .accessibilityIdentifier("activity-steps")
            }

            if let files = detail?.files, !files.isEmpty {
                Section("Files touched") {
                    ForEach(files, id: \.self) { file in
                        Label {
                            Text(verbatim: file).font(Theme.Font.code).lineLimit(1).truncationMode(.middle)
                        } icon: {
                            Image(systemName: "doc.text").foregroundStyle(Theme.textSecondary)
                        }
                        .contextMenu {
                            Button(String(localized: "Copy path"), systemImage: "doc.on.doc") { UIPasteboard.general.string = file }
                        }
                    }
                }
                .listRowBackground(Theme.card)
            }

            Section {
                if running, detail?.canStop == true {
                    Button(role: .destructive) {
                        stop()
                    } label: {
                        HStack {
                            if stopping { ProgressView().controlSize(.small) } else { Image(systemName: "stop.fill") }
                            Text("Stop")
                        }
                    }
                    .disabled(stopping)
                    .accessibilityIdentifier("activity-detail-stop")
                }
                if let threadId = shown.threadId {
                    Button {
                        openThread(botId: shown.botId, threadId: threadId)
                    } label: {
                        Label("Open thread", systemImage: "arrow.up.right.square")
                    }
                    .accessibilityIdentifier("activity-open-thread")
                }
            }
            .listRowBackground(Theme.card)
        }
        .scrollContentBackground(.hidden)
        .background(Theme.bg)
        .navigationTitle(Text(verbatim: shown.title))
        .navigationBarTitleDisplayMode(.inline)
        .task(id: item.id) {
            steerText = ""
            steerState = .idle
            await follow()
        }
        .accessibilityIdentifier("activity-detail")
    }

    private func fact(_ label: LocalizedStringKey, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).font(Theme.Profile.labelFont).foregroundStyle(Theme.textSecondary)
            Spacer(minLength: 12)
            Text(verbatim: value)
                .font(Theme.Font.preview)
                .foregroundStyle(Theme.textPrimary)
                .lineLimit(1)
                .multilineTextAlignment(.trailing)
        }
    }

    /// Load, then follow every 3 s while the run goes.
    private func follow() async {
        if instances.isEmpty, let client = session.profileClient {
            instances = (try? await client.instances()) ?? []
        }
        while !Task.isCancelled {
            await load()
            guard running else { return }
            try? await Task.sleep(nanoseconds: UInt64(BotActivityRules.detailPoll * 1_000_000_000))
            now = Date()
        }
    }

    private func load() async {
        guard let client = session.profileClient else { return }
        do {
            detail = try await client.botActivityDetail(botId: item.botId, itemId: item.id)
            failed = false
            now = Date()
        } catch {
            failed = true
        }
    }

    private func stop() {
        guard let detail, detail.item.threadId != nil else { return }
        stopping = true
        parent.stopItem(detail.item, fromDetail: true) { message in
            session.actionError = message
        }
        Task {
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            stopping = false
            await load()
        }
    }

    private func openThread(botId: String, threadId: String) {
        if let open = onOpenThread ?? hostOpenThread {
            open(botId, threadId)
        } else {
            session.openChat(threadId: threadId)
            dismiss()
        }
    }
}

enum BotActivitySteerState { case idle, sending, sent, failed }

/// A message into a running task: it joins the work in progress.
private struct BotActivitySteerSection: View {
    @Environment(\.themePalette) var themePalette
    let botId: String
    let threadId: String
    @Binding var text: String
    @Binding var state: BotActivitySteerState
    let onSent: () async -> Void

    @EnvironmentObject private var session: Session

    var body: some View {
        Section {
            HStack(spacing: 8) {
                TextField(String(localized: "Add an instruction…"), text: $text)
                    .onSubmit { submit() }
                    // typing again clears the outcome (the send's own clearing does not)
                    .onValueChange(of: text) { value in if state != .sending, !value.isEmpty { state = .idle } }
                    .accessibilityIdentifier("activity-steer-field")
                Button {
                    submit()
                } label: {
                    if state == .sending { ProgressView().controlSize(.small) } else { Text("Send") }
                }
                .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || state == .sending)
                .accessibilityIdentifier("activity-steer-send")
            }
            switch state {
            case .sent:
                Text("Sent to the task")
                    .font(Theme.Profile.labelFont)
                    .foregroundStyle(Theme.textSecondary)
                    .accessibilityIdentifier("activity-steer-sent")
            case .failed:
                Text("Couldn't load this activity.")
                    .font(Theme.Profile.labelFont)
                    .foregroundStyle(Theme.danger)
            default:
                EmptyView()
            }
        } header: {
            Text("Send a message to this task")
        }
        .listRowBackground(Theme.card)
    }

    private func submit() {
        let words = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !words.isEmpty, state != .sending, let client = session.profileClient else { return }
        state = .sending
        Task {
            do {
                try await client.steerActivity(botId: botId, threadId: threadId, text: words)
                text = ""
                state = .sent
                await onSent()
            } catch {
                state = .failed
            }
        }
    }
}

/// One step: its plain name, where it ran, its summary; a sub-agent's step
/// opens to what it was asked, its own steps and what it reported.
private struct BotActivityStepRow: View {
    @Environment(\.themePalette) var themePalette
    let step: BotActivityStep
    var substeps: [BotActivityStep] = []
    @State private var open = false
    @State private var technical = false

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 6) {
                Circle()
                    .fill(step.ok == nil ? Theme.accent : step.ok == true ? Theme.success : Theme.danger)
                    .frame(width: 7, height: 7)
                if BotActivityStepLabel.isSubagent(step) {
                    Button {
                        withAnimation(.snappy(duration: 0.2)) { open.toggle() }
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: open ? "chevron.down" : "chevron.right").font(.system(size: 10, weight: .semibold))
                            Image(systemName: "person.crop.circle.badge.checkmark").foregroundStyle(Theme.accentText)
                            Text(verbatim: BotActivityWording.step(step)).font(Theme.Font.bodyMedium).lineLimit(1)
                            if !substeps.isEmpty { Text(verbatim: "· \(substeps.count)").foregroundStyle(Theme.textSecondary) }
                        }
                        .foregroundStyle(Theme.textPrimary)
                    }
                    .buttonStyle(.plain)
                } else {
                    Text(verbatim: BotActivityWording.step(step))
                        .font(Theme.Font.body)
                        .foregroundStyle(Theme.textPrimary)
                        .lineLimit(1)
                }
                Spacer(minLength: 4)
                if let place = step.where {
                    Label(BotActivityWording.place(place), systemImage: place == .computer ? "laptopcomputer" : "server.rack")
                        .font(Theme.Font.label)
                        .foregroundStyle(Theme.textSecondary)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Theme.inset, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                }
            }
            if let summary = step.summary, !summary.isEmpty {
                Text(verbatim: summary)
                    .font(Theme.Profile.labelFont)
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(2)
            }
            if BotActivityStepLabel.isSubagent(step), open {
                VStack(alignment: .leading, spacing: 4) {
                    if let prompt = step.subagent?.prompt, !prompt.isEmpty {
                        Text("Asked").font(Theme.Font.labelMedium).foregroundStyle(Theme.textSecondary)
                        Text(verbatim: prompt).font(Theme.Font.preview).foregroundStyle(Theme.textPrimary)
                    }
                    if !substeps.isEmpty {
                        Text("Its steps").font(Theme.Font.labelMedium).foregroundStyle(Theme.textSecondary)
                        ForEach(substeps) { child in BotActivityStepRow(step: child) }
                    }
                    Text("Result").font(Theme.Font.labelMedium).foregroundStyle(Theme.textSecondary)
                    if let result = step.subagent?.result, !result.isEmpty {
                        Text(verbatim: result).font(Theme.Font.preview).foregroundStyle(Theme.textPrimary)
                    } else {
                        Text(step.ok == nil ? String(localized: "Working…") : "-").font(Theme.Font.preview).foregroundStyle(Theme.textSecondary)
                    }
                    if step.ok == nil {
                        Text("Claude runs this sub-agent inside the turn: it stops with the turn and takes no message of its own.")
                            .font(Theme.Font.label)
                            .foregroundStyle(Theme.textTertiary)
                    }
                }
                .padding(10)
                .background(Theme.inset, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
            if !BotActivityStepLabel.isSubagent(step) || open {
                DisclosureGroup(isExpanded: $technical) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(verbatim: step.name).font(Theme.Font.code).foregroundStyle(Theme.textPrimary)
                        if let input = step.input, !input.isEmpty {
                            Text(verbatim: input).font(Theme.Font.code).foregroundStyle(Theme.textSecondary).lineLimit(8)
                        }
                    }
                    .textSelection(.enabled)
                } label: {
                    Text("Technical details").font(Theme.Font.label).foregroundStyle(Theme.textTertiary)
                }
            }
        }
        .padding(.vertical, 2)
        .accessibilityIdentifier("activity-step.\(step.id)")
    }
}

// MARK: - Sheet

/// What the Activity card opened: a section's history or one entry.
enum BotActivityRoute: Identifiable, Hashable {
    case history(BotActivityFilter)
    case detail(BotActivityItem)

    var id: String {
        switch self {
        case let .history(filter): "history.\(filter.rawValue)"
        case let .detail(item): "detail.\(item.id)"
        }
    }
}

/// The phone's host for the history and the detail: a sheet with its own
/// navigation, closed by Done (the desktop's modal layers).
struct BotActivitySheet: View {
    @Environment(\.themePalette) var themePalette
    let botId: String
    let route: BotActivityRoute
    let model: BotActivityModel
    let onOpenThread: (String, String) -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                switch route {
                case let .history(filter):
                    BotActivityHistoryView(botId: botId, filter: filter, parent: model)
                case let .detail(item):
                    BotActivityDetailView(item: item, parent: model, onOpenThread: onOpenThread)
                }
            }
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }.accessibilityIdentifier("activity-done")
                }
            }
        }
        .environment(\.botActivityOpenThread, onOpenThread)
    }
}

private struct BotActivityOpenThreadKey: EnvironmentKey {
    static let defaultValue: ((String, String) -> Void)? = nil
}

extension EnvironmentValues {
    /// Open a thread from an activity entry pushed anywhere under the sheet.
    var botActivityOpenThread: ((String, String) -> Void)? {
        get { self[BotActivityOpenThreadKey.self] }
        set { self[BotActivityOpenThreadKey.self] = newValue }
    }
}
