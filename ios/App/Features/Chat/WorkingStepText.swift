// The working line's step in the reader's language (2026-10-29): the
// server names the step once (shared/working-step.ts) and the phone words
// it here with the same phrases as the desktop (chat.step.* in
// src/locales), so every engine's turn reads alike.
import CompanionCore
import Foundation

enum WorkingStepText {
    static func label(_ step: WorkingStep) -> String? {
        let detail = WorkingStepLine.readsDetail(step) ? step.detail : nil
        switch step.key {
        case "readMail": return String(localized: "Reading your email")
        case "writeMail": return String(localized: "Writing an email")
        case "calendar": return String(localized: "Checking your calendar")
        case "writeCalendar": return String(localized: "Updating your calendar")
        case "readChat": return detail.map { String(localized: "Reading \($0)") } ?? String(localized: "Reading your messages")
        case "writeChat": return detail.map { String(localized: "Writing in \($0)") } ?? String(localized: "Writing a message")
        case "openApp": return detail.map { String(localized: "Opening \($0)") } ?? String(localized: "Opening an app")
        case "browse": return detail.map { String(localized: "Browsing \($0)") } ?? String(localized: "Browsing the web")
        case "readPage": return detail.map { String(localized: "Reading \($0)") } ?? String(localized: "Reading a web page")
        case "searchWeb": return String(localized: "Searching the web")
        case "run": return detail.map { String(localized: "Running \($0)") } ?? String(localized: "Running a command")
        case "readFile": return detail.map { String(localized: "Reading \($0)") } ?? String(localized: "Reading a file")
        case "writeFile": return detail.map { String(localized: "Writing \($0)") } ?? String(localized: "Writing a file")
        case "editFile": return detail.map { String(localized: "Editing \($0)") } ?? String(localized: "Editing a file")
        case "searchFiles": return String(localized: "Searching files")
        case "screen": return String(localized: "Looking at the screen")
        case "computer": return detail.map { String(localized: "Using \($0)") } ?? String(localized: "Using the computer")
        case "teammate": return String(localized: "Talking to a teammate")
        case "subagent": return String(localized: "Handing a part to a sub-agent")
        case "memory": return String(localized: "Checking its memory")
        case "tool": return detail.map { String(localized: "Using \($0)") } ?? String(localized: "Using a tool")
        default: return nil
        }
    }

    /// "last output 2 min ago", or nil while the step is young.
    static func quiet(since: Double, now: Date) -> String? {
        guard let minutes = WorkingStepLine.quietMinutes(since: since, now: now.timeIntervalSince1970 * 1_000) else { return nil }
        if minutes < 60 { return String(localized: "last output \(minutes) min ago") }
        return String(localized: "last output \(minutes / 60) h ago")
    }
}
