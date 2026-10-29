// The routine editor (matrix AU11-AU14), with the desktop's fields:
// routine type (bot task or team goal), every Repeat choice (once, every
// hour, day, weekday, certain days, month or year at one or more times in a
// named zone, every N minutes or hours with days, hours and an end date; a
// schedule none of these can say stays under Advanced), the run limit,
// overlap, duration, the results thread and attachments. Desktop: EventEditor
// in src/components/RoutineCalendarPage.tsx (shared/schedule-model.ts),
// routines/ResultsDestination.tsx. The rules are RoutineScheduleForm and
// RoutinePatch (CompanionCore): an edit sends only what changed, so a field
// set elsewhere is never lost (S3).
import CompanionCore
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// What a new routine starts with when it comes from a calendar slot.
struct RoutineEditorSeed: Hashable {
    var at: Date
    var name = ""
    var prompt = ""
    var botId: String?
}

struct RoutineEditorView: View {
    @Environment(\.themePalette) var themePalette
    let routine: Routine?
    let onSaved: () async -> Void

    @EnvironmentObject private var session: Session
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var threadPrefs = SidebarPrefsModel.shared
    @State private var name: String
    @State private var prompt: String
    @State private var botId: String
    @State private var target: String
    @State private var groupId: String
    @State private var runOn: RoutineRunLocation
    @State private var runAvailability: RoutineRunAvailability?
    @State private var availabilityLoaded = false
    @State private var form: RoutineScheduleForm
    @State private var duration: Int
    @State private var timeoutMinutes: Int?
    @State private var intervalTimeoutDefaultApplied: Bool
    @State private var overlap: String
    @State private var results: RoutineResultsDestination
    @State private var attachments: [RoutineAttachment]
    @State private var attaching = 0
    @State private var photoItems: [PhotosPickerItem] = []
    @State private var choosingFile = false
    @State private var advancedExpanded: Bool
    @State private var saving = false
    /// Organization server: whom the routine may run as (RunAsField), and
    /// the person chosen here (nil: the routine's current person).
    @State private var runAsOptions: RoutineRunAsOptions?
    @State private var runAs: String?
    @State private var onlyWhenPresent: Bool
    @State private var postResults: Bool
    /// 2026-10-26: failed runs in a row that pause it (0 never).
    @State private var autoPauseAfter: Int
    /// #1202 "Only when something changes": the draft, and the one it opened
    /// with (an untouched watch is never sent).
    @State private var watchDraft: RoutineWatchDraft
    private let initialWatch: RoutineWatchDraft

    /// `presetBotId`: a new routine made from a bot's profile starts on that bot.
    /// `seed`: a new routine from the Automations calendar ("More options"
    /// of a slot) starts at that slot with what was typed there.
    /// `copyOf` (Duplicate, 2026-10-29): a new routine with every setting of
    /// that one, named "<name> (copy)"; saving creates it.
    init(routine: Routine?, presetBotId: String? = nil, seed: RoutineEditorSeed? = nil, copyOf: Routine? = nil, onSaved: @escaping () async -> Void) {
        self.routine = routine
        self.onSaved = onSaved
        let source = routine ?? copyOf
        _name = State(initialValue: routine?.name ?? copyOf.map { String(localized: "\($0.name) (copy)") } ?? seed?.name ?? "")
        _prompt = State(initialValue: source?.prompt ?? seed?.prompt ?? "")
        _botId = State(initialValue: source?.botId ?? seed?.botId ?? presetBotId ?? "")
        _target = State(initialValue: source?.target ?? "bot")
        _groupId = State(initialValue: source?.groupId ?? "")
        _runOn = State(initialValue: source?.runLocation ?? .maus)
        let seedAt = source?.nextRunAt.map { Date(timeIntervalSince1970: $0 / 1_000) } ?? seed?.at ?? RoutineScheduleForm.nextHour()
        _form = State(initialValue: RoutineScheduleForm(schedule: source?.schedule, seedAt: seedAt))
        _duration = State(initialValue: source?.durationMinutes ?? 30)
        _timeoutMinutes = State(initialValue: source?.timeoutMinutes)
        _intervalTimeoutDefaultApplied = State(initialValue: source != nil)
        _overlap = State(initialValue: source?.overlap ?? "skip")
        _results = State(initialValue: routine == nil ? .newThread : .keep)
        _attachments = State(initialValue: source?.target == "room-goal" ? [] : source?.attachments ?? [])
        _advancedExpanded = State(initialValue: false)
        _onlyWhenPresent = State(initialValue: source?.onlyWhenPresent == true)
        // Default silent for a new routine; an existing one keeps its choice.
        _postResults = State(initialValue: source?.postResults == true)
        _autoPauseAfter = State(initialValue: source.map(RoutineAutoPause.after) ?? RoutineAutoPause.defaultAfter)
        let watch = RoutineWatchDraft(precheck: source?.precheck)
        initialWatch = watch
        _watchDraft = State(initialValue: watch)
    }

