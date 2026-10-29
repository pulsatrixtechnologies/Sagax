// The step a bot is on, as the server names it for the working line
// (shared/working-step.ts, 2026-10-29): a key and a short detail, the same
// whatever engine made the call. The app words the key in the reader's
// language (App/Features/Chat/WorkingStepText.swift).
import Foundation

public struct WorkingStep: Codable, Hashable, Sendable {
    public var key: String
    /// A file, an app, a host or a program name; never arguments.
    public var detail: String?

    public init(key: String, detail: String? = nil) {
        self.key = key
        self.detail = detail
    }
}

public enum WorkingStepLine {
    /// The keys this build knows (WORKING_STEP_KEYS). A newer server's key
    /// is ignored and the line stays as it was.
    public static let keys: Set<String> = [
        "readMail", "writeMail", "calendar", "writeCalendar", "readChat", "writeChat",
        "openApp", "browse", "readPage", "searchWeb", "run", "readFile", "writeFile",
        "editFile", "searchFiles", "screen", "computer", "teammate", "subagent", "memory", "tool",
    ]
    /// Keys that read with their detail (WORKING_STEP_DETAIL_KEYS).
    public static let detailKeys: Set<String> = [
        "readChat", "writeChat", "openApp", "browse", "readPage", "run", "readFile", "writeFile", "editFile", "computer", "tool",
    ]
    /// From this age on the line says how long the step has been quiet
    /// (WORKING_STEP_QUIET_MS).
    public static let quietAfterMs: Double = 60_000

    public struct Current: Hashable, Sendable {
        public var step: WorkingStep
        /// When the call started (epoch ms): nothing has come out since.
        public var since: Double
    }

    /// The step the working line names now: the newest row's, while its
    /// call still runs (currentWorkingStep). Nil between calls and after.
    public static func current(_ messages: [Message]) -> Current? {
        guard let last = messages.last(where: { $0.kind != .digest }),
              last.kind == .activity, let tool = last.tool, tool.ok == nil,
              let step = tool.step, keys.contains(step.key) else { return nil }
        return Current(step: step, since: last.at)
    }

    /// Whole minutes the step has been quiet, or nil while it is young.
    public static func quietMinutes(since: Double, now: Double) -> Int? {
        let elapsed = now - since
        guard elapsed >= quietAfterMs else { return nil }
        return Int(elapsed / 60_000)
    }

    /// Whether the step reads with its detail ("Opening Chrome").
    public static func readsDetail(_ step: WorkingStep) -> Bool {
        guard let detail = step.detail, !detail.isEmpty else { return false }
        return detailKeys.contains(step.key)
    }
}
