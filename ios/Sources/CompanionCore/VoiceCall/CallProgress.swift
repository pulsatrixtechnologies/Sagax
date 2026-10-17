// Short progress lines while the bot works on a call: the desktop's
// src/lib/voice-mode/progress.ts, same rules, so both apps say the same.
//
// Never a canned filler: every line comes from a real tool event of this
// turn (a tool still running, how many finished), worded by the app, never
// the tool's name, its arguments or an identifier. Only while the bot works
// and nobody talks; the first line once a tool has run 1.5 s with nothing
// said (the quick first sentence before a slow step, on every engine);
// later lines after 7 s of silence and 9 s since the last one, five per
// turn at most; a barge-in stops them until the next turn is sent.
import Foundation

public enum CallProgressKind: String, Equatable, Sendable {
    case check, search, web, command, change, screen, teammate, work
}

/// A line to say: what the running tool does, or how far the turn is.
public enum CallProgressLine: Equatable, Sendable {
    case kind(CallProgressKind)
    case still
    case steps(Int)
}

public struct CallProgress: Sendable {
    public static let firstMs: Double = 1_500
    public static let quietMs: Double = 7_000
    public static let gapMs: Double = 9_000
    public static let maxLines = 5

    /// One activity row of the call's turn (ok is nil while it runs).
    public struct Tool: Equatable, Sendable {
        public var id: String
        public var name: String
        public var ok: Bool?
        public init(id: String, name: String, ok: Bool? = nil) {
            self.id = id
            self.name = name
            self.ok = ok
        }
    }

    private var turnAt: Double = 0
    private var quietSince: Double = 0
    private var lastLineAt: Double = -.infinity
    private var lines = 0
    private var lastKind: CallProgressKind?
    private var lastSteps = 0
    private var said = false
    private var stopped = true
    private var seen: [String: Double] = [:]

    public init() {}

    public var active: Bool { !stopped }

    /// A new turn was sent: lines may start again.
    public mutating func turnSent(now: Double) {
        turnAt = now
        quietSince = now
        lastLineAt = -.infinity
        lines = 0
        lastKind = nil
        lastSteps = 0
        said = false
        stopped = false
    }

    /// The bot was heard or wrote words to say.
    public mutating func heard(now: Double) {
        quietSince = now
        said = true
    }

    /// Barge-in, hang-up: nothing more for this turn.
    public mutating func stop() {
        stopped = true
    }

    /// The line to say now, or nil. A returned line counts as said.
    public mutating func next(now: Double, thinking: Bool, botBusy: Bool, botSpeaking: Bool, awaitingAnswer: Bool, tools: [Tool]) -> CallProgressLine? {
        for tool in tools where seen[tool.id] == nil { seen[tool.id] = now }
        if botSpeaking {
            quietSince = now
            return nil
        }
        guard !stopped, botBusy, thinking, !awaitingAnswer else { return nil }
        guard lines < Self.maxLines, now - lastLineAt >= Self.gapMs else { return nil }
        guard let running = tools.last(where: { $0.ok == nil }), let kind = Self.kind(running.name) else { return nil }
        let done = tools.filter { $0.ok != nil }.count
        let runningFor = now - (seen[running.id] ?? now)
        let line: CallProgressLine
        if lines == 0 && !said {
            guard runningFor >= Self.firstMs else { return nil }
            line = .kind(kind)
        } else {
            guard now - max(quietSince, turnAt) >= Self.quietMs else { return nil }
            if kind != lastKind { line = .kind(kind) }
            else if done >= 2 && done > lastSteps { line = .steps(done) }
            else { line = .still }
        }
        lines += 1
        lastLineAt = now
        quietSince = now
        switch line {
        case let .kind(value): lastKind = value
        case let .steps(count): lastSteps = count
        case .still: break
        }
        return line
    }

    // MARK: - What a tool name stands for