    private var advanced: Bool { session.surfaceGate.allows(.routineAdvancedEditor) }
    private var isTeamGoal: Bool { target == "room-goal" }
    /// As on the desktop: a bot routine that repeats.
    private var watchAllowed: Bool { RoutineWatchRules.allowed(target: target, repeats: form.recurrence != .none) }
    private var watchSection: some View {
        RoutineWatchSection(draft: $watchDraft, botId: botId, routineId: routine?.id,
                            runOn: isTeamGoal ? RoutineRunLocation.maus.rawValue : runOn.rawValue)
    }
    /// DEBUG captures only (`-parityRoutineWatchFirst YES`): the section on
    /// top, so a headless screenshot shows it without scrolling.
    private var watchFirst: Bool {
#if DEBUG
        UserDefaults.standard.bool(forKey: "parityRoutineWatchFirst")
#else
        false
#endif
    }
    /// DEBUG captures only (`-parityRoutineScheduleFirst YES`): the schedule
    /// on top, so a headless screenshot shows it without scrolling.
    private var scheduleFirst: Bool {
#if DEBUG
        UserDefaults.standard.bool(forKey: "parityRoutineScheduleFirst")
#else
        false
#endif
    }
    private var watchEdit: Result<RoutineWatchEdit, RoutineWatchProblem> {
        RoutineWatchRules.edit(original: routine?.precheck, initial: initialWatch, draft: watchDraft, allowed: watchAllowed)
    }
    private var bots: [Bot] { session.state.bots.filter { $0.hidden != true } }
    private var rooms: [Room] { RoutineTeamGoal.rooms(session.state.rooms) }
    private var room: Room? { rooms.first { $0.id == groupId } }
    private var roomMembers: [Bot] { RoutineTeamGoal.members(of: room, bots: session.state.bots) }

