// Edit bot in the Grok Bot layout (2026-10-27), the iPhone's pages, drawn
// from `BotEditTree` with the Settings cards (#1168): the bot's header
// (avatar, name, role), the main sections with the wizard's recap line at
// their end (Identity, Personality, Model, Approvals, Tools and apps,
// Routines, Sharing), Advanced, then Archive and Delete apart, in red. A
// row opens a page of the tree (Identity, Personality, Tools and apps,
// Sharing, Advanced) or a section's own page, pushed on the bot panel's
// stack, so Back walks the way in.
//
// Rows keep the identifiers they had: a section is `panel-row.<section>`
// wherever it now sits; a tree page is `panel-edit-page.<page>`.
import CompanionCore
import SwiftUI

/// What Edit bot's rows do, given by the bot panel that holds the stack.
struct BotEditActions {
    var openPage: (BotEditPageID) -> Void
    var openSection: (DesktopPanelSection) -> Void
    var openRoutines: () -> Void
    var editAvatar: () -> Void
    var archive: () -> Void
    var delete: () -> Void
    var close: () -> Void
}

extension LocalizedStringKey {
    /// The English source text of a literal key (search labels).
    var sourceText: String {
        Mirror(reflecting: self).children.first { $0.label == "key" }?.value as? String ?? ""
    }
}

extension BotEditActions {
    /// What a search result does: the row's own action, else the page that holds it.
    func open(_ item: BotEditItem, context: BotEditContext) {
        if item == .avatar { editAvatar(); return }
        if item == .routines { openRoutines(); return }
        if let page = item.opens { openPage(page); return }
        if let section = item.section { openSection(section); return }
        if let page = BotEditTree.path(to: item, context)?.last { openPage(page) }
    }
}

extension BotEditPageID {
    var title: LocalizedStringKey {
        switch self {
        case .root: "Edit bot"
        case .identity: "Identity"
        case .personality: "Personality"
        case .toolsApps: "Tools and apps"
        case .sharing: "Sharing"
        case .advanced: "Advanced"
        }
    }
}

extension BotEditItem {
    /// The row's label (a section row keeps its section's name, except
    /// Personality's Soul, the wizard's word for it).
    var title: LocalizedStringKey {
        switch self {
        case .header: "Edit bot"
        case .identity: "Identity"
        case .personality: "Personality"
        case .model: "Model"
        case .approvals: "Approvals"
        case .toolsApps: "Tools and apps"
        case .routines: "Routines"
        case .sharing: "Sharing"
        case .advanced: "Advanced"
        case .archive: "Archive…"
        case .delete: "Delete bot…"
        case .name: "Name"
        case .role: "Role"
        case .botDescription: "Description"
        case .avatar: "Avatar"
        case .callVoice: "Voice"
        case .callSpeed: "Speed"
        case .callLanguage: "Language"
        case .soul: "Soul"
        default: section?.title ?? ""
        }
    }

    /// The identifier UI tests and the harness find the row by.
    var identifier: String {
        if let section { return "panel-row.\(section.rawValue)" }
        if let page = opens { return "panel-edit-page.\(page.rawValue)" }
        return "panel-edit-row.\(rawValue)"
    }
}

/// The recap line of each main row, in the wizard's words.
struct BotEditSummaries {
    let bot: Bot
    let rules: [CustomRuleRow]?
    let routines: [Routine]?

    func value(_ item: BotEditItem) -> String? {
        switch item {
        case .identity:
            let parts = [BotEditSummary.role(bot), bot.chiefOfStaff == true ? String(localized: "Primary Bot") : ""].filter { !$0.isEmpty }
            return parts.isEmpty ? nil : parts.joined(separator: " · ")
        case .personality:
            return BotEditSummary.soulWritten(bot) ? String(localized: "Written") : String(localized: "Not written yet")
        case .model:
            let selection = bot.modelSelection
            let name = selection.model.isEmpty ? String(localized: "Default") : selection.model
            return selection.auto == true ? String(localized: "Auto · \(name)") : name
        case .approvals:
            let level = Self.levelTitle(ApprovalLevel.of(approvalMode: bot.approvalSettingMode, autoApprove: bot.autoApprove))
            guard let rules else { return level }
            let counts = BotEditSummary.ruleCounts(rules, botId: bot.id)
            let parts = [
                counts.ask > 0 ? String(localized: "\(counts.ask) asked") : "",
                counts.deny > 0 ? String(localized: "\(counts.deny) denied") : "",
                counts.allow > 0 ? String(localized: "\(counts.allow) allowed") : "",
            ].filter { !$0.isEmpty }
            return [level, parts.isEmpty ? String(localized: "No rule") : parts.joined(separator: ", ")].joined(separator: " · ")
        case .toolsApps:
            let place = BotEditSummary.workspaceOff(bot) ? String(localized: "Off") : String(localized: "Auto")
            let mcp: String
            switch BotEditSummary.mcp(bot.mcpServers) {
            case .all: mcp = String(localized: "Every MCP server")
            case .none: mcp = String(localized: "No MCP server")
            case let .some(names): mcp = String(localized: "MCP: \(names.joined(separator: ", "))")
            }
            return [String(localized: "Workspace: \(place)"), mcp].joined(separator: " · ")
        case .routines:
            guard let routines else { return nil }
            let names = BotEditSummary.routineNames(botId: bot.id, in: routines)
            return names.isEmpty ? String(localized: "No routine") : names.joined(separator: ", ")
        default:
            return nil
        }
    }

