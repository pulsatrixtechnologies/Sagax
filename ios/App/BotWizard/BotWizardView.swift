// The bot creation wizard on the phone and the iPad (desktop
// src/components/bot-wizard/BotWizard.tsx, 2026-10-26): the same six steps
// over the same server draft (`/api/bot-wizard`), so a draft started on one
// device resumes on the other.
//
// - First screen: "Guided with my bot" and "I'll fill it in myself", and the
//   drafts left to resume. Choosing one makes the bot and its draft.
// - Guided: the conversation with the person's Primary Bot, which fills the
//   steps live (it writes the draft through sagax_settings); the steps stay
//   editable. The phone switches between the two, the iPad shows both.
// - The mode changes at any time from the top; nothing is lost.
// - Every step can be skipped; Later keeps the draft.
import SwiftUI
import CompanionCore

/// Who opens the wizard: the "+" menu, Create New Bot's Assistant, the bot's
/// "..." menu. One host at the root presents it (`BotWizardHost`).
@MainActor
final class BotWizardPresenter: ObservableObject {
    static let shared = BotWizardPresenter()

    struct Request: Identifiable, Equatable {
        let id = UUID()
        /// nil: a new bot; a bot's id resumes its draft or redoes it.
        var botId: String?
        var redo = false
    }

    @Published var request: Request?
    /// The bot a finished wizard opens; the home that shows it clears it.
    @Published var finishedBotId: String?

    func open(botId: String? = nil, redo: Bool = false) {
        request = Request(botId: botId, redo: redo)
    }
}

/// At the root of the home: the wizard over everything, full screen.
struct BotWizardHost: ViewModifier {
    @ObservedObject private var presenter = BotWizardPresenter.shared

    func body(content: Content) -> some View {
        content.fullScreenCover(item: $presenter.request) { request in
            BotWizardView(request: request) { finished in
                presenter.request = nil
                if let finished { presenter.finishedBotId = finished }
            }
        }
    }
}

extension View {
    func botWizardHost() -> some View { modifier(BotWizardHost()) }
}

struct BotWizardView: View {
    let request: BotWizardPresenter.Request
    let close: (_ finishedBotId: String?) -> Void

