// The iPhone bot panel's More pages that had no phone page of their own
// (`bot-settings/sections.ts`): Model, Permissions, Works on, Voice &
// alerts and Usage, as phone forms. Each change saves at once, as on the
// desktop (no Save button). The pages the phone already had (Skills,
// Memory, Access, Who can see it, Shared with, Perspicax Profiles, History,
// Slack) are pushed as they are; Overview carries the prompt preview, as
// `OverviewSection.tsx` does.
//
// Moved here from the retired "Bot settings" sheet (AgentProfileView):
// the model picker, the voice card, notifications; from its Advanced
// bucket: usage, voice notes.
import AVFAudio
import CompanionCore
import SwiftUI

// MARK: - Page frame

/// A More page: the phone's grouped form under the section's title.
struct BotPanelFormPage<Content: View>: View {
    @Environment(\.themePalette) var themePalette
    let section: DesktopPanelSection
    @ViewBuilder let content: Content

    var body: some View {
        ThemedForm { content }
            .navigationTitle(Text(section.title))
            .navigationBarTitleDisplayMode(.inline)
            .accessibilityIdentifier("panel-page.\(section.rawValue)")
    }
}

// MARK: - Overview

/// Overview (`OverviewSection.tsx`): who it is, what it does, can reach and
/// won't, recent changes, and the prompt preview (what the model sees).
struct BotOverviewPage: View {
    let bot: Bot
    @EnvironmentObject private var session: Session

    var body: some View {
        BotOverviewView(bot: bot, showsPromptPreview: session.surfaceGate.allows(.advancedBotPanel))
            .navigationTitle(Text(DesktopPanelSection.overview.title))
            .navigationBarTitleDisplayMode(.inline)
            .accessibilityIdentifier("panel-page.overview")
    }
}

// MARK: - Model

/// Model (`ModelSection.tsx`): provider, model, variant or effort. The
/// provider list is an admin's; other pairings read the current model.
struct BotModelSection: View {
    @Environment(\.themePalette) var themePalette
    let bot: Bot
    @EnvironmentObject private var session: Session

    @State private var instances: [Instance] = []
    @State private var loaded = false
    @State private var instanceID: String
    @State private var modelID: String
    @State private var effort: String?
    @State private var variant: String?
    @State private var saved: ModelSelection
    @State private var busy = false

    init(bot: Bot) {
        self.bot = bot
        let selection = bot.currentTaskModelSelection
        _instanceID = State(initialValue: selection.instanceId)
        _modelID = State(initialValue: selection.model)
        _effort = State(initialValue: selection.effort)
        _variant = State(initialValue: selection.variant)
        _saved = State(initialValue: selection)
    }

    private var current: Bot { session.state.bot(bot.id)?.projected(forThread: bot.threadId) ?? bot }
    private var instance: Instance? { instances.first { $0.instanceId == instanceID } }
    private var available: [Instance] { instances.filter(\.snapshot.isAvailable) }
    private var instanceChoices: [Instance] {
        guard let saved = instances.first(where: { $0.instanceId == self.saved.instanceId }), !saved.snapshot.isAvailable else { return available }
        return [saved] + available
    }
    private var modelChoices: [(id: String, label: String)] {
        guard let instance else { return modelID.isEmpty ? [] : [(modelID, modelID)] }
        var seen = Set<String>()
        var out: [(id: String, label: String)] = []
        if !instance.models.default.isEmpty {
            seen.insert(instance.models.default)
            out.append((instance.models.default, instance.models.options.first { $0.id == instance.models.default }?.label ?? instance.models.default))
        }
        for option in instance.models.options where seen.insert(option.id).inserted { out.append((option.id, option.label)) }
        if !modelID.isEmpty, seen.insert(modelID).inserted { out.append((modelID, modelID)) }
        return out
    }
    private var usesVariants: Bool { instance?.capabilities?.modelVariants == true }
    private var variantOptions: [ModelVariantOption]? {
        ModelVariantRules.options(for: ModelSelection(instanceId: instanceID, model: modelID, variant: variant), instances: instances)
    }
    private var levels: [String] {
        guard !usesVariants else { return [] }
        var seen = Set<String>()
        return (instance?.capabilities?.effortLevels ?? []).filter { !$0.isEmpty && seen.insert($0).inserted }
    }
    private var draft: ModelSelection {
        usesVariants
            ? ModelSelection(instanceId: instanceID, model: modelID, variant: variant)
            : ModelSelection(instanceId: instanceID, model: modelID, effort: effort)
    }
    private var canApply: Bool {
        guard loaded, current.busy != true, let instance, instance.snapshot.isAvailable else { return false }
        let offered = modelID == instance.models.default || instance.models.options.contains { $0.id == modelID }
        return offered && (effort.map(levels.contains) ?? true) && draft != saved
    }