    static func levelTitle(_ level: ApprovalLevel) -> String {
        switch level {
        case .ask: String(localized: "Ask for approval")
        case .edits: String(localized: "Auto-accept edits")
        case .auto: String(localized: "Approve for me")
        case .full: String(localized: "Full access")
        case .custom: String(localized: "Custom")
        }
    }
}

// MARK: - Root

/// Edit bot: the header, the main sections, Advanced, Archive and Delete.
struct PhoneBotEditRoot: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    let bot: Bot
    let context: BotEditContext
    let routines: [Routine]?
    let actions: BotEditActions

    @State private var rules: [CustomRuleRow]?
    @State private var query = ""

    private var results: [BotEditItem] {
        BotEditSearch.results(query, context: context) { $0.title.sourceText }
    }

    private var summaries: BotEditSummaries { BotEditSummaries(bot: bot, rules: rules, routines: routines) }

    var body: some View {
        ScrollViewReader { proxy in
            SettingsPage(title: "Edit bot", leading: .close(actions.close)) {
                BotEditSearchField(query: $query)
                SettingsSpacer(14)
                if query.trimmingCharacters(in: .whitespaces).isEmpty {
                    BotEditCards(page: .root, bot: bot, context: context, summaries: summaries, actions: actions)
                } else {
                    BotEditSearchResults(query: query, items: results, context: context, actions: actions)
                }
                Color.clear.frame(height: 1).id("persona-end")
            }
            .task {
                #if DEBUG
                if UserDefaults.standard.bool(forKey: "parityBotEditBottom") {
                    try? await Task.sleep(nanoseconds: 900_000_000)
                    proxy.scrollTo("persona-end", anchor: .bottom)
                }
                #endif
            }
        }
        .task(id: bot.id) {
            guard context.sections.contains(.permissions), let client = session.settingsClient else { return }
            rules = (try? await client.customRules(botId: bot.id))?.rules
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("panel-persona")
    }
}

/// A page of the tree below the root.
struct PhoneBotEditPage: View {
    @Environment(\.themePalette) var themePalette
    let page: BotEditPageID
    let bot: Bot
    let context: BotEditContext
    let actions: BotEditActions

    var body: some View {
        ScrollViewReader { proxy in
            SettingsPage(title: page.title) {
                BotEditCards(page: page, bot: bot, context: context, summaries: BotEditSummaries(bot: bot, rules: nil, routines: nil), actions: actions)
                Color.clear.frame(height: 1).id("edit-page-end")
            }
            .task {
                #if DEBUG
                if UserDefaults.standard.bool(forKey: "parityBotEditBottom") {
                    try? await Task.sleep(nanoseconds: 900_000_000)
                    proxy.scrollTo("edit-page-end", anchor: .bottom)
                }
                #endif
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("panel-edit.\(page.rawValue)")
    }
}

// MARK: - Search

/// The box at the top of Edit bot: a word finds the row that holds it.
private struct BotEditSearchField: View {
    @Environment(\.themePalette) var themePalette
    @Binding var query: String

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
            TextField("Search", text: $query)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .accessibilityIdentifier("panel-edit-search")
            if !query.isEmpty {
                Button { query = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary) }
                    .accessibilityLabel(Text("Clear"))
            }
        }
        .padding(.horizontal, 12)
        .frame(height: 40)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color.primary.opacity(0.06)))
        .padding(.horizontal, SettingsMetrics.rowInset)
    }
}

/// What the word found, or a clear line when nothing matches.
private struct BotEditSearchResults: View {
    let query: String
    let items: [BotEditItem]
    let context: BotEditContext
    let actions: BotEditActions

