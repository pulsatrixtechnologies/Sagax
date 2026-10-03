// The words of the bot activity feature (matrix row BP10), from the
// desktop's locale keys `botPanel.coding.*`, `botPanel.activity.*`,
// `botPanel.history.*` and `activity.step.*` (src/locales/en.json).
import CompanionCore
import SwiftUI

enum BotActivityWording {
    static func status(_ status: BotActivityStatus) -> String {
        switch status {
        case .running: String(localized: "Running")
        case .waiting: String(localized: "Waiting for approval")
        case .queued: String(localized: "Queued")
        case .finished: String(localized: "Finished")
        case .failed: String(localized: "Failed")
        case .stopped: String(localized: "Stopped")
        }
    }

    /// The card's second line (`activitySubtitle` plus the parallel and
    /// sub-agent tags of ActivityCard.tsx).
    static func subtitle(_ item: BotActivityItem, now: Double?) -> String {
        BotActivitySubtitlePart.parts(for: item, now: now).map { part in
            switch part {
            case .parallel: String(localized: "Parallel task")
            case let .status(status): Self.status(status)
            case let .elapsed(text): text
            case let .botName(name): name
            case .routine: String(localized: "Routine")
            case let .handedBy(name): String(localized: "from \(name)")
            case let .step(step): step
            case let .subagents(count): String(localized: "\(count) sub-agents")
            }
        }.joined(separator: " · ")
    }

    static func via(_ via: BotActivityVia) -> String {
        switch via {
        case .subscription: String(localized: "Personal subscription")
        case .ownerKey: String(localized: "Bot owner's key")
        case .speakerKey: String(localized: "Personal key")
        case .server: String(localized: "This server")
        case .orgKey: String(localized: "Organization key")
        }
    }

    static func place(_ place: BotActivityStep.Where) -> String {
        switch place {
        case .computer: String(localized: "Your computer")
        case .server: String(localized: "Server environment")
        }
    }

    static func filter(_ filter: BotActivityFilter) -> String {
        switch filter {
        case .coding: String(localized: "Coding")
        case .other: String(localized: "Other activity")
        }
    }

    static func historyStatus(_ status: BotActivityHistoryStatus) -> String {
        switch status {
        case .all: String(localized: "All")
        case .running: String(localized: "Running")
        case .finished: String(localized: "Finished")
        case .failed: String(localized: "Failed")
        }
    }

    /// `humanStepName`, capitalized as the desktop does.
    static func step(_ step: BotActivityStep) -> String {
        let text: String
        switch BotActivityStepLabel.of(step) {
        case let .subagent(description?): return String(localized: "Sub-agent: \(description)")
        case .subagent(nil): return String(localized: "Sub-agent")
        case .toolSearch: text = String(localized: "find a tool")
        case .searchFiles: text = String(localized: "search files")
        case .listFiles: text = String(localized: "list files")
        case .todo: text = String(localized: "update the to-do list")
        case .runCommand: text = String(localized: "run a command")
        case .readFile: text = String(localized: "read a file")
        case .writeFile: text = String(localized: "write a file")
        case .editFile: text = String(localized: "edit a file")
        case .fetchWebPage: text = String(localized: "fetch a web page")
        case .searchWeb: text = String(localized: "search the web")
        case .deleteFile: text = String(localized: "delete a file")
        case .scheduleRoutine: text = String(localized: "schedule a routine")
        case .changeRoutine: text = String(localized: "change a routine")
        case .enableSkill: text = String(localized: "enable a learned skill")
        case .updateSkill: text = String(localized: "update a learned skill")
        case .updateProfile: text = String(localized: "update its profile")
        case .think: text = String(localized: "think")
        case .takeAction: text = String(localized: "take an action")
        case .useTool: text = String(localized: "use a tool")
        case let .raw(name): text = name
        }
        guard let first = text.first else { return text }
        return first.uppercased() + text.dropFirst()
    }

    /// "Oct 3, 14:05:09": a moment of the detail (`formatTime`).
    static func time(_ milliseconds: Double) -> String {
        Date(timeIntervalSince1970: milliseconds / 1000).formatted(
            .dateTime.month(.abbreviated).day().hour().minute().second()
        )
    }
}

extension BotActivityStatus {
    /// The desktop's status icon (ActivityCard.tsx `ActivityStatusIcon`).
    var symbol: String {
        switch self {
        case .running: "arrow.triangle.2.circlepath"
        case .waiting: "hand.raised"
        case .queued: "clock"
        case .failed: "exclamationmark.circle"
        case .stopped: "nosign"
        case .finished: "checkmark.circle"
        }
    }

    var tint: Color {
        switch self {
        case .running: Theme.accentText
        case .waiting: Theme.warning
        case .queued, .stopped: Theme.textSecondary
        case .failed: Theme.danger
        case .finished: Theme.success
        }
    }
}