    var body: some View {
        Section {
            if !session.canAdminister {
                LabeledContent(String(localized: "Model"), value: saved.model.isEmpty ? String(localized: "Default") : saved.model)
            } else if !loaded {
                HStack { Text("Loading models"); Spacer(); ProgressView() }
            } else if instanceChoices.isEmpty {
                Label("No model providers are available", systemImage: "exclamationmark.triangle").foregroundStyle(Theme.textSecondary)
            } else {
                Picker("Provider", selection: $instanceID) {
                    if !instances.contains(where: { $0.instanceId == instanceID }) {
                        Text("Current provider (unavailable)").tag(instanceID).disabled(true)
                    }
                    ForEach(instanceChoices) { item in
                        Text(Self.label(item)).tag(item.instanceId).disabled(!item.snapshot.isAvailable)
                    }
                }
                .onValueChange(of: instanceID) { selectDefaults(for: $0) }
                Picker("Model", selection: $modelID) {
                    ForEach(modelChoices, id: \.id) { option in Text(option.label).tag(option.id) }
                }
                .disabled(instance?.snapshot.isAvailable != true)
                .onValueChange(of: modelID) { model in
                    variant = instanceID == saved.instanceId && model == saved.model ? saved.variant : nil
                    apply()
                }
                if let variantOptions {
                    ModelVariantPicker(options: variantOptions, saved: saved.variant, variant: $variant)
                        .onValueChange(of: variant) { _ in apply() }
                }
                if !levels.isEmpty {
                    Picker("Reasoning effort", selection: $effort) {
                        Text("Default").tag(String?.none)
                        ForEach(levels, id: \.self) { Text(BotPanelModel.effortLabel($0)).tag(Optional($0)) }
                    }
                    .onValueChange(of: effort) { _ in apply() }
                }
                if current.busy == true {
                    Label("Stop this bot before changing its model.", systemImage: "hourglass")
                        .font(.footnote).foregroundStyle(Theme.textSecondary)
                }
            }
        } footer: {
            Text("For groups and new threads. Also updates the selected idle thread; other existing threads keep their model.")
        }
        .overlay { if busy { ProgressView() } }
        .task {
            instances = session.canAdminister ? await session.modelInstances() : []
            loaded = true
        }
    }

    private func selectDefaults(for id: String) {
        guard let instance = instances.first(where: { $0.instanceId == id }) else { return }
        if id == saved.instanceId {
            modelID = saved.model
            effort = saved.effort.flatMap { (instance.capabilities?.effortLevels ?? []).contains($0) ? $0 : nil }
            variant = saved.variant
        } else {
            modelID = instance.models.default
            effort = nil
            variant = nil
        }
        apply()
    }

    /// Saved as soon as the choice is complete, as the desktop's picker does.
    private func apply() {
        guard canApply else { return }
        let next = draft
        busy = true
        Task {
            defer { busy = false }
            if let updated = await session.updateModel(next, for: current) {
                saved = updated.projected(forThread: bot.threadId)?.currentTaskModelSelection ?? next
            }
        }
    }