    @EnvironmentObject private var session: Session
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.locale) private var locale
    @State private var phase: Phase = .loading
    @State private var botId: String?
    @State private var draft: WizardDraft?
    @State private var suggestions = WizardSuggestions.empty
    @State private var drafts: [WizardDraft] = []
    @State private var busy: String?
    @State private var error: String?
    @State private var pane: GuidedPane = .chat

    enum Phase { case loading, choose, steps }
    enum GuidedPane: Hashable { case chat, steps }

    private var french: Bool { (locale.language.languageCode?.identifier ?? Locale.current.language.languageCode?.identifier ?? "en") == "fr" }
    private var language: String { french ? "fr" : "en" }
    private var bot: Bot? { botId.flatMap { session.state.bot($0) } }
    private var guide: Bot? {
        if let id = draft?.guidedBotId, let found = session.state.bot(id) { return found }
        return BotWizardRules.guide(bots: session.state.bots, draftBotId: botId)
    }
    private var client: CompanionClient? { session.profileClient }

    var body: some View {
        VStack(spacing: 0) {
            header
            if let error {
                Text(error)
                    .font(Theme.Font.preview)
                    .foregroundStyle(Theme.danger)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 20)
                    .padding(.bottom, 8)
                    .accessibilityIdentifier("wizard-error")
            }
            switch phase {
            case .loading:
                Spacer()
                ProgressView()
                Spacer()
            case .choose:
                modeChoice
            case .steps:
                if let draft, let bot {
                    steps(draft: draft, bot: bot)
                } else {
                    Spacer()
                    ProgressView()
                    Spacer()
                }
            }
        }
        .background(Theme.bg.ignoresSafeArea())
        .task { await load() }
        .task(id: guidedPollKey) { await pollGuided() }
    }

    // MARK: Header

    private var header: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(phase == .steps ? stepTitle(draft?.step ?? .identity) : String(localized: "Create a bot"))
                    .font(HomeMetrics.name)
                    .foregroundStyle(Theme.textPrimary)
                if phase == .steps, let bot {
                    Text("Setting up \(bot.name)")
                        .font(Theme.Font.preview)
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 0)
            if phase == .steps, let draft {
                Picker("Wizard mode", selection: Binding(get: { draft.mode }, set: { mode in Task { await switchMode(mode) } })) {
                    Text("Guided").tag(WizardMode.guided)
                    Text("Manual").tag(WizardMode.manual)
                }
                .pickerStyle(.segmented)
                .frame(width: 170)
                .accessibilityIdentifier("wizard-mode")
            }
            Button("Later") { close(nil) }
                .font(Theme.Font.bodyMedium)
                .foregroundStyle(Theme.textSecondary)
                .accessibilityIdentifier("wizard-later")
        }
        .padding(.horizontal, 20)
        .padding(.top, 16)
        .padding(.bottom, 12)
    }

    // MARK: Mode choice

    private var modeChoice: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if request.botId != nil, let bot {
                    Text("Go through the steps again for \(bot.name). Everything starts filled in from the bot.")
                        .font(Theme.Font.body).foregroundStyle(Theme.textSecondary)
                } else {
                    Text("How do you want to set up your new bot? You can switch at any time without losing anything.")
                        .font(Theme.Font.body).foregroundStyle(Theme.textSecondary)
                }
                modeCard(mode: .guided, icon: "bubble.left.and.bubble.right", title: String(localized: "Guided with my bot"),
                         body: guide.map { String(localized: "\($0.name) asks you the questions and fills in each step live, right beside the conversation. You can correct any field.") }
                            ?? String(localized: "Your bot asks you the questions and fills in each step live. You can correct any field."))
                modeCard(mode: .manual, icon: "list.bullet.clipboard", title: String(localized: "I'll fill it in myself"),
                         body: String(localized: "The same steps as a form, page by page, with suggestions ready to pick."))
                Text("Same draft in both modes: switch from the top of the wizard whenever you like.")
                    .font(Theme.Font.preview).foregroundStyle(Theme.textSecondary)
                if !drafts.isEmpty {
                    Text("Drafts to finish")
                        .font(Theme.Font.bodyMedium).foregroundStyle(Theme.textPrimary)
                        .padding(.top, 8)
                    ForEach(drafts, id: \.botId) { entry in
                        HStack(spacing: 12) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(entry.botName?.isEmpty == false ? entry.botName! : String(localized: "New bot"))
                                    .font(Theme.Font.body).foregroundStyle(Theme.textPrimary)
                                Text("Stopped at \(stepTitle(entry.step))")
                                    .font(Theme.Font.preview).foregroundStyle(Theme.textSecondary)
                            }
                            Spacer(minLength: 0)
                            Button("Resume") { Task { await choose(entry.mode, resume: entry) } }
                                .buttonStyle(.bordered)
                            Button { Task { await discard(entry) } } label: { Image(systemName: "trash") }
                                .buttonStyle(.bordered)
                                .accessibilityLabel(Text("Delete the draft \(entry.botName ?? "")"))
                        }
                        .padding(12)
                        .background(Theme.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .accessibilityIdentifier("wizard-draft-row")
                    }
                }
            }
            .padding(20)
            .frame(maxWidth: 720)
            .frame(maxWidth: .infinity)
        }
    }

    private func modeCard(mode: WizardMode, icon: String, title: String, body: String) -> some View {
        Button { Task { await choose(mode) } } label: {
            VStack(alignment: .leading, spacing: 10) {
                Image(systemName: icon)
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(Theme.accent)
                    .frame(width: 44, height: 44)
                    .background(Theme.accent.opacity(0.15), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                Text(title).font(.system(size: 17, weight: .semibold)).foregroundStyle(Theme.textPrimary)
                Text(body).font(Theme.Font.body).foregroundStyle(Theme.textSecondary).multilineTextAlignment(.leading)
                if busy == mode.rawValue { ProgressView() }
            }
            .frame(maxWidth: .infinity, minHeight: 150, alignment: .topLeading)
            .padding(18)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 0.5))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(busy != nil)
        .accessibilityIdentifier("wizard-choose-\(mode.rawValue)")
    }

    // MARK: Steps

    @ViewBuilder
    private func steps(draft: WizardDraft, bot: Bot) -> some View {
        let wide = sizeClass == .regular
        if draft.mode == .guided {
            if wide {
                HStack(spacing: 0) {
                    guidedChat(draft: draft).frame(maxWidth: 460)
                    Divider()
                    stepPane(draft: draft, bot: bot)
                }
            } else {
                VStack(spacing: 0) {
                    Picker("", selection: $pane) {
                        Text("Conversation").tag(GuidedPane.chat)
                        Text("Steps").tag(GuidedPane.steps)
                    }
                    .pickerStyle(.segmented)
                    .padding(.horizontal, 20)
                    .padding(.bottom, 8)
                    if pane == .chat { guidedChat(draft: draft) } else { stepPane(draft: draft, bot: bot) }
                }
            }
        } else {
            stepPane(draft: draft, bot: bot)
        }
    }

    @ViewBuilder
    private func guidedChat(draft: WizardDraft) -> some View {
        if let guideId = draft.guidedBotId, let threadId = draft.guidedThreadId {
            WizardChatView(botId: guideId, threadId: threadId)
        } else {
            VStack(spacing: 10) {
                Spacer()
                if let guide {
                    ProgressView()
                    Text("Starting the conversation with \(guide.name)…").font(Theme.Font.preview).foregroundStyle(Theme.textSecondary)
                } else {
                    Text("No other bot can guide you yet. Fill in the steps, they are the same.")
                        .font(Theme.Font.preview).foregroundStyle(Theme.textSecondary).multilineTextAlignment(.center)
                }
                Spacer()
            }
            .padding(20)
            .frame(maxWidth: .infinity)
        }
    }

    private func stepPane(draft: WizardDraft, bot: Bot) -> some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text(stepIntro(draft.step)).font(Theme.Font.body).foregroundStyle(Theme.textSecondary)
                    WizardStepBody(step: draft.step, bot: bot, draft: draft, suggestions: suggestions, language: language,
                                   patch: { await patch($0) }, goTo: { step in Task { await patch(WizardPatch(step: step)) } })
                        .id(draft.step)
                }
                .padding(20)
                .frame(maxWidth: 720)
                .frame(maxWidth: .infinity)
            }
            footer(draft: draft)
        }
    }

    private func footer(draft: WizardDraft) -> some View {
        VStack(spacing: 10) {
            ProgressView(value: Double(draft.step.index + 1), total: Double(WizardStep.allCases.count))
                .tint(Theme.accent)
                .accessibilityLabel(Text("Step \(draft.step.index + 1) of \(WizardStep.allCases.count)"))
            HStack {
                if let previous = draft.step.previous {
                    Button("Back") { Task { await patch(WizardPatch(step: previous)) } }
                        .foregroundStyle(Theme.textSecondary)
                        .accessibilityIdentifier("wizard-back")
                }
                Spacer()
                Text("Step \(draft.step.index + 1) of \(WizardStep.allCases.count)")
                    .font(Theme.Font.preview).foregroundStyle(Theme.textSecondary)
                Spacer()
                if draft.step != .recap {
                    Button("Skip") { Task { await patch(WizardPatch(skip: draft.step)) } }
                        .foregroundStyle(Theme.textSecondary)
                        .accessibilityIdentifier("wizard-skip")
                    Button {
                        if let next = draft.step.next { Task { await patch(WizardPatch(step: next)) } }
                    } label: {
                        Text("Continue").font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.primaryInk)
                            .padding(.horizontal, 18).frame(height: 38)
                            .background(Theme.primaryFill, in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("wizard-next")
                } else {
                    Button { Task { await finish() } } label: {
                        Group {
                            if busy == "finish" { ProgressView() } else { Text("Finish").font(.system(size: 14, weight: .semibold)) }
                        }
                        .foregroundStyle(Theme.primaryInk)
                        .padding(.horizontal, 18).frame(height: 38)
                        .background(Theme.primaryFill, in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .disabled(busy == "finish")
                    .accessibilityIdentifier("wizard-finish")
                }
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
        .background(Theme.bg)
    }

    // MARK: Actions

    private func load() async {
        guard let client else { phase = .choose; return }
        if let id = request.botId {
            botId = id
            if !request.redo, let (found, kit) = try? await client.wizardDraft(botId: id, language: language), found.isOpen {
                draft = found
                suggestions = kit
                phase = .steps
                return
            }
            phase = .choose
        } else {
            drafts = (try? await client.wizardDrafts()) ?? []
            phase = .choose
        }
    }

    private func choose(_ mode: WizardMode, resume: WizardDraft? = nil) async {
        guard busy == nil, let client else { return }
        busy = mode.rawValue
        error = nil
        defer { busy = nil }
        do {
            var target: Bot? = resume.flatMap { session.state.bot($0.botId) } ?? bot
            var origin = resume?.origin ?? (request.botId != nil ? "redo" : "new")
            if target == nil {
                let created = try await client.createWizardBot()
                session.applyProfileBot(created)
                target = created
                origin = "new"
            }
            guard let target else { return }
            let started = try await client.startWizard(botId: target.id, origin: origin, mode: mode, restart: request.redo)
            botId = target.id
            draft = started
            await refreshSuggestions()
            phase = .steps
            if mode == .guided { await ensureGuided(started, name: target.name) }
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func refreshSuggestions() async {
        guard let client, let id = botId, let (fresh, kit) = try? await client.wizardDraft(botId: id, language: language) else { return }
        draft = fresh
        suggestions = kit
    }

    private func patch(_ value: WizardPatch) async {
        guard let client, let id = botId else { return }
        do {
            draft = try await client.patchWizard(botId: id, patch: value)
            if value.roleId != nil { await refreshSuggestions() }
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func switchMode(_ mode: WizardMode) async {
        guard let current = draft, current.mode != mode else { return }
        draft = BotWizardRules.switching(current, to: mode)
        await patch(WizardPatch(mode: mode))
        if mode == .guided, let current = draft { await ensureGuided(current, name: bot?.name ?? current.botName ?? "") }
    }

    /// The guided conversation: a new topic with the guide, opened by the
    /// person's own request naming the bot. Once per draft.
    private func ensureGuided(_ current: WizardDraft, name: String) async {
        guard current.guidedThreadId == nil, let guide, let client else { return }
        do {
            let threadId = try await client.openWizardThread(botId: guide.id, title: String(localized: "Setting up \(name)"))
            await patch(WizardPatch(guidedBotId: guide.id, guidedThreadId: threadId))
            _ = try await client.send(text: BotWizardRules.kickoff(botName: name, french: french), toBot: guide.id, threadId: threadId)
        } catch {
            self.error = error.localizedDescription
        }
    }

    private var guidedPollKey: String { "\(phase == .steps)-\(draft?.mode.rawValue ?? "")-\(botId ?? "")" }

    /// Guided: read the draft back while the Primary Bot fills it, and make
    /// the rules it marked with the person's own session.
    private func pollGuided() async {
        guard phase == .steps, draft?.mode == .guided, let id = botId, let client else { return }
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: 2_500_000_000)
            guard !Task.isCancelled, let (fresh, kit) = try? await client.wizardDraft(botId: id, language: language) else { continue }
            if fresh.updatedAt != draft?.updatedAt {
                draft = fresh
                suggestions = kit
            }
            for ruleId in BotWizardRules.pendingRules(fresh) {
                guard let suggestion = kit.rules.first(where: { $0.id == ruleId }),
                      let made = try? await client.addWizardRule(botId: id, suggestion: suggestion) else { continue }
                await patch(WizardPatch(rules: [ruleId: made]))
            }
        }
    }

    private func finish() async {
        guard let current = draft, let client, busy == nil else { return }
        busy = "finish"
        error = nil
        defer { busy = nil }
        var failed: [String] = []
        for routineId in current.routines {
            guard let suggestion = suggestions.routines.first(where: { $0.id == routineId }) else { continue }
            do { try await client.addWizardRoutine(botId: current.botId, suggestion: suggestion) } catch { failed.append(suggestion.name) }
        }
        do {
            _ = try await client.finishWizard(botId: current.botId)
            if !failed.isEmpty {
                session.actionError = String(localized: "The bot is ready, but these routines could not be created: \(failed.joined(separator: ", ")).")
            }
            Haptics.success()
            close(current.botId)
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func discard(_ entry: WizardDraft) async {
        guard let client else { return }
        do {
            try await client.deleteWizard(botId: entry.botId)
            if entry.origin == "new", let bot = session.state.bot(entry.botId) { _ = await session.deleteBot(bot) }
            drafts.removeAll { $0.botId == entry.botId }
        } catch {
            self.error = error.localizedDescription
        }
    }
}

func stepTitle(_ step: WizardStep) -> String {
    switch step {
    case .identity: String(localized: "Identity")
    case .soul: String(localized: "Soul")
    case .rules: String(localized: "Rules")
    case .tools: String(localized: "Tools and apps")
    case .routines: String(localized: "Routines")
    case .recap: String(localized: "Recap and try")
    }
}

func stepIntro(_ step: WizardStep) -> String {
    switch step {
    case .identity: String(localized: "Its name, its look, its role in one sentence, and whether it is your Primary Bot.")
    case .soul: String(localized: "How it talks and what it does. Answer what you like, then let it write its soul from your answers.")
    case .rules: String(localized: "One approval level, and the rules that come first. Tick the ones that suit this bot.")
    case .tools: String(localized: "Only what this role uses: apps, MCP servers, the computer and the browser.")
    case .routines: String(localized: "Optional: a few routines suggested for this role. Tick the ones you want.")
    case .recap: String(localized: "Everything on one page, still editable. Try it with a first message before you finish.")
    }
}
