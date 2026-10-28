// "Only when something changes" in the routine editor (#1202): the
// desktop's WatchFields (src/components/routines/WatchFields.tsx) on the
// phone. The three sources (a file or a folder with its subfolders, a
// command, a read-only MCP tool with fixed arguments), the condition,
// when to run, track, the first check, the asleep computer with its cost
// line, and Check now. The draft and its rules are CompanionCore's
// (RoutineWatch.swift). The person sets it on their own bots, no admin.
import CompanionCore
import SwiftUI

struct RoutineWatchSection: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @Binding var draft: RoutineWatchDraft
    let botId: String
    let routineId: String?
    let runOn: String

    @State private var checking = false
    @State private var answer: RoutineWatchCheck?
    @State private var trackExpanded = false

    var body: some View {
        Section {
            Toggle(isOn: binding(\.on)) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Only when something changes")
                    Text("On each due time, Sagax checks without any model turn and starts the run only on a change. At most one check every \(RoutineWatchLimits.minIntervalMinutes) min.")
                        .font(.footnote)
                        .foregroundStyle(Theme.textSecondary)
                }
            }
            .accessibilityIdentifier("routine-watch-on")
            if draft.on {
                sourcePicker
                sourceFields
                Text(whereText)
                    .font(.footnote)
                    .foregroundStyle(Theme.textSecondary)
                    .accessibilityIdentifier("routine-watch-where")
                conditionFields
                if draft.offersTrack { trackFields }
                Picker("First check", selection: binding(\.firstRun)) {
                    Text("Starting point, no run").tag("baseline")
                    Text("Run once with the whole result").tag("wake")
                }
                .accessibilityIdentifier("routine-watch-first-run")
                if draft.offersWhenAsleep {
                    Picker("If the cloud computer is asleep", selection: binding(\.whenAsleep)) {
                        Text("Check only while it is awake").tag("skip")
                        Text("Wake it to check").tag("wake")
                    }
                    .accessibilityIdentifier("routine-watch-when-asleep")
                    if draft.showsWakeCost {
                        Text("Waking it keeps the cloud computer on: it may start for every check (several minutes when it was stopped) and costs its running time.")
                            .font(.footnote)
                            .foregroundStyle(Theme.warning)
                            .accessibilityIdentifier("routine-watch-wake-cost")
                    }
                }
                checkRow
            }
        }
    }

    // MARK: Source

    private var sourcePicker: some View {
        Picker("What to watch", selection: Binding(get: { draft.type }, set: { type in answer = nil; draft.setType(type) })) {
            Text("Files").tag(RoutineWatchSourceType.files)
            Text("Command").tag(RoutineWatchSourceType.command)
            Text("Tool").tag(RoutineWatchSourceType.tool)
        }
        .pickerStyle(.segmented)
        .accessibilityIdentifier("routine-watch-source")
    }

    private var sourceHelp: LocalizedStringKey {
        switch draft.type {
        case .files: "A file or folder of the bot's folder: names, sizes, dates"
        case .command: "Its output, run where the bot works"
        case .tool: "A read tool of a connection, fixed arguments"
        }
    }

    @ViewBuilder private var sourceFields: some View {
        Text(sourceHelp).font(.footnote).foregroundStyle(Theme.textSecondary)
        switch draft.type {
        case .files:
            LabeledContent("File or folder") {
                TextField("reports (empty: the bot's folder)", text: binding(\.path))
                    .multilineTextAlignment(.trailing)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .accessibilityIdentifier("routine-watch-path")
            }
            Toggle("Include subfolders (up to \(RoutineWatchLimits.maxDepth) levels)", isOn: binding(\.recursive))
                .accessibilityIdentifier("routine-watch-recursive")
        case .command:
            VStack(alignment: .leading, spacing: 6) {
                Text("Command").font(.subheadline)
                TextField(String(localized: "Command"), text: binding(\.command), prompt: Text(verbatim: "git status --short"))
                    .font(.body.monospaced())
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .accessibilityIdentifier("routine-watch-command")
            }
        case .tool:
            VStack(alignment: .leading, spacing: 6) {
                Text("Tool (server__tool)").font(.subheadline)
                TextField(String(localized: "Tool (server__tool)"), text: binding(\.tool), prompt: Text(verbatim: "server__search_items"))
                    .font(.body.monospaced())
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .accessibilityIdentifier("routine-watch-tool")
            }
            VStack(alignment: .leading, spacing: 6) {
                Text("Arguments (JSON, fixed)").font(.subheadline)
                TextField(String(localized: "Arguments (JSON, fixed)"), text: binding(\.args), prompt: Text(verbatim: #"{ "status": "open" }"#), axis: .vertical)
                    .lineLimit(3...8)
                    .font(.footnote.monospaced())
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .accessibilityIdentifier("routine-watch-args")
            }
        }
    }

    private var whereText: String {
        switch draft.type {
        case .files:
            return String(localized: "Read where the bot works; .git and node_modules are skipped, at most \(RoutineWatchLimits.maxFiles) entries.")
        case .command:
            return String(localized: "Runs in the bot's folder, where the bot works, with the same access as the routine. At most \(RoutineWatchLimits.timeoutSeconds) s and \(RoutineWatchLimits.maxOutputKB) KB of output.")
        case .tool:
            return String(localized: "Read tools only (search, list, get, query...): a tool that changes or sends something is refused. As the person the routine runs as. At most \(RoutineWatchLimits.timeoutSeconds) s and \(RoutineWatchLimits.maxOutputKB) KB.")
        }
    }

    // MARK: Condition

    private func conditionLabel(_ choice: RoutineWatchConditionChoice) -> LocalizedStringKey {
        switch choice {
        case .none: "None: any change"
        case .jsonPath: draft.type == .files ? "exists, count or bytes" : "A value of the JSON result"
        case .contains: "The text contains"
        case .exitCode: "The exit code"
        }
    }

    private func opLabel(_ op: RoutineWatchOp) -> String {
        let words: String
        switch op {
        case .eq: words = String(localized: "equals")
        case .ne: words = String(localized: "differs from")
        case .gt: words = String(localized: "greater than")
        case .gte: words = String(localized: "at least")
        case .lt: words = String(localized: "less than")
        case .lte: words = String(localized: "at most")
        case .contains: words = String(localized: "contains")
        case .exists: words = String(localized: "exists")
        }
        return "\(op.symbol) \(words)"
    }

    @ViewBuilder private var conditionFields: some View {
        Picker("Condition", selection: binding(\.condition)) {
            ForEach(draft.conditionChoices, id: \.self) { choice in Text(conditionLabel(choice)).tag(choice) }
        }
        .accessibilityIdentifier("routine-watch-condition")
        switch draft.condition {
        case .jsonPath:
            LabeledContent("Path in the result") {
                TextField(draft.type == .files ? "count" : "$.items.length", text: binding(\.conditionPath))
                    .multilineTextAlignment(.trailing)
                    .font(.body.monospaced())
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .accessibilityIdentifier("routine-watch-condition-path")
            }
            Picker("Comparison", selection: binding(\.conditionOp)) {
                ForEach(RoutineWatchOp.allCases, id: \.self) { op in Text(verbatim: opLabel(op)).tag(op) }
            }
            .accessibilityIdentifier("routine-watch-condition-op")
            if draft.conditionOp != .exists {
                LabeledContent("Value") {
                    TextField("", text: binding(\.conditionValue))
                        .multilineTextAlignment(.trailing)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .accessibilityIdentifier("routine-watch-condition-value")
                }
            }
        case .contains:
            Picker("Contains or not", selection: binding(\.containsNegate)) {
                Text("contains").tag(false)
                Text("does not contain").tag(true)
            }
            .accessibilityIdentifier("routine-watch-contains-mode")
            LabeledContent("Text") {
                TextField("", text: binding(\.containsText))
                    .multilineTextAlignment(.trailing)
                    .accessibilityIdentifier("routine-watch-contains-text")
            }
        case .exitCode:
            Picker("Comparison", selection: binding(\.exitOp)) {
                Text("is not").tag("ne")
                Text("is").tag("eq")
            }
            .accessibilityIdentifier("routine-watch-exit-op")
            LabeledContent("Value") {
                TextField("0", text: binding(\.exitValue))
                    .multilineTextAlignment(.trailing)
                    .keyboardType(.numberPad)
                    .accessibilityIdentifier("routine-watch-exit-value")
            }
        case .none:
            EmptyView()
        }
        if draft.condition != .none {
            Picker("routineWatch.run", selection: binding(\.wakeOn)) {
                Text("When it changes and the condition holds").tag("change")
                Text("On every check where the condition holds").tag("match")
            }
            .accessibilityIdentifier("routine-watch-wake-on")
        }
    }

    // MARK: Track

    private var trackFields: some View {
        DisclosureGroup(isExpanded: Binding(
            get: { trackExpanded || !draft.trackItems.isEmpty || !draft.trackKey.isEmpty || !draft.trackFields.isEmpty },
            set: { trackExpanded = $0 }
        )) {
            Text("For a JSON result: the list to compare, the field that names each item, and the fields that count. The run then says what is new, changed or gone.")
                .font(.footnote)
                .foregroundStyle(Theme.textSecondary)
            trackField("List", placeholder: "list: $.items", \.trackItems, id: "routine-watch-track-items")
            trackField("Key field", placeholder: "key: id", \.trackKey, id: "routine-watch-track-key")
            trackField("Fields", placeholder: "fields: status, priority", \.trackFields, id: "routine-watch-track-fields")
        } label: {
            Text("Compare only some items and fields")
        }
        .accessibilityIdentifier("routine-watch-track")
    }

    private func trackField(_ title: LocalizedStringKey, placeholder: LocalizedStringKey, _ key: WritableKeyPath<RoutineWatchDraft, String>, id: String) -> some View {
        LabeledContent(title) {
            TextField(placeholder, text: binding(key))
                .multilineTextAlignment(.trailing)
                .font(.body.monospaced())
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityIdentifier(id)
        }
    }

    // MARK: Check now

    private func problemText(_ problem: RoutineWatchProblem) -> LocalizedStringKey {
        switch problem {
        case .path: "Choose a path inside the bot's folder"
        case .command: "Write the command to run"
        case .tool: "Name the tool to call"
        case .args: "The arguments must be a JSON object"
        case .conditionPath: "Choose the path to test"
        case .contains: "Write the text to look for"
        }
    }

    @ViewBuilder private var checkRow: some View {
        let built = draft.build()
        Button {
            Task { await check() }
        } label: {
            HStack {
                Text(checking ? "Checking..." : "Check now")
                if checking { Spacer(); ProgressView() }
            }
        }
        .disabled(checking || botId.isEmpty || draft.problem != nil)
        .accessibilityIdentifier("routine-watch-check")
        if case let .failure(problem) = built {
            Text(problemText(problem))
                .font(.footnote)
                .foregroundStyle(Theme.danger)
                .accessibilityIdentifier("routine-watch-problem")
        }
        if let answer { answerView(answer) }
    }

    @ViewBuilder private func answerView(_ answer: RoutineWatchCheck) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            switch answer {
            case let .failed(message):
                Text(verbatim: message).foregroundStyle(Theme.danger)
            case let .skipped(reason):
                Text(verbatim: reason).foregroundStyle(Theme.textSecondary)
            case let .read(summary, excerpt, _, condition, ms):
                Text("\(summary) · \(ms) ms, no model").fontWeight(.medium)
                if let condition {
                    Text(condition.holds ? "The condition holds (\(condition.seen))" : "The condition does not hold (\(condition.seen))")
                        .foregroundStyle(condition.holds ? Theme.success : Theme.textSecondary)
                }
                if !excerpt.isEmpty {
                    Text(verbatim: excerpt)
                        .font(.caption.monospaced())
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(12)
                        .textSelection(.enabled)
                }
            }
        }
        .font(.footnote)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("routine-watch-answer")
    }

    private func check() async {
        guard case let .success(.some(watch)) = draft.build(), let client = session.profileClient else { return }
        checking = true
        defer { checking = false }
        do {
            answer = try await client.checkRoutineWatch(botId: botId, watch: watch, routineId: routineId, runOn: runOn)
        } catch {
            answer = .failed(error.localizedDescription)
        }
    }

    // MARK: Parts

    /// A field of the draft; a change clears the last answer, as on the desktop.
    private func binding<Value>(_ key: WritableKeyPath<RoutineWatchDraft, Value>) -> Binding<Value> {
        Binding(get: { draft[keyPath: key] }, set: { value in answer = nil; draft[keyPath: key] = value })
    }
}