    private static func label(_ instance: Instance) -> String {
        let base = instance.displayName?.trimmingCharacters(in: .whitespacesAndNewlines)
        let name = base.flatMap { $0.isEmpty ? nil : $0 } ?? instance.instanceId
        return instance.snapshot.isAvailable ? name : "\(name) (Unavailable)"
    }
}

// MARK: - Permissions

/// Permissions (`PermissionsSection.tsx`): Chief of Staff, ask before
/// contacting other bots, the approval level, and the command allowlist.
/// The writes are an admin session's; other pairings read them.
struct BotPermissionsSection: View {
    @Environment(\.themePalette) var themePalette
    let bot: Bot
    @EnvironmentObject private var session: Session
    @State private var confirmingFull = false
    @State private var viewerId = "local-owner"

    private var current: Bot { session.state.bot(bot.id) ?? bot }
    private var canEdit: Bool { session.surfaceGate.allows(.botAccessEdit) }
    private var level: ApprovalLevel { ApprovalLevel.of(approvalMode: current.approvalMode, autoApprove: current.autoApprove) }
    private var sectionName: String {
        let name = current.section?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return name.isEmpty ? String(localized: "General") : name
    }
    /// A client session reads and removes command rules only for its own bot.
    private var showsAllowlist: Bool {
        let gate = session.surfaceGate
        guard gate.allows(.commandAllowlist) else { return false }
        return gate.scope != .serverClient || PrimaryBotRules.viewerOwns(current, viewerId: viewerId)
    }

    var body: some View {
        Section {
            Toggle(isOn: Binding(get: { current.chiefOfStaff == true }, set: { on in send(BotPanelPatch(chiefOfStaff: on)) })) {
                Label("Chief of Staff", systemImage: "crown")
            }
            .tint(Theme.toggleOn)
            .disabled(!canEdit)
            .accessibilityIdentifier("permissions-chief")
        } footer: {
            Text(current.chiefOfStaff == true
                 ? "This is the primary contact for \(sectionName). It can create and coordinate specialists in this team, then combine their work into one answer."
                 : "Make this bot the primary contact for the \(sectionName) team.")
        }
        Section {
            Toggle("Ask me before contacting other bots", isOn: Binding(get: { current.approvePeerComms == true }, set: { on in
                send(BotPanelPatch(approvePeerComms: on))
            }))
            .tint(Theme.toggleOn)
            .disabled(!canEdit)
            .accessibilityIdentifier("permissions-peers")
        } footer: {
            Text(current.approvePeerComms == true
                 ? "This bot will stop and ask before it reaches out to another bot."
                 : "Let this bot talk to teammates on its own, without a confirmation step.")
        }
        Section {
            Picker("Approval level", selection: Binding(get: { level }, set: { pick($0) })) {
                ForEach([ApprovalLevel.ask, .edits, .auto, .full], id: \.self) { option in
                    Label { Text(DesktopApprovalButton.label(option)) } icon: { Image(systemName: DesktopApprovalButton.icon(option)) }
                        .tag(option)
                }
                if level == .custom { Text(verbatim: level.rawValue.capitalized).tag(ApprovalLevel.custom) }
            }
            .disabled(!canEdit || current.busy == true)
            .accessibilityIdentifier("permissions-approval")
            if showsAllowlist {
                NavigationLink {
                    CommandAllowlistPage(bot: current)
                } label: {
                    Label("Command allowlist", systemImage: "terminal")
                }
                .accessibilityIdentifier("permissions-allowlist")
            }
        } footer: {
            Text("Default for new threads, routines and delegated work. When enabling Full access, you can also apply it to every existing thread.")
        }
        .task(id: bot.id) { viewerId = PrimaryBotRules.viewerId(config: await session.configStatus()) }
        .alert("Give this bot Full access?", isPresented: $confirmingFull) {
            Button("Cancel", role: .cancel) {}
            Button("Full access", role: .destructive) { send(.approval(.full)) }
        } message: {
            Text("It runs commands and edits files without asking, in every thread. Use only with bots you trust.")
        }
        if !canEdit {
            Section {
                Text("These are changed by an administrator, or in Sagax on your computer.")
                    .font(.footnote)
                    .foregroundStyle(Theme.textSecondary)
                    .accessibilityIdentifier("permissions-read-only")
            }
        }
    }