    var body: some View {
        NavigationStack {
            ThemedForm {
                if watchFirst && watchAllowed { watchSection }
                if scheduleFirst { scheduleSection }
                if advanced { typeSection }
                workSection
                if advanced && !isTeamGoal { resultsSection }
                if RoutineRunAsField.shown(runAsOptions) { runAsSection }
                runOnSection
                if !scheduleFirst { scheduleSection }
                advancedSection
                if watchAllowed && !watchFirst { watchSection }
                if advanced && session.surfaceGate.allows(.routineAttachments) { attachmentsSection }
            }
            .navigationTitle(routine == nil ? "New routine" : "Edit routine")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saveLabel) { Task { await save() } }
                        .disabled(saving || attaching > 0 || !valid)
                        .accessibilityIdentifier("routine-editor-save")
                }
            }
            .onAppear { if botId.isEmpty { botId = bots.first?.id ?? "" } }
            .onValueChange(of: photoItems) { items in
                guard !items.isEmpty else { return }
                Task { await importPhotos(items) }
            }
            .fileImporter(isPresented: $choosingFile, allowedContentTypes: [.content], allowsMultipleSelection: true) { result in
                Task { await importFiles(result) }
            }
            .task {
                runAvailability = await session.loadRoutineRunAvailability()
                availabilityLoaded = true
            }
            // asked again when the bot, the routine type or the room changes
            .task(id: "\(botId)|\(target)|\(groupId)") { await loadRunAsOptions() }
        }
    }

    // MARK: Runs as (organization server)

    private func loadRunAsOptions() async {
        guard !botId.isEmpty, let client = session.callClient else { runAsOptions = nil; return }
        let options = try? await client.routineRunAsOptions(
            botId: botId,
            routineId: routine?.id,
            target: target,
            groupId: isTeamGoal && !groupId.isEmpty ? groupId : nil
        )
        guard !Task.isCancelled else { return }
        runAsOptions = options
        // a person who cannot run the newly chosen bot is no longer the choice
        runAs = RoutineRunAsField.keep(runAs, in: options)
    }

    @ViewBuilder
    private var runAsSection: some View {
        if let options = runAsOptions {
            let chosen = RoutineRunAsField.chosen(options, selected: runAs)
            let name = chosen.map(RoutineRunAsField.name) ?? ""
            Section {
                if options.canChoose {
                    NavigationLink {
                        RoutineRunAsPicker(options: options, selected: $runAs)
                    } label: {
                        HStack(spacing: 10) {
                            PersonAvatar(initials: People.initials(name.isEmpty ? "?" : name), size: 24, avatarUrl: chosen?.avatarUrl)
                            Text("Runs as")
                            Spacer(minLength: 8)
                            Text(verbatim: name).foregroundStyle(Theme.textSecondary).lineLimit(1)
                        }
                    }
                    .accessibilityIdentifier("routine-editor-run-as")
                } else {
                    HStack(spacing: 10) {
                        PersonAvatar(initials: People.initials(name.isEmpty ? "?" : name), size: 24, avatarUrl: chosen?.avatarUrl)
                        Text(String(localized: "Runs as \(name)")).lineLimit(1)
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("routine-editor-run-as-line")
                }
                if chosen?.pending == true {
                    Text(String(localized: "Will run once \(name) signs in"))
                        .font(.footnote)
                        .foregroundStyle(Theme.textSecondary)
                        .accessibilityIdentifier("routine-editor-run-as-pending")
                }
            } footer: {
                if options.canChoose {
                    Text("The routine acts with this person's access and their rights on the bot. Every change is recorded in the admin activity log.")
                }
            }
        }
    }

    // MARK: Sections

    private var typeSection: some View {
        Section {
            Picker(String(localized: "Routine type"), selection: Binding(get: { target }, set: selectTarget)) {
                Text("Bot task").tag("bot")
                Text("Team goal").tag("room-goal")
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("routine-editor-type")
        } header: {
            Text("Routine type")
        } footer: {
            Text(isTeamGoal ? "A lead coordinates the group until the goal settles." : "One bot owns and completes each run.")
        }
    }

    @ViewBuilder
    private var workSection: some View {
        Section("Work") {
            TextField("Routine name", text: $name)
                .accessibilityIdentifier("routine-editor-name")
            if isTeamGoal {
                if rooms.isEmpty {
                    Text("Create a group from the sidebar first, then come back to schedule its goal.")
                        .font(.footnote).foregroundStyle(Theme.textSecondary)
                } else {
                    Picker(String(localized: "Choose a group"), selection: Binding(get: { groupId }, set: selectRoom)) {
                        Text("Select a group").tag("")
                        ForEach(rooms) { room in Text(verbatim: room.name).tag(room.id) }
                    }
                    .accessibilityIdentifier("routine-editor-group")
                }
                if room != nil {
                    if roomMembers.isEmpty {
                        Text("This group has no active members. Add or restore a bot before scheduling the goal.")
                            .font(.footnote).foregroundStyle(Theme.warning)
                    } else {
                        Picker(String(localized: "Choose the lead"), selection: $botId) {
                            ForEach(roomMembers) { bot in Text(verbatim: bot.name).tag(bot.id) }
                        }
                        .accessibilityIdentifier("routine-editor-lead")
                    }
                }
            } else {
                Picker("Agent", selection: Binding(get: { botId }, set: selectBot)) {
                    Text("Choose an agent").tag("")
                    ForEach(bots) { bot in Text(bot.name).tag(bot.id) }
                }
            }
            // the markdown editor (desktop RoutineCalendarPage EventEditor, #258)
            MarkdownEditor(
                text: $prompt,
                placeholder: isTeamGoal ? String(localized: "What should the team accomplish?") : String(localized: "What should the agent do?"),
                minHeight: 140, accessibilityLabel: String(localized: "Instructions"), identifier: "routine-editor-prompt"
            )
        }
    }

    private var resultsSection: some View {
        let bot = session.state.bot(botId)
        return Section {
            Picker(String(localized: "Post results to"), selection: $results) {
                if routine != nil { Text("Keep current destination").tag(RoutineResultsDestination.keep) }
                Text("The bot's main thread").tag(RoutineResultsDestination.newThread)
                // One conversation (threads hidden): the main thread is the
                // only destination the person can see, so it is the only one.
                if threadPrefs.threads.shown {
                    if RoutineResults.isMissing(results, bot: bot) {
                        Text("Thread unavailable. Choose another").tag(results).rowSelectionDisabled()
                    }
                    ForEach(RoutineResults.groups(for: bot), id: \.self) { group in
                        Section(group.folder ?? String(localized: "No folder")) {
                            ForEach(group.threads, id: \.threadId) { thread in
                                Text(verbatim: thread.title).tag(RoutineResultsDestination.thread(thread.threadId))
                            }
                        }
                    }
                }
            }
            .disabled(bot == nil)
            .accessibilityIdentifier("routine-editor-results")
        } footer: {
            if threadPrefs.threads.shown {
                Text("Each run starts with fresh context. Dated results collect in the bot's main thread unless you choose another; full execution details stay in Run logs.")
            } else {
                Text("Each run starts with fresh context. Dated results collect in the bot's main thread; full execution details stay in Run logs.")
            }
        }
    }

    @ViewBuilder
    private var runOnSection: some View {
        if isTeamGoal {
            Section {
                Label("Runs on this computer", systemImage: "scope")
            } footer: {
                Text("Sagax keeps the group and its member hand-offs together for the full goal.")
            }
        } else {
            Section {
                Picker("Run location", selection: $runOn) {
                    Label("This computer", systemImage: "laptopcomputer")
                        .tag(RoutineRunLocation.maus)
                    Label("Cloud VM", systemImage: "cloud")
                        .tag(RoutineRunLocation.cloud)
                        .rowSelectionDisabled(!cloudSelectable)
                }
                .pickerStyle(.inline)

                if !availabilityLoaded {
                    ProgressView("Checking Cloud VM availability…")
                } else if runAvailability == nil {
                    Label("Cloud VM status is unavailable", systemImage: "exclamationmark.triangle")
                        .foregroundStyle(Theme.textSecondary)
                }
            } header: {
                Text("Where does it run?")
            } footer: {
                if runOn == .maus {
                    Text("Uses this agent's selected model and computer setting on the paired computer.")
                } else if runAvailability?.cloudReady == true {
                    Text("Runs the agent and its tools inside its Boat virtual machine. The VM wakes automatically for each run; keep Sagax running so its scheduler can launch the job.")
                } else {
                    Text("This existing Cloud VM choice is preserved, but it cannot run until the paired computer has a configured Boat API key and an available Boat agent.")
                }
            }
        }
    }

    private var scheduleSection: some View {
        Section {
            Picker("Repeats", selection: Binding(get: { form.recurrence }, set: selectRecurrence)) {
                Text("Does not repeat").tag(RoutineRecurrence.none)
                Text("Every hour").tag(RoutineRecurrence.hourly)
                Text("Every day").tag(RoutineRecurrence.daily)
                Text("Weekdays").tag(RoutineRecurrence.weekdays)
                Text("Certain days").tag(RoutineRecurrence.days)
                Text("Every month").tag(RoutineRecurrence.monthly)
                Text("Every year").tag(RoutineRecurrence.yearly)
                Text("Every N minutes or hours").tag(RoutineRecurrence.interval)
                if form.recurrence == .advanced {
                    Text("Advanced").tag(RoutineRecurrence.advanced)
                }
            }
            .accessibilityIdentifier("routine-editor-repeat")
            RoutineScheduleFields(form: $form)
            if form.recurrence != .none { RoutineTimingFields(form: $form) }
            if !isTeamGoal {
                Toggle(isOn: $onlyWhenPresent) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Only when I'm here")
                        Text("While you are away (computer idle or locked), this routine skips its runs and tells you how many when you are back. A one-time routine waits for you.")
                            .font(.footnote)
                            .foregroundStyle(Theme.textSecondary)
                    }
                }
                .accessibilityIdentifier("routine-editor-only-when-present")
                Toggle(isOn: $postResults) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Post results in the conversation")
                        Text("When on, this routine posts its result as a message in the conversation. When off, it runs in the background and the result stays in Automations. Questions, approvals and errors always reach you, and the routine's instructions are never posted.")
                            .font(.footnote)
                            .foregroundStyle(Theme.textSecondary)
                    }
                }
                .accessibilityIdentifier("routine-editor-post-results")
            }
            if let problem = form.problem {
                Text(verbatim: RoutineEditorWording.problem(problem))
                    .font(.footnote)
                    .foregroundStyle(Theme.danger)
                    .accessibilityIdentifier("routine-editor-problem")
            }
        } header: {
            Text("Schedule")
        } footer: {
            VStack(alignment: .leading, spacing: 6) {
                if form.recurrence == .interval {
                    Text(overlap == "queue" ? "Keep one scheduled run waiting until this routine finishes. Skip further occurrences until it starts. Manual runs are separate." : "Skip scheduled occurrences while this routine is working. Manual runs are separate.")
                }
                Text("Runs while Sagax is open on this computer: it cannot wake a sleeping Mac. A run missed by less than 12 hours still happens when the app is back; for 24/7, run Sagax on a VPS.")
            }
        }
    }

    private var advancedSection: some View {
        Section {
            DisclosureGroup(isExpanded: $advancedExpanded) {
                Picker("Stop if still running after", selection: $timeoutMinutes) {
                    Text("No limit").tag(nil as Int?)
                    ForEach(RoutineDurations.options, id: \.self) { minutes in
                        Text(RoutineDurations.label(minutes)).tag(Optional(minutes))
                    }
                }
                .accessibilityIdentifier("routine-editor-timeout")
                if advanced && form.recurrence != .none {
                    Picker(String(localized: "If the previous run is still working"), selection: $overlap) {
                        Text("Skip this occurrence").tag("skip")
                        Text("Queue one run").tag("queue")
                    }
                    .accessibilityIdentifier("routine-editor-overlap")
                }
                // the person's own choice for their routine, no admin
                if form.recurrence != .none {
                    Picker(String(localized: "Pause automatically"), selection: $autoPauseAfter) {
                        ForEach(RoutineAutoPause.choices(keeping: autoPauseAfter), id: \.self) { count in
                            Text(verbatim: RoutineWording.autoPauseOption(count)).tag(count)
                        }
                    }
                    .accessibilityIdentifier("routine-editor-auto-pause")
                }
                if advanced {
                    Picker(String(localized: "Duration"), selection: $duration) {
                        ForEach(Set(RoutineDurations.options + [duration]).sorted(), id: \.self) { minutes in
                            Text(RoutineDurations.label(minutes)).tag(minutes)
                        }
                    }
                    .accessibilityIdentifier("routine-editor-duration")
                }
            } label: {
                timeoutMinutes.map { Text("Advanced · \(RoutineDurations.label($0)) run limit") } ?? Text("Advanced · no run limit")
            }
            .accessibilityIdentifier("routine-editor-advanced")
        } footer: {
            if advancedExpanded {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Optional. The clock starts when work actually begins and does not control how often the routine starts.")
                    if advanced && form.recurrence != .none {
                        Text(overlap == "queue" ? "Keep one scheduled run waiting until this routine finishes. Skip further occurrences until it starts. Manual runs are separate." : "Skip scheduled occurrences while this routine is working. Manual runs are separate.")
                    }
                    if advanced { Text("Duration is how long the routine fills on the calendar.") }
                    if form.recurrence != .none {
                        Text("When this many runs fail in a row, the routine pauses itself and tells you. Resume turns it back on and starts the count again. Failed runs stay in the history.")
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var attachmentsSection: some View {
        if isTeamGoal {
            Section {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Use the group’s shared context").font(.subheadline.weight(.medium))
                    Text("Team goals cannot carry routine attachments. Put shared context in the goal instructions or the group instructions.")
                        .font(.footnote).foregroundStyle(Theme.textSecondary)
                }
            } header: {
                Text("Attachments")
            }
        } else {
            Section {
                ForEach(attachments, id: \.id) { attachment in
                    Label(attachment.name, systemImage: attachment.kind == "image" ? "photo" : "doc.text")
                        .lineLimit(1)
                        .swipeActions {
                            Button(String(localized: "Remove"), role: .destructive) { remove(attachment) }
                        }
                        .contextMenu {
                            Button(String(localized: "Remove \(attachment.name)"), systemImage: "xmark", role: .destructive) { remove(attachment) }
                        }
                        .accessibilityIdentifier("routine-editor-attachment.\(attachment.name)")
                }
                if attaching > 0 {
                    ProgressView(String(localized: "Attaching…"))
                }
                if attachments.count < 20 {
                    Menu {
                        PhotosPicker(selection: $photoItems, maxSelectionCount: 20 - attachments.count, matching: .images) {
                            Label("Photo Library", systemImage: "photo.on.rectangle")
                        }
                        Button(String(localized: "Choose File"), systemImage: "doc") { choosingFile = true }
                    } label: {
                        Label("Add attachment", systemImage: "paperclip")
                    }
                    .accessibilityIdentifier("routine-editor-add-attachment")
                }
            } header: {
                Text("Attachments")
            } footer: {
                Text("Attachments are passed to each local routine run and excluded from shared team files.")
            }
        }
    }

    // MARK: Changes (the desktop's handlers)

    private func selectBot(_ id: String) {
        // Another bot has other threads: results go to a new one (`selectBots`).
        if id != botId { results = .newThread }
        botId = id
    }

    private func selectTarget(_ next: String) {
        target = next
        guard next == "room-goal" else {
            groupId = ""
            return
        }
        runOn = .maus
        attachments = []
        let chosen = room ?? rooms.first
        groupId = chosen?.id ?? ""
        selectBot(RoutineTeamGoal.preferredLead(of: chosen, bots: session.state.bots, preferredId: botId)?.id ?? "")
    }

    private func selectRoom(_ id: String) {
        groupId = id
        let chosen = rooms.first { $0.id == id }
        selectBot(RoutineTeamGoal.preferredLead(of: chosen, bots: session.state.bots, preferredId: botId)?.id ?? "")
    }

    private func selectRecurrence(_ choice: RoutineRecurrence) {
        if choice == .interval && !intervalTimeoutDefaultApplied {
            timeoutMinutes = timeoutMinutes ?? 30
            intervalTimeoutDefaultApplied = true
        }
        form.select(choice)
    }

    private func remove(_ attachment: RoutineAttachment) {
        attachments.removeAll { $0.id == attachment.id }
    }

    private func added(_ attachment: RoutineAttachment?) {
        guard let attachment else { return }
        attachments = Array((attachments + [attachment]).prefix(20))
        if runOn == .cloud { runOn = .maus }
    }

    private func importPhotos(_ items: [PhotosPickerItem]) async {
        attaching += 1
        defer { attaching -= 1; photoItems = [] }
        for (index, item) in items.enumerated() {
            guard let data = try? await item.loadTransferable(type: Data.self) else { continue }
            let type = item.supportedContentTypes.first { $0.conforms(to: .image) }
            let mime = type?.preferredMIMEType ?? "image/jpeg"
            let ext = type?.preferredFilenameExtension ?? "jpg"
            let name = items.count == 1 ? "Photo.\(ext)" : "Photo \(index + 1).\(ext)"
            added(await session.uploadRoutineAttachment(data: data, name: name, mime: mime, image: AttachmentPolicy.imageMIMETypes.contains(mime)))
        }
    }

    private func importFiles(_ result: Result<[URL], Error>) async {
        guard case let .success(urls) = result else { return }
        attaching += 1
        defer { attaching -= 1 }
        for url in urls {
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            guard let data = try? Data(contentsOf: url) else { continue }
            let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
            added(await session.uploadRoutineAttachment(data: data, name: url.lastPathComponent, mime: mime, image: false))
        }
    }

    // MARK: Saving

    private var cloudSelectable: Bool {
        attachments.isEmpty && (runAvailability?.canSelect(.cloud, preserving: runOn) ?? (runOn == .cloud))
    }

    private var saveLabel: LocalizedStringKey {
        if routine != nil { return "Save" }
        return isTeamGoal ? "Schedule team goal" : "Schedule routine"
    }

    private var valid: Bool {
        guard !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !botId.isEmpty, form.isValid
        else { return false }
        if isTeamGoal { return !groupId.isEmpty && roomMembers.contains { $0.id == botId } }
        if case .failure = watchEdit { return false }
        return true
    }

    private func save() async {
        saving = true
        defer { saving = false }
        let schedule: RoutineSchedule
        do { schedule = try form.schedule(savedAt: Date()) }
        catch { session.actionError = error.localizedDescription; return }
        var input = RoutineInput(
            name: String(name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(80)),
            prompt: String(prompt.trimmingCharacters(in: .whitespacesAndNewlines).prefix(20_000)),
            botId: botId,
            runOn: isTeamGoal ? RoutineRunLocation.maus.rawValue : runOn.rawValue,
            enabled: routine == nil ? true : nil,
            schedule: schedule, durationMinutes: duration,
            timeoutMinutes: timeoutMinutes, clearTimeout: timeoutMinutes == nil,
            target: advanced ? target : nil,
            groupId: isTeamGoal ? groupId : nil,
            overlap: advanced ? overlap : nil,
            attachments: advanced ? (isTeamGoal ? [] : attachments) : nil,
            results: advanced && !isTeamGoal ? results : .keep,
            completeSchedule: true
        )
        input.runAs = RoutineRunAsField.toSend(runAs, options: runAsOptions)
        if !isTeamGoal {
            input.onlyWhenPresent = onlyWhenPresent
            input.postResults = postResults
        }
        if form.recurrence != .none { input.autoPauseAfter = autoPauseAfter }
        if case let .success(edit) = watchEdit { input.watch = edit }
        if await session.saveRoutine(input, original: routine) != nil {
            await onSaved()
            dismiss()
        }
    }
}

// MARK: - Timing (RoutineTimingFields.tsx)

/// "Timing" under Repeat, for a repeating routine: Exact starts at the
/// scheduled time; Flexible starts somewhere between Early minutes before
/// and Late minutes after it.
struct RoutineTimingFields: View {
    @Environment(\.themePalette) var themePalette
    @Binding var form: RoutineScheduleForm

    var body: some View {
        Picker("Timing", selection: $form.timing) {
            Text("Exact").tag(RoutineTimingMode.exact)
            Text("Flexible").tag(RoutineTimingMode.flexible)
        }
        .accessibilityIdentifier("routine-editor-timing")
        if form.timing == .flexible {
            minutesField("Early", value: $form.earlyMinutes, label: "Early window minutes", id: "routine-editor-timing-early")
            minutesField("Late", value: $form.lateMinutes, label: "Late window minutes", id: "routine-editor-timing-late")
            Text("0 late means ready by the scheduled time.")
                .font(.footnote)
                .foregroundStyle(Theme.textSecondary)
        }
    }

    private func minutesField(_ title: LocalizedStringKey, value: Binding<Int>, label: LocalizedStringKey, id: String) -> some View {
        HStack {
            Text(title)
            Spacer(minLength: 8)
            TextField("0", value: Binding(get: { value.wrappedValue }, set: { value.wrappedValue = max(0, $0) }), format: .number)
                .keyboardType(.numberPad)
                .multilineTextAlignment(.trailing)
                .frame(minWidth: 56)
                .accessibilityLabel(Text(label))
                .accessibilityIdentifier(id)
            Text("min").foregroundStyle(Theme.textSecondary)
        }
    }
}

// MARK: - Schedule fields

/// The fields under Repeat, for whichever choice is made. Binds to the form
/// so any host shows the same thing.
struct RoutineScheduleFields: View {
    @Environment(\.themePalette) var themePalette
    @Binding var form: RoutineScheduleForm

    var body: some View {
        switch form.recurrence {
        case .none:
            DatePicker("Starts", selection: $form.at, in: Date()...)
                .accessibilityIdentifier("routine-editor-starts")
        case .interval:
            intervalFields
            if form.preview != nil { previewRows }
        case .hourly:
            Picker("At minute", selection: model(\.minute)) {
                ForEach(0..<60, id: \.self) { minute in
                    Text(verbatim: String(format: ":%02d", minute)).tag(minute)
                }
            }
            .accessibilityIdentifier("routine-editor-minute")
            zoneAndPreview
        case .daily, .weekdays, .days, .monthly, .yearly:
            if form.recurrence == .days {
                RoutineDayChips(selected: form.model.weekdays, idPrefix: "routine-editor-day") { day in form.toggleModelWeekday(day) }
            }
            if form.recurrence == .yearly {
                Picker("Month", selection: model(\.month)) {
                    ForEach(1...12, id: \.self) { month in
                        Text(verbatim: Calendar.current.standaloneMonthSymbols[month - 1].capitalized).tag(month)
                    }
                }
                .accessibilityIdentifier("routine-editor-month")
            }
            if form.recurrence == .monthly || form.recurrence == .yearly {
                Picker("Day of month", selection: monthDay) {
                    ForEach(1...31, id: \.self) { day in Text(verbatim: String(day)).tag(RoutineMonthDay.day(day)) }
                    if form.recurrence == .monthly { Text("Last day").tag(RoutineMonthDay.last) }
                }
                .accessibilityIdentifier("routine-editor-day-of-month")
            }
            timeRows
            if form.recurrence == .monthly, case let .day(day) = form.model.monthDay, day > 28 {
                Text("Months without this date are skipped. Choose Last day to always use the end of the month.")
                    .font(.caption).foregroundStyle(Theme.textSecondary)
            }
            zoneAndPreview
        case .advanced:
            previewRows
            Button("Choose a simple schedule") { form.chooseSimpleSchedule() }
                .accessibilityIdentifier("routine-editor-simple-schedule")
        }
    }

    /// One row per time ("+ Add a time", a remove button past the first).
    @ViewBuilder
    private var timeRows: some View {
        ForEach(Array(form.model.times.enumerated()), id: \.offset) { index, _ in
            HStack {
                DatePicker(index == 0 ? "Time" : "And at", selection: time(index), displayedComponents: .hourAndMinute)
                    .accessibilityIdentifier("routine-editor-time.\(index)")
                if form.model.times.count > 1 {
                    Button(role: .destructive) { form.removeTime(at: index) } label: {
                        Image(systemName: "minus.circle.fill")
                    }
                    .buttonStyle(.borderless)
                    .foregroundStyle(Theme.danger)
                    .accessibilityLabel(Text("Remove this time"))
                    .accessibilityIdentifier("routine-editor-remove-time.\(index)")
                }
            }
        }
        Button { form.addTime() } label: {
            Label("Add a time", systemImage: "plus")
        }
        .accessibilityIdentifier("routine-editor-add-time")
    }

    @ViewBuilder
    private var zoneAndPreview: some View {
        NavigationLink {
            RoutineTimeZonePicker(selected: $form.timeZone)
        } label: {
            LabeledContent("Time zone") {
                Text(verbatim: RoutineScheduleModel.timeZoneCity(form.timeZone))
            }
        }
        .accessibilityIdentifier("routine-editor-time-zone")
        previewRows
    }

    /// The schedule in words with its zone, then its next three runs.
    @ViewBuilder
    private var previewRows: some View {
        if let value = form.preview, let expression = value.expression {
            VStack(alignment: .leading, spacing: 3) {
                Text(verbatim: RoutineWording.summary(.cron(expression: expression, timeZone: value.timeZone)))
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Theme.textPrimary)
                    .accessibilityIdentifier("routine-editor-summary")
                if !value.runs.isEmpty {
                    Text("Next runs").font(.caption.weight(.medium)).padding(.top, 4)
                    ForEach(value.runs, id: \.self) { at in
                        Text(verbatim: RoutineEditorWording.run(at, zone: value.timeZone)).font(.caption)
                    }
                    Text("Clock changes: skipped times shift forward; repeated times run once.").font(.caption2)
                }
            }
            .foregroundStyle(Theme.textSecondary)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("routine-editor-next-runs")
        }
    }

    @ViewBuilder
    private var intervalFields: some View {
        let presets = form.intervalUnit == .hours ? RoutineScheduleForm.intervalHourPresets : RoutineScheduleForm.intervalPresets
        Picker("Unit", selection: Binding(get: { form.intervalUnit }, set: { form.selectIntervalUnit($0) })) {
            Text("Minutes").tag(RoutineScheduleEveryUnit.minutes)
            Text("Hours").tag(RoutineScheduleEveryUnit.hours)
        }
        .pickerStyle(.segmented)
        .accessibilityIdentifier("routine-editor-interval-unit")
        Picker("Runs every", selection: Binding(
            get: { presets.contains(form.intervalCount ?? -1) ? form.intervalCount ?? 0 : 0 },
            set: { form.setIntervalCount($0 == 0 ? nil : $0) }
        )) {
            ForEach(presets, id: \.self) { count in
                if form.intervalUnit == .hours && count == 1 {
                    Text("1 hour").tag(count)
                } else if form.intervalUnit == .hours {
                    Text("\(count) hours").tag(count)
                } else {
                    Text("\(count) minutes").tag(count)
                }
            }
            Text("Custom…").tag(0)
        }
        .accessibilityIdentifier("routine-editor-interval")
        if !presets.contains(form.intervalCount ?? -1) {
            HStack {
                Text("Set the interval to")
                TextField(form.intervalUnit == .hours ? "1–24" : "5–1,440", value: Binding(
                    get: { form.intervalCount }, set: { form.setIntervalCount($0) }
                ), format: .number)
                    .keyboardType(.numberPad)
                    .multilineTextAlignment(.trailing)
                    .frame(minWidth: 72)
                    .accessibilityLabel(form.intervalUnit == .hours ? Text("Custom interval in hours") : Text("Custom interval in minutes"))
                    .accessibilityIdentifier("routine-editor-interval-custom")
                (form.intervalUnit == .hours ? Text("hours") : Text("minutes")).foregroundStyle(Theme.textSecondary)
            }
        }
        Picker("On", selection: Binding(get: { form.intervalDays }, set: { form.selectIntervalDays($0) })) {
            Text("Every day").tag(RoutineIntervalDays.everyDay)
            Text("Weekdays").tag(RoutineIntervalDays.weekdays)
            Text("Custom…").tag(RoutineIntervalDays.custom)
        }
        .accessibilityIdentifier("routine-editor-interval-days")
        if form.intervalDays == .custom {
            RoutineDayChips(selected: form.intervalWeekdays, idPrefix: "routine-editor-interval-day") { form.toggleIntervalWeekday($0) }
        }
        Picker("During", selection: $form.windowCustom) {
            Text("All day").tag(false)
            Text("Custom hours…").tag(true)
        }
        .accessibilityIdentifier("routine-editor-window")
        if form.windowCustom {
            DatePicker("Run between", selection: clock(\.windowStart), displayedComponents: .hourAndMinute)
                .accessibilityIdentifier("routine-editor-window-start")
            DatePicker("and", selection: clock(\.windowEnd), displayedComponents: .hourAndMinute)
                .accessibilityIdentifier("routine-editor-window-end")
        }
        Picker("Ends", selection: $form.endsOnDate) {
            Text("Never").tag(false)
            Text("On a date…").tag(true)
        }
        .accessibilityIdentifier("routine-editor-ends")
        if form.endsOnDate {
            DatePicker("Stop scheduling after", selection: $form.endDate, displayedComponents: .date)
                .accessibilityIdentifier("routine-editor-end-date")
        }
    }

    private func model<Value>(_ key: WritableKeyPath<RoutineScheduleModel, Value>) -> Binding<Value> {
        Binding(get: { form.model[keyPath: key] }, set: { form.model[keyPath: key] = $0 })
    }

    private var monthDay: Binding<RoutineMonthDay> {
        Binding(
            get: {
                if form.recurrence == .yearly, form.model.monthDay == .last { return .day(31) }
                return form.model.monthDay
            },
            set: { form.model.monthDay = $0 }
        )
    }

    /// A time row, read and written as "HH:MM" in the routine's zone (the
    /// picker shows the clock as is, in the phone's 12 or 24 hour format).
    private func time(_ index: Int) -> Binding<Date> {
        Binding(
            get: { Self.date(fromClock: form.model.times.indices.contains(index) ? form.model.times[index] : "09:00") },
            set: { value in
                guard form.model.times.indices.contains(index) else { return }
                form.model.times[index] = Self.clock(value)
            }
        )
    }

    private func clock(_ key: WritableKeyPath<RoutineScheduleForm, String>) -> Binding<Date> {
        Binding(
            get: { Self.date(fromClock: form[keyPath: key]) },
            set: { form[keyPath: key] = Self.clock($0) }
        )
    }

    static func date(fromClock text: String) -> Date {
        RoutineScheduleForm.atLocalTime(Date(), text, calendar: .current)
    }

    static func clock(_ date: Date) -> String {
        RoutineScheduleForm.clock(date, calendar: .current)
    }
}

/// Seven day toggles, Sunday first.
struct RoutineDayChips: View {
    @Environment(\.themePalette) var themePalette
    let selected: [Int]
    let idPrefix: String
    let toggle: (Int) -> Void

    var body: some View {
        HStack {
            ForEach(0..<7, id: \.self) { day in
                let on = selected.contains(day)
                Button(RoutineEditorWording.dayLetter(day)) { toggle(day) }
                    .buttonStyle(.bordered)
                    .tint(on ? Theme.accent : Theme.textSecondary)
                    .accessibilityLabel(RoutineEditorWording.dayName(day))
                    .accessibilityValue(Text(on ? "selected" : "not selected"))
                    .accessibilityIdentifier("\(idPrefix).\(day)")
            }
        }
    }
}

/// The zone a schedule's times are read in, as cities: the person's own
/// first, then every zone, searchable by city or by its name ("Eastern
/// Time"). The IANA identifier stays under the hood.
struct RoutineTimeZonePicker: View {
    @Environment(\.themePalette) var themePalette
    @Environment(\.dismiss) private var dismiss
    @Binding var selected: String
    @State private var query = ""

    private struct Zone: Identifiable {
        let id: String
        let city: String
        let name: String
    }

    private static let zones: [Zone] = {
        let identifiers = Set(TimeZone.knownTimeZoneIdentifiers + ["UTC"])
        return identifiers
            .filter { $0 == "UTC" || $0.contains("/") && !$0.hasPrefix("Etc/") }
            .map { Zone(id: $0, city: RoutineScheduleModel.timeZoneCity($0), name: zoneName($0)) }
            .sorted { ($0.city, $0.id) < ($1.city, $1.id) }
    }()

    private static func zoneName(_ identifier: String) -> String {
        TimeZone(identifier: identifier)?.localizedName(for: .generic, locale: .current) ?? ""
    }

    private var rows: [Zone] {
        let text = query.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return Self.zones }
        return Self.zones.filter { $0.city.localizedCaseInsensitiveContains(text) || $0.name.localizedCaseInsensitiveContains(text) }
    }

    var body: some View {
        let own = TimeZone.current.identifier
        ThemedForm {
            if query.isEmpty {
                Section("Your time zone") { row(Zone(id: own, city: RoutineScheduleModel.timeZoneCity(own), name: Self.zoneName(own))) }
            }
            Section {
                ForEach(rows) { row($0) }
            } header: {
                if query.isEmpty { Text("All time zones") } else { Text("Results") }
            }
        }
        .navigationTitle(Text("Time zone"))
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, prompt: Text("Search a city"))
    }

    private func row(_ zone: Zone) -> some View {
        Button {
            selected = zone.id
            dismiss()
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: zone.city).foregroundStyle(Theme.textPrimary)
                    if !zone.name.isEmpty {
                        Text(verbatim: zone.name).font(.footnote).foregroundStyle(Theme.textSecondary)
                    }
                }
                Spacer(minLength: 8)
                if zone.id == selected {
                    Image(systemName: "checkmark").foregroundStyle(Theme.accentText)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(zone.id == selected ? .isSelected : [])
        .accessibilityIdentifier("routine-time-zone.\(zone.id)")
    }
}