    var body: some View {
        if items.isEmpty {
            Text("Nothing matches “\(query.trimmingCharacters(in: .whitespaces))”")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 24)
                .accessibilityIdentifier("panel-edit-search-empty")
        } else {
            SettingsCard {
                ForEach(Array(items.enumerated()), id: \.element) { position, item in
                    if position > 0 { CardHairline(leadingInset: SettingsMetrics.rowInset) }
                    SettingsRow(title: item.title, subtitle: parent(of: item), accessory: .chevron, height: 56,
                                identifier: "panel-edit-result.\(item.rawValue)") { actions.open(item, context: context) }
                }
            }
        }
    }

    /// The page the row sits on, under its name.
    private func parent(of item: BotEditItem) -> String? {
        guard let page = BotEditTree.path(to: item, context)?.last else { return nil }
        return page.title.sourceText
    }
}

// MARK: - Cards

/// A page's cards, with the few labels and footers the layout keeps.
private struct BotEditCards: View {
    @Environment(\.themePalette) var themePalette
    let page: BotEditPageID
    let bot: Bot
    let context: BotEditContext
    let summaries: BotEditSummaries
    let actions: BotEditActions

    var body: some View {
        let cards = BotEditTree.cards(page, context)
        ForEach(Array(cards.enumerated()), id: \.offset) { index, card in
            if let label = Self.label(card) {
                SettingsSectionLabel(text: label)
            } else if index > 0, Self.footer(cards[index - 1]) == nil {
                // a footer already leaves its gap under it
                SettingsSpacer(SettingsMetrics.cardGap)
            }
            switch card.first {
            case .header?:
                BotEditHeaderRow(bot: bot) { actions.openPage(.identity) }
            case .name?:
                // the identity fields are their own card (PhoneBotIdentityFields)
                PhoneBotIdentityFields(bot: bot, onAvatar: actions.editAvatar)
            case .callVoice?:
                PhoneBotCallVoiceCard(bot: bot)
            default:
                SettingsCard {
                    ForEach(Array(card.enumerated()), id: \.element) { position, item in
                        if position > 0 { CardHairline(leadingInset: SettingsMetrics.rowInset) }
                        row(item)
                    }
                }
            }
            if let footer = Self.footer(card) {
                SettingsFooter(text: footer)
            }
        }
    }

    @ViewBuilder
    private func row(_ item: BotEditItem) -> some View {
        let value = summaries.value(item)
        let accessory: SettingsRow.Accessory = value.map { .valueChevron($0) } ?? .chevron
        if item.destructive {
            SettingsRow(title: item.title, style: .destructive, height: 44, identifier: item.identifier) {
                item == .archive ? actions.archive() : actions.delete()
            }
        } else {
            SettingsRow(title: item.title, accessory: accessory, height: 44, identifier: item.identifier,
                        accessibilityValueText: value) { open(item) }
        }
    }

    private func open(_ item: BotEditItem) {
        if item == .avatar { actions.editAvatar(); return }
        if item == .routines { actions.openRoutines(); return }
        if let page = item.opens { actions.openPage(page); return }
        if let section = item.section { actions.openSection(section) }
    }

    private static func label(_ card: [BotEditItem]) -> LocalizedStringKey? {
        switch card.first {
        case .callVoice?: "Voice calls"
        case .avatar?: "Appearance"
        default: nil
        }
    }

    private static func footer(_ card: [BotEditItem]) -> LocalizedStringKey? {
        switch card.first {
        case .name?: "Shown in rosters, on the phone and to other bots. Standing instructions go in Personality."
        case .archive?: "Its conversations are kept. Archived bots in the account menu brings it back."
        case .delete?: "The bot and its conversations will be deleted. This cannot be undone."
        default: nil
        }
    }
}

/// The compact header: the avatar, the name and the role, opening Identity.
private struct BotEditHeaderRow: View {
    @Environment(\.themePalette) var themePalette
    let bot: Bot
    let action: () -> Void

    var body: some View {
        SettingsCard {
            Button {
                Haptics.selection()
                action()
            } label: {
                HStack(spacing: 0) {
                    BotMascotView(bot: bot, size: 48, state: .idle, animated: false)
                        .frame(width: 48, height: 48)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(verbatim: bot.name)
                            .font(Theme.Font.rowTitle)
                            .foregroundStyle(Theme.textPrimary)
                            .lineLimit(1)
                        let role = BotEditSummary.role(bot)
                        Group {
                            if role.isEmpty { Text("Add a role") } else { Text(verbatim: role) }
                        }
                        .font(Theme.Font.label)
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(1)
                    }
                    .padding(.leading, 12)
                    Spacer(minLength: 12)
                    SettingsChevron()
                }
                .padding(.leading, SettingsMetrics.rowInset - 4)
                .padding(.trailing, SettingsMetrics.chevronTrailing - 4)
                .frame(height: 72)
                .contentShape(Rectangle())
            }
            .buttonStyle(SettingsRowButtonStyle())
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isButton)
            .accessibilityIdentifier("panel-edit-header")
        }
    }
}