    private func pick(_ option: ApprovalLevel) {
        guard option != level, current.busy != true else { return }
        if option == .full { confirmingFull = true; return }
        send(.approval(option))
    }

    private func send(_ patch: BotPanelPatch) {
        let target = current
        Task { _ = await sendPanelPatch(patch, bot: target, session: session) }
    }
}

// MARK: - Works on

/// Where the bot works (`AccessSection.tsx` Works on): Access holds it, or
/// its own Computer item on an organization server.
struct BotWorksOnSection: View {
    @Environment(\.themePalette) var themePalette
    let bot: Bot
    @EnvironmentObject private var session: Session
    @State private var config: ConfigStatus?

    private var current: Bot { session.state.bot(bot.id) ?? bot }
    private var canEdit: Bool { session.surfaceGate.allows(.botAccessEdit) }
    private var organization: Bool { session.surfaceGate.organization }
    private var choices: [DesktopWorksOn] {
        let offered = DesktopWorksOnRules.choices(config: config, organization: organization)
        let now = DesktopWorksOn.of(current)
        return offered.contains(now) ? offered : offered + [now]
    }

    var body: some View {
        Section {
            Picker("Works on", selection: Binding(get: { DesktopWorksOn.of(current) }, set: { next in
                let target = current
                Task { _ = await sendPanelPatch(BotPanelPatch(computer: next.stored, browser: next == .browser ? true : nil), bot: target, session: session) }
            })) {
                ForEach(choices, id: \.self) { place in
                    Text(Self.name(place)).tag(place)
                        .disabled(place == .browser && !DesktopWorksOnRules.browserSelectable(config: config, modelCanBrowse: true))
                }
            }
            .disabled(!canEdit || current.busy == true)
            .accessibilityIdentifier("access-works-on")
        } header: {
            Text("Works on")
        } footer: {
            Text("Where this bot runs its tools: a computer of its own, this computer, the built-in browser, or nowhere.")
        }
        .task { config = await session.configStatus() }
    }

    static func name(_ place: DesktopWorksOn) -> String {
        switch place {
        case .auto: String(localized: "Auto")
        case .cloud: String(localized: "Cloud")
        case .vm: String(localized: "Local VM")
        case .local: String(localized: "This computer")
        case .browser: String(localized: "Browser")
        case .off: String(localized: "Off")
        }
    }
}

// MARK: - Voice & alerts

/// Voice & alerts (`VoiceSection.tsx` with `VoiceSettings`): the engine,
/// the agent's voice, read replies aloud, voice notes, and notifications.
/// Provider keys stay on the computer.
struct BotVoiceSections: View {
    @Environment(\.themePalette) var themePalette
    let bot: Bot
    @EnvironmentObject private var session: Session

    @State private var voices: [Voice] = []
    @State private var config: ConfigStatus?
    @State private var engine: VoiceProvider = .elevenlabs
    @State private var hostIsMac = false
    @State private var chatterboxURL = ""
    @State private var chatterboxModel = ""
    @State private var switching = false
    @State private var savingServer = false
    @State private var serverProblem: String?
    @State private var previewing = false
    @State private var player: AVAudioPlayer?

    private var current: Bot { session.state.bot(bot.id) ?? bot }
    private var voice: String { current.voice ?? "" }
    private var canSetEngine: Bool { session.surfaceGate.allows(.voiceEngineSettings) }
    private var configured: Bool { config?.isTTSConfigured == true }
    private var canSpeak: Bool { config?.canSpeak(agentVoice: voice) == true }

