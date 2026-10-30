import Foundation

/// A bot's proactive mode (`shared/proactive-mode.ts`, 2026-10-30 wired in
/// `server/proactive-wake.ts`): how it acts on an email, a calendar entry, a
/// failed run, a bot's post or a webhook on its own. Absent on the wire is
/// the default (`followRules`); an unknown value reads as off, like the
/// server.
public enum ProactiveMode: String, CaseIterable, Hashable, Sendable {
    case off
    case propose
    case readAuto = "read-auto"
    case followRules = "follow-rules"

    public static let defaultMode: ProactiveMode = .followRules

    public static func of(_ raw: String?) -> ProactiveMode {
        guard let raw else { return defaultMode }
        return ProactiveMode(rawValue: raw) ?? .off
    }

    /// The desktop's labels (`botPanel.permissions.proactive.*`).
    public var label: String {
        switch self {
        case .off: String(localized: "Off")
        case .propose: String(localized: "Propose only")
        case .readAuto: String(localized: "Read on its own, card to act")
        case .followRules: String(localized: "Follow approval rules")
        }
    }

    public var hint: String {
        switch self {
        case .off: String(localized: "No proactive behavior. Routines still run on their schedule or when a trigger fires.")
        case .propose: String(localized: "It may look (read-only) and propose an action on a card. It runs nothing until you say yes.")
        case .readAuto: String(localized: "It may read, summarize, classify and prepare drafts on its own, and shows a card for any write or send.")
        case .followRules: String(localized: "A proactive action follows this bot's approval level and rules, exactly like a normal action.")
        }
    }
}

/// A proactive proposal card (`OptionCardData.proactiveProposal`,
/// `shared/proactive-proposal.ts`): options[0] accepts, options[1]
/// declines; the answer goes to `POST /api/bots/:id/proactive/:proposalId`.
public enum ProactiveProposalRules {
    public static func isProposal(_ card: OptionCard) -> Bool {
        card.proactiveProposal != nil
    }

    /// Whether the picked option is the card's yes (its first option).
    public static func accepts(_ card: OptionCard, answer: String) -> Bool {
        guard let yes = card.options.first?.trimmingCharacters(in: .whitespacesAndNewlines), !yes.isEmpty else { return false }
        return answer.trimmingCharacters(in: .whitespacesAndNewlines) == yes
    }

    /// Answered: the server marked the pick on the card.
    public static func isSettled(_ card: OptionCard) -> Bool {
        card.proactiveProposal != nil && card.answered != nil
    }
}

/// The proposal a card carries (only its id crosses the wire).
public struct ProactiveProposalRef: Codable, Hashable, Sendable {
    public var id: String
    public init(id: String) { self.id = id }
}