enum RoutineEditorWording {
    static func dayName(_ day: Int) -> String {
        let symbols = Calendar.current.weekdaySymbols
        return (0..<symbols.count).contains(day) ? symbols[day] : ""
    }

    static func dayLetter(_ day: Int) -> String {
        let symbols = Calendar.current.veryShortStandaloneWeekdaySymbols
        return (0..<symbols.count).contains(day) ? symbols[day] : ""
    }

    static func run(_ date: Date, zone: String) -> String {
        var style = Date.FormatStyle.dateTime.weekday(.abbreviated).year().month(.abbreviated).day().hour().minute()
        if let timeZone = TimeZone(identifier: zone) { style.timeZone = timeZone }
        return date.formatted(style)
    }

    static func problem(_ problem: RoutineScheduleForm.Problem) -> String {
        switch problem {
        case .intervalRange: String(localized: "Choose a whole number from 5 to 1,440 minutes.")
        case .noDays, .schedule(.noDays): String(localized: "Choose at least one day.")
        case let .window(minutes): String(localized: "Choose a same-day window at least \(minutes) minutes long.")
        case .endDate: String(localized: "Choose an end date after the first run.")
        case .schedule(.noTime): String(localized: "Add at least one time.")
        case .schedule(.sameMinute): String(localized: "Times on the same day must share their minutes, such as 8:30, 12:30 and 4:30.")
        case .schedule(.badTime): String(localized: "Choose a valid time.")
        case let .cron(message): cron(message)
        }
    }