    var body: some View {
        Section {
            if canSetEngine {
                Picker("Voice engine", selection: $engine) {
                    Text("ElevenLabs").tag(VoiceProvider.elevenlabs)
                    Text("Fish Audio").tag(VoiceProvider.fish)
                    Text("Built-in Mac voices").tag(VoiceProvider.system).disabled(!hostIsMac)
                    Text("Chatterbox (local)").tag(VoiceProvider.chatterbox)
                }
                .disabled(switching)
                if config?.voiceProvider == .chatterbox {
                    TextField("Chatterbox server address", text: $chatterboxURL, prompt: Text(verbatim: "http://127.0.0.1:4123"))
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    TextField("Chatterbox model", text: $chatterboxModel, prompt: Text(verbatim: "chatterbox-turbo"))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    Button { Task { await saveServer() } } label: {
                        HStack { Text("Save server"); if savingServer { Spacer(); ProgressView() } }
                    }
                    .disabled(savingServer || chatterboxURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    if let serverProblem {
                        Label(serverProblem, systemImage: "exclamationmark.triangle").foregroundStyle(Theme.warning)
                    }
                }
            }
            if configured {
                Picker("Voice", selection: Binding(get: { voice }, set: { save(voice: $0) })) {
                    if config?.hasWorkspaceDefaultVoice == true {
                        Text("Workspace default").tag("")
                    } else {
                        Text("Choose an agent voice").tag("").disabled(true)
                    }
                    if !voice.isEmpty, !voices.contains(where: { $0.id == voice }) {
                        Text("Current agent voice").tag(voice)
                    }
                    ForEach(voices) { option in Text(option.label).tag(option.id) }
                }
                .accessibilityIdentifier("voice-picker")
                Button("Preview voice", systemImage: "speaker.wave.2") { Task { await preview() } }
                    .disabled(previewing || !canSpeak)
            } else {
                Label(String(localized: "Add it in Sagax on your computer."), systemImage: "speaker.slash")
                    .foregroundStyle(Theme.textSecondary)
            }
            Toggle("Read replies aloud", isOn: Binding(get: { current.speakReplies == true }, set: { on in
                var patch = BotProfilePatch()
                patch.speakReplies = on
                update(patch)
            }))
            .tint(Theme.toggleOn)
            .disabled(!canSpeak && current.speakReplies != true)
            .accessibilityIdentifier("voice-speak-replies")
        } header: {
            Text("Voice")
        } footer: {
            Text("Give this agent a voice for calls and spoken replies. The voice choice belongs to this agent; provider keys stay on your computer and never come to this device.")
        }
        if session.surfaceGate.allows(.voiceNotesSetting) {
            BotVoiceNotesSection(bot: current)
        }
        Section {
            Toggle("Notifications", isOn: Binding(get: { current.notifications }, set: { on in
                var patch = BotProfilePatch()
                patch.notifications = on
                update(patch)
            }))
            .tint(Theme.toggleOn)
            .accessibilityIdentifier("profile-notifications")
        } footer: {
            Text("Get notified when this Bot finishes or needs input")
        }
        .task {
            async let status = session.configStatus()
            async let options = session.voiceOptions()
            async let environment = session.serverEnvironment()
            let loaded = await status
            config = loaded
            engine = loaded?.voiceProvider ?? .elevenlabs
            chatterboxURL = loaded?.tts?.baseUrl ?? ""
            chatterboxModel = loaded?.tts?.model ?? ""
            voices = await options
            hostIsMac = (await environment)?.platform == "darwin"
        }
        .onValueChange(of: engine) { selected in Task { await switchEngine(selected) } }
    }

    private func update(_ patch: BotProfilePatch) {
        let target = current
        Task { _ = await session.updateProfile(patch, for: target) }
    }

    private func save(voice next: String) {
        var patch = BotProfilePatch()
        patch.voice = next
        // a voice that cannot speak cannot read replies aloud
        if config?.canSpeak(agentVoice: next) != true, current.speakReplies == true { patch.speakReplies = false }
        update(patch)
    }

    private func switchEngine(_ selected: VoiceProvider) async {
        guard canSetEngine, selected != (config?.voiceProvider ?? .elevenlabs) else { return }
        switching = true
        defer { switching = false }
        if let status = await session.setVoiceProvider(selected) {
            let reset = AgentProfileVoiceState(voice: voice, speakReplies: current.speakReplies == true, baselineVoice: voice)
                .afterProviderSwitch(to: status)
            config = status
            engine = status.voiceProvider
            voices = []
            voices = await session.voiceOptions()
            if reset.voice != voice || reset.speakReplies != (current.speakReplies == true) {
                var patch = BotProfilePatch()
                patch.voice = reset.voice
                patch.speakReplies = reset.speakReplies
                update(patch)
            }
        } else {
            engine = config?.voiceProvider ?? .elevenlabs
        }
    }

    private func saveServer() async {
        let address = chatterboxURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard address.hasPrefix("http://") || address.hasPrefix("https://") else {
            serverProblem = String(localized: "The server address must start with http:// or https://.")
            return
        }
        serverProblem = nil
        savingServer = true
        defer { savingServer = false }
        if let status = await session.saveChatterboxServer(baseURL: address, model: chatterboxModel.trimmingCharacters(in: .whitespacesAndNewlines)) {
            config = status
            voices = await session.voiceOptions()
        }
    }

    private func preview() async {
        previewing = true
        defer { previewing = false }
        guard let data = await session.previewVoice(voice, for: current) else { return }
        do {
            let audio = AVAudioSession.sharedInstance()
            try audio.setCategory(.playback, mode: .spokenAudio)
            try audio.setActive(true)
            let next = try AVAudioPlayer(data: data)
            guard next.prepareToPlay(), next.play() else {
                session.actionError = String(localized: "The generated audio could not be played.")
                return
            }
            player = next
        } catch {
            player = nil
            session.actionError = String(localized: "The generated audio could not be played.")
        }
    }
}

// MARK: - Page for a section

/// The page a More row pushes.
struct BotPanelSectionPage: View {
    let section: DesktopPanelSection
    let bot: Bot
    /// Works on has its own item (an organization server): Access leaves it out.
    let worksOnListed: Bool
    let slackURL: URL?