    private static let silent: Set<String> = [
        "end_call", "askuser", "ask_user", "askuserquestion", "ask_user_question", "request_user_input",
        "todowrite", "todo_write", "update_plan", "think", "exitplanmode", "exit_plan_mode",
    ]

    private static let exact: [(Set<String>, CallProgressKind)] = [
        (["bash", "shell", "terminal", "run_command", "run_terminal_cmd", "execute", "exec_command", "computer_exec", "local_shell", "powershell"], .command),
        (["read", "read_file", "view", "view_file", "open_file", "cat", "ls", "list_dir", "list_directory", "notebookread"], .check),
        (["write", "write_file", "create_file", "edit", "edit_file", "apply_patch", "str_replace", "str_replace_editor", "multiedit", "notebookedit"], .change),
        (["grep", "glob", "find", "search", "codebase_search", "file_search", "grep_search"], .search),
        (["websearch", "web_search", "webfetch", "web_fetch", "fetch", "browse", "open_url", "navigate"], .web),
        (["screenshot", "screen", "take_screenshot", "computer_screenshot", "click", "type_text", "press_key", "scroll", "computer", "computer_batch", "mouse_move", "key"], .screen),
        (["list_bots", "ask_bot", "send_prompt", "delegate"], .teammate),
    ]

    private static let verbs: [(Set<String>, CallProgressKind)] = [
        (["search", "find", "lookup", "grep", "query"], .search),
        (["get", "list", "read", "fetch", "describe", "check", "status", "show", "view", "count", "recall", "load", "download", "export", "inspect", "preview", "api"], .check),
        (["create", "update", "write", "log", "delete", "remove", "set", "add", "post", "patch", "put", "send", "book", "approve", "assign", "close", "move", "rename", "upload", "save", "apply", "merge", "edit", "cancel", "archive", "reply", "forward", "schedule"], .change),
        (["run", "exec", "execute", "invoke", "start", "restart", "deploy", "build", "test"], .command),
    ]

    /// The kind of work a tool name stands for, or nil when it never gets a
    /// line. Only the category is ever spoken, never the name.
    public static func kind(_ toolName: String) -> CallProgressKind? {
        let name = toolName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return nil }
        // chips the harness writes for other things: their own words are spoken
        if name.range(of: "^(auto-approved|error)\\s*:", options: [.regularExpression, .caseInsensitive]) != nil { return nil }
        let own = name.replacingOccurrences(of: "__", with: "\u{1F}")
            .split(whereSeparator: { $0 == "\u{1F}" || $0 == "." || $0 == "/" })
            .last.map(String.init) ?? name
        let bare = own.lowercased()
        if silent.contains(bare.replacingOccurrences(of: "-", with: "_").replacingOccurrences(of: " ", with: "_")) { return nil }
        for (names, kind) in exact where names.contains(bare) { return kind }
        // split on _ - and space, and before a capital after a lower-case letter
        var words: [String] = []
        var current = ""
        var previousLower = false
        for character in own {
            if character == "_" || character == "-" || character == " " {
                if !current.isEmpty { words.append(current.lowercased()) }
                current = ""
                previousLower = false
                continue
            }
            if character.isUppercase && previousLower {
                words.append(current.lowercased())
                current = ""
            }
            current.append(character)
            previousLower = character.isLowercase
        }
        if !current.isEmpty { words.append(current.lowercased()) }
        for word in words.prefix(2) {
            for (names, kind) in verbs where names.contains(word) { return kind }
        }
        return .work
    }

    /// The activity rows of the call's current turn: those after the
    /// person's last own line (a parallel task's rows are another topic's).
    public static func turnTools(_ messages: [Message]) -> [Tool] {
        var out: [Tool] = []
        for message in messages.reversed() {
            if message.role == .user && message.parallelTask == nil { break }
            guard message.kind == .activity, message.parallelTask == nil, let tool = message.tool, !tool.name.isEmpty else { continue }
            out.append(Tool(id: message.id, name: tool.name, ok: tool.ok))
        }
        return out.reversed()
    }
}