    /// The cron calculator's messages, in the person's words (the zone
    /// comes from a list and the expression from the fields, so only a date
    /// that never exists can still go wrong).
    static func cron(_ message: String) -> String {
        if message == CronExpression.Failure.noFutureRuns.errorDescription {
            return String(localized: "This schedule never runs: choose a date that exists.")
        }
        return String(localized: "Choose a valid schedule.")
    }
}

// MARK: - Runs as

/// The people a routine may run as (the desktop's RunAsField dropdown): a
/// search field past eight people, the people who cannot run this bot's
/// routines listed but not choosable, a check on the chosen one.
struct RoutineRunAsPicker: View {
    @Environment(\.themePalette) var themePalette
    @Environment(\.dismiss) private var dismiss
    let options: RoutineRunAsOptions
    @Binding var selected: String?
    @State private var query = ""

    private var current: String? { selected ?? options.current?.principalId }

    var body: some View {
        let rows = RoutineRunAsField.rows(options, selected: current, query: query)
        let list = ThemedForm {
            Section {
                if rows.isEmpty {
                    Text("No one matches").foregroundStyle(Theme.textSecondary)
                }
                ForEach(rows) { person in
                    Button {
                        selected = person.principalId
                        dismiss()
                    } label: {
                        HStack(spacing: 10) {
                            PersonAvatar(initials: People.initials(RoutineRunAsField.name(person)), size: 28, avatarUrl: person.avatarUrl)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(verbatim: RoutineRunAsField.name(person))
                                    .foregroundStyle(person.selectable ? Theme.textPrimary : Theme.textTertiary)
                                if !person.selectable {
                                    Text("Cannot run this bot's routines").font(.footnote).foregroundStyle(Theme.textTertiary)
                                } else if person.pending == true {
                                    Text("Will run once \(RoutineRunAsField.name(person)) signs in").font(.footnote).foregroundStyle(Theme.textSecondary)
                                }
                            }
                            Spacer(minLength: 8)
                            if person.principalId == current {
                                Image(systemName: "checkmark").foregroundStyle(Theme.accentText)
                            }
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(!person.selectable)
                    .accessibilityAddTraits(person.principalId == current ? .isSelected : [])
                    .accessibilityIdentifier("routine-run-as.\(person.principalId)")
                }
            } footer: {
                Text("The routine acts with this person's access and their rights on the bot. Every change is recorded in the admin activity log.")
            }
        }
        .navigationTitle(Text("Runs as"))
        .navigationBarTitleDisplayMode(.inline)
        if options.people.count > RoutineRunAsField.searchAfter {
            list.searchable(text: $query, prompt: Text("Search people"))
        } else {
            list
        }
    }
}