    var body: some View {
        switch section {
        case .overview: AnyView(BotOverviewPage(bot: bot))
        case .slack:
            AnyView(BotPanelFormPage(section: section) { if let slackURL { BotSlackSection(url: slackURL) } })
        case .soul: AnyView(InstructionView(bot: bot))
        case .skills: AnyView(BotSkillsPage(bot: bot))
        case .memory: AnyView(BotMemoryPage(bot: bot))
        case .access:
            AnyView(BotPanelFormPage(section: section) {
                if !worksOnListed { BotWorksOnSection(bot: bot) }
                BotAccessSection(bot: bot)
            })
        case .worksOn: AnyView(BotPanelFormPage(section: section) { BotWorksOnSection(bot: bot) })
        case .model: AnyView(BotPanelFormPage(section: section) { BotModelSection(bot: bot) })
        case .permissions: AnyView(BotPanelFormPage(section: section) { BotPermissionsSection(bot: bot) })
        case .voice: AnyView(BotPanelFormPage(section: section) { BotVoiceSections(bot: bot) })
        case .visibility: AnyView(BotVisibilityPage(bot: bot))
        case .sharing: AnyView(BotSharingPage(bot: bot))
        case .perspicax: AnyView(BotPerspicaxPage(bot: bot))
        case .history: AnyView(BotHistoryPage(bot: bot))
        case .usage: AnyView(BotPanelFormPage(section: section) { BotUsageSection(bot: bot) })
        }
    }
}
