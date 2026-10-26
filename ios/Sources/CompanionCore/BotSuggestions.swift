// The bot panel's Suggestions card (src/lib/bot-suggestions.ts): a short
// list of next steps for this bot. What waits on the person first (a thread
// "waiting-on-you", a bot-to-bot conversation waiting for an answer), then
// the server's setup checklist (GET /api/bots/:id/overview `setup`). At most
// four. "Hide" turns the card off for every bot (`sagax.showSuggestions.v1`
// = "0"); Settings > Appearance brings it back.
import Foundation

public struct BotSuggestion: Hashable, Identifiable, Sendable {
    public enum Action: Hashable, Sendable {
        case openThread(String)
        /// A bot settings section: "overview", "soul", "access" or "routines".
        case openSection(String)
    }

    /// Stable across reloads.
    public var id: String
    /// English source string (the app's catalog localizes it).
    public var title: String
    /// English source string; `%@` takes `argument`.
    public var subtitle: String
    public var argument: String?
    public var action: Action
}

public enum BotSuggestions {
    public static let max = 4

    /// `STEP_SECTION`.
    static let stepSection: [String: String] = [
        "identity": "overview", "soul": "soul", "folder": "access", "apps": "access", "schedule": "routines",
    ]

    static let stepWords: [String: (String, String)] = [
        "identity": ("Give it a name and a role", "So people know what to ask it"),
        "soul": ("Write its standing instructions", "How it works, every conversation"),
        "folder": ("Choose a working folder", "Where its files live"),
        "apps": ("Connect the apps it needs", "Some of its tools still need a sign-in"),
        "schedule": ("Add a schedule or a trigger", "Let it work without being asked"),
    ]

    public static func suggestions(setup: [BotSetupStep]?, tasks: [BotTask]?, waiting: [BotWaitingApproval]?) -> [BotSuggestion] {
        var out: [BotSuggestion] = []
        var seen = Set<String>()
        let title = "Answer a waiting request"
        for task in tasks ?? [] {
            guard task.activity == "waiting-on-you", task.hidden != true, seen.insert(task.threadId).inserted else { continue }
            let name = task.title.trimmingCharacters(in: .whitespacesAndNewlines)
            out.append(BotSuggestion(
                id: "approval:\(task.threadId)", title: title,
                subtitle: name.isEmpty ? "A conversation is waiting for your answer" : "Waiting in %@",
                argument: name.isEmpty ? nil : name, action: .openThread(task.threadId)
            ))
        }
        for row in waiting ?? [] {
            guard seen.insert(row.threadId).inserted else { continue }
            let name = row.openedByName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            out.append(BotSuggestion(
                id: "approval:\(row.threadId)", title: title,
                subtitle: name.isEmpty ? "A conversation is waiting for your answer" : "%@ is waiting for your answer",
                argument: name.isEmpty ? nil : name, action: .openThread(row.threadId)
            ))
        }
        for step in setup ?? [] {
            guard !step.done, let section = stepSection[step.id], let words = stepWords[step.id] else { continue }
            out.append(BotSuggestion(id: "setup:\(step.id)", title: words.0, subtitle: words.1, argument: nil, action: .openSection(section)))
        }
        return Array(out.prefix(max))
    }
}
