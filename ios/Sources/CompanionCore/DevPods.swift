import Foundation

// Development context pods (src/components/dev-pods/detector.ts and
// sources.ts): whether a conversation is development work, and what the
// pods read from the transcript the chat already holds. Purely local:
// nothing is fetched and nothing is sent. When the transcript does not say
// something, the answer is nothing, never a guess dressed as data.

/// One regular expression, compiled once. The patterns below are constant,
/// so a failure to compile is a programming error caught by the tests.
struct DevPattern: @unchecked Sendable {
    let regex: NSRegularExpression

    init(_ pattern: String, caseInsensitive: Bool = false, multiline: Bool = false) {
        var options: NSRegularExpression.Options = []
        if caseInsensitive { options.insert(.caseInsensitive) }
        if multiline { options.insert(.anchorsMatchLines) }
        // swiftlint:disable:next force_try
        regex = try! NSRegularExpression(pattern: pattern, options: options)
    }

    func matches(_ text: String) -> Bool {
        regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil
    }

    /// The capture groups of the first match (nil for a group that did not take part).
    func firstGroups(_ text: String) -> [String?]? {
        guard let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) else { return nil }
        return Self.groups(match, in: text)
    }

    /// Every whole match, in order.
    func all(_ text: String) -> [String] {
        regex.matches(in: text, range: NSRange(text.startIndex..., in: text)).compactMap { match in
            Range(match.range, in: text).map { String(text[$0]) }
        }
    }

    func count(_ text: String) -> Int {
        regex.numberOfMatches(in: text, range: NSRange(text.startIndex..., in: text))
    }

    private static func groups(_ match: NSTextCheckingResult, in text: String) -> [String?] {
        (0..<match.numberOfRanges).map { index in
            let range = match.range(at: index)
            guard range.location != NSNotFound, let swiftRange = Range(range, in: text) else { return nil }
            return String(text[swiftRange])
        }
    }
}

// MARK: - Detector

public enum DevToolKind: String, CaseIterable, Hashable, Sendable {
    case shell, git, edit, pr

    var weight: Int {
        switch self {
        case .shell: 1
        case .git: 3
        case .edit: 3
        case .pr: 4
        }
    }
}

public struct DevSignals: Equatable, Sendable {
    public var score: Int
    public var tools: [DevToolKind: Int]
    public var repoPaths: Int
    public var codeBlocks: Int
    public var prLinks: Int
}

/// The pods' on/off state with its hysteresis (`devModeStep`).
public struct DevModeState: Equatable, Sendable {
    public var active: Bool
    /// Evaluations in a row under `DevDetector.exitScore` while active.
    public var quiet: Int

    public init(active: Bool, quiet: Int) {
        self.active = active
        self.quiet = quiet
    }

    public static let off = DevModeState(active: false, quiet: 0)
}

public enum DevDetector {
    /// How many of the latest messages the score reads.
    public static let window = 24
    /// Score that turns the pods on.
    public static let enterScore = 4
    /// Under this score an evaluation counts toward turning the pods off.
    public static let exitScore = 2
    /// Evaluations in a row under `exitScore` before the pods turn off.
    public static let exitStreak = 3

    static let shell: Set<String> = ["bash", "shell", "execute", "bashoutput", "run_command", "exec", "vm_exec", "terminal", "exec_command", "command_execution", "local_shell"]
    static let edit: Set<String> = ["write", "edit", "multiedit", "notebookedit", "write_file", "create_file", "edit_file", "str_replace", "str_replace_editor", "apply_patch", "file_change", "patch"]

    static let gitCommand = DevPattern(#"(?:^|[\s;&|(])git\s+(?:commit|push|pull|checkout|switch|branch|merge|rebase|worktree|diff|status|log|add|fetch|clone|cherry-pick|stash|tag)\b"#)
    static let prCommand = DevPattern(#"(?:^|[\s;&|(])gh\s+pr\s+(?:create|merge|view|edit|checkout)\b"#)
    static let prURL = DevPattern(#"https?://(?:www\.)?github\.com/[\w.-]+/[\w.-]+/pull/\d+"#, caseInsensitive: true)
    static let repoPath = DevPattern(#"(?:^|[\s"'`(])(?:~|\.{1,2})?/?(?:[\w.-]+/)+[\w.-]+\.(?:tsx?|jsx?|mjs|cjs|py|rs|go|swift|kt|java|rb|php|cs|c|cc|cpp|h|hpp|css|scss|vue|svelte|sql|sh|ya?ml|toml|json|md)\b"#)
    static let codeFence = DevPattern(#"```[\w-]*\n[\s\S]*?```"#)
    static let mcpPrefix = DevPattern(#"^mcp__[^_]+__"#)

    /// The development signal one tool row carries, if any.
    public static func toolKind(_ tool: ToolActivity) -> DevToolKind? {
        let name = tool.name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let bare = mcpPrefix.regex.stringByReplacingMatches(in: name, range: NSRange(name.startIndex..., in: name), withTemplate: "")
        let text = "\(tool.summary ?? "")\n\(tool.input ?? "")"
        if prCommand.matches(text) || prURL.matches(tool.output ?? "") { return .pr }
        if gitCommand.matches(text) { return .git }
        if edit.contains(bare) { return .edit }
        if shell.contains(bare) { return .shell }
        if bare.hasPrefix("git_") || bare.hasPrefix("github") { return .git }
        return nil
    }

    /// The score of the recent window. Each kind of signal is capped so one
    /// chatty signal cannot outweigh the others on its own.
    /// `computerActive`: the bot's computer is starting, or the thread runs
    /// on one with a screen. `explicit`: a mark from the bot (no channel
    /// carries it today; the input is ready for one).
    public static func signals(_ messages: [Message], computerActive: Bool = false, explicit: Bool = false) -> DevSignals {
        let recent = messages.suffix(window)
        var tools: [DevToolKind: Int] = [.shell: 0, .git: 0, .edit: 0, .pr: 0]
        var repoPaths = 0
        var codeBlocks = 0
        var prLinks = 0
        for message in recent {
            if message.kind == .activity, let tool = message.tool {
                if let kind = toolKind(tool) { tools[kind, default: 0] += 1 }
                if repoPath.matches("\(tool.summary ?? "") \(tool.input ?? "")") { repoPaths += 1 }
                continue
            }
            guard message.kind == .text, let text = message.text, !text.isEmpty else { continue }
            if message.role == .bot { codeBlocks += codeFence.count(text) }
            if prURL.matches(text) { prLinks += 1 }
            if repoPath.matches(text) { repoPaths += 1 }
        }
        var score = 0
        for kind in DevToolKind.allCases { score += min(2, tools[kind] ?? 0) * kind.weight }
        score += min(2, repoPaths)
        score += min(2, codeBlocks)
        score += min(1, prLinks) * 3
        if computerActive { score += 1 }
        if explicit { score += enterScore }
        return DevSignals(score: score, tools: tools, repoPaths: repoPaths, codeBlocks: codeBlocks, prLinks: prLinks)
    }

    /// One evaluation of the hysteresis.
    public static func step(_ previous: DevModeState, score: Int) -> DevModeState {
        if !previous.active { return score >= enterScore ? DevModeState(active: true, quiet: 0) : previous }
        if score >= exitScore { return previous.quiet == 0 ? previous : DevModeState(active: true, quiet: 0) }
        let quiet = previous.quiet + 1
        return quiet >= exitStreak ? .off : DevModeState(active: true, quiet: quiet)
    }
}

// MARK: - Sources

public struct DevChange: Hashable, Identifiable, Sendable {
    public enum Kind: String, Hashable, Sendable { case pull, commit }
    public var key: String
    public var kind: Kind
    public var title: String
    /// owner/repo when known.
    public var repo: String?
    public var number: Int?
    public var sha: String?
    public var url: String?
    public var messageId: String

    public var id: String { key }

    /// "owner/repo #12" for a pull request, the short sha for a commit.
    public var whereLabel: String {
        kind == .pull ? "\(repo ?? "") #\(number ?? 0)" : String((sha ?? "").prefix(7))
    }
}

public struct DevOutput: Hashable, Identifiable, Sendable {
    public var key: String
    public var name: String
    public var path: String
    /// "image", "file" or "audio".
    public var kind: String
    public var messageId: String

    public var id: String { key }
}

/// A github.com pull request URL (`parseGithubUrl`, pulls only).
public struct GithubPullRef: Hashable, Sendable {
    public var owner: String
    public var repo: String
    public var number: Int
    public var url: String

    static let shape = DevPattern(#"^https?://(?:www\.)?github\.com/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))/([A-Za-z0-9._-]{1,100})/(pull|issues|commit)/([0-9]{1,7}|[0-9a-f]{7,40})(?:[/?#].*)?$"#, caseInsensitive: true)

    public init?(url href: String) {
        let trimmed = href.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let groups = Self.shape.firstGroups(trimmed),
              let owner = groups[1], let repo = groups[2], let section = groups[3], let id = groups[4],
              repo != ".", repo != "..", section.lowercased() == "pull",
              id.allSatisfy(\.isNumber), let number = Int(id), number >= 1
        else { return nil }
        self.owner = owner
        self.repo = repo
        self.number = number
        url = trimmed
    }
}

public enum DevPodSources {
    static let branch = #"([\w][\w./-]{0,120})"#
    static let branchFromCommand = [
        DevPattern(#"git\s+(?:checkout|switch)\s+(?:-[bBcC]\s+)?"# + branch),
        DevPattern(#"git\s+worktree\s+add\s+(?:-[bB]\s+)"# + branch),
    ]
    static let branchFromOutput = [
        DevPattern(#"Switched to (?:a new )?branch '"# + branch + "'"),
        DevPattern("On branch " + branch),
        // git commit: "[feat/x 1a2b3c4] title"
        DevPattern(#"^\["# + branch + #"(?: \(root-commit\))? [0-9a-f]{7,40}\]"#, multiline: true),
    ]
    static let fileLike = DevPattern(#"[.](?:tsx?|jsx?|json|md)$"#)
    static let prURLs = DevPattern(#"https?://(?:www\.)?github\.com/[\w.-]+/[\w.-]+/pull/\d+"#, caseInsensitive: true)
    static let commitLine = DevPattern(#"^\[([\w./-]+)(?: \(root-commit\))? ([0-9a-f]{7,40})\] (.+)$"#, multiline: true)
    static let titleFlag = DevPattern(#"--title[= ](?:"((?:[^"\\]|\\.)*)"|'([^']*)')"#)
    static let commitMessage = DevPattern(#"git\s+commit\b[^\n]*?-m\s+(?:"((?:[^"\\]|\\.)*)"|'([^']*)')"#)
    static let gitCommit = DevPattern(#"git\s+commit\b"#)

    private static func toolText(_ message: Message) -> (command: String, output: String) {
        ("\(message.tool?.summary ?? "")\n\(message.tool?.input ?? "")", message.tool?.output ?? "")
    }

    /// The branch the bot last moved to or committed on, from its git
    /// commands and their output, newest first. Nil when no git row says it.
    public static func currentBranch(_ messages: [Message]) -> String? {
        for message in messages.reversed() {
            guard message.kind == .activity, let tool = message.tool, tool.ok != false else { continue }
            let (command, output) = toolText(message)
            for pattern in branchFromOutput {
                if let name = pattern.firstGroups(output)?[1], !name.isEmpty { return name }
            }
            for pattern in branchFromCommand {
                // `git checkout -- file` or `git switch -` are not branches
                if let name = pattern.firstGroups(command)?[1], !name.hasPrefix("-"), !fileLike.matches(name) { return name }
            }
        }
        return nil
    }

    /// Pull requests and commits the bot made in this conversation, newest
    /// first, from its own tool rows (gh pr create, git commit) and the pull
    /// request links in its replies.
    public static func changes(_ messages: [Message]) -> [DevChange] {
        var order: [String] = []
        var found: [String: (change: DevChange, titled: Bool)] = [:]
        // Newest first wins its place; a title read from the command wins
        // over the "repo #N" stand-in of a bare link.
        func add(_ change: DevChange, titled: Bool = true) {
            if let known = found[change.key] {
                if titled, !known.titled {
                    var updated = known.change
                    updated.title = change.title
                    found[change.key] = (updated, true)
                }
            } else {
                order.append(change.key)
                found[change.key] = (change, titled)
            }
        }
        func pull(_ ref: GithubPullRef, title: String, messageId: String) -> DevChange {
            DevChange(
                key: "pull:\(ref.owner)/\(ref.repo)#\(ref.number)".lowercased(),
                kind: .pull, title: title, repo: "\(ref.owner)/\(ref.repo)", number: ref.number,
                sha: nil, url: ref.url, messageId: messageId
            )
        }
        for message in messages.reversed() {
            if message.kind == .activity, let tool = message.tool, tool.ok != false {
                let kind = DevDetector.toolKind(tool)
                guard kind == .pr || kind == .git else { continue }
                let (command, output) = toolText(message)
                for url in prURLs.all(output) {
                    guard let ref = GithubPullRef(url: url) else { continue }
                    let groups = titleFlag.firstGroups(command)
                    let title = (groups?[1] ?? groups?[2] ?? "").replacingOccurrences(of: "\\\"", with: "\"").trimmingCharacters(in: .whitespacesAndNewlines)
                    add(pull(ref, title: title.isEmpty ? "\(ref.repo) #\(ref.number)" : title, messageId: message.id), titled: !title.isEmpty)
                }
                if let commit = commitLine.firstGroups(output), let sha = commit[2], gitCommit.matches(command) {
                    let said = commitMessage.firstGroups(command)
                    let full = said?[1] ?? said?[2] ?? commit[3] ?? ""
                    let title = (full.components(separatedBy: "\n").first ?? full).trimmingCharacters(in: .whitespacesAndNewlines)
                    add(DevChange(key: "commit:\(sha.prefix(7))", kind: .commit, title: title, sha: sha, messageId: message.id))
                }
                continue
            }
            if message.kind == .text, message.role == .bot, let text = message.text, !text.isEmpty {
                for url in prURLs.all(text) {
                    guard let ref = GithubPullRef(url: url) else { continue }
                    add(pull(ref, title: "\(ref.repo) #\(ref.number)", messageId: message.id), titled: false)
                }
            }
        }
        return order.compactMap { found[$0]?.change }
    }

    /// Files the bot attached to its replies in this conversation, newest
    /// first, once each.
    public static func outputs(_ messages: [Message]) -> [DevOutput] {
        var seen = Set<String>()
        var outputs: [DevOutput] = []
        for message in messages.reversed() where message.role == .bot {
            for attachment in message.attachments ?? [] {
                guard let path = attachment.path, !path.isEmpty, !seen.contains(path) else { continue }
                seen.insert(path)
                let name = attachment.name.flatMap { $0.isEmpty ? nil : $0 } ?? basename(path)
                outputs.append(DevOutput(key: path, name: name, path: path, kind: attachment.kind, messageId: message.id))
            }
        }
        return outputs
    }

    static func basename(_ path: String) -> String {
        let clean = String(path.split(whereSeparator: { $0 == "?" || $0 == "#" }).first ?? Substring(path))
        let last = clean.split(separator: "/").last.map(String.init) ?? clean
        return last.removingPercentEncoding ?? last
    }

    /// The last folder segment for a compact label ("/Users/me/sagax" -> "sagax").
    public static func folderLabel(_ path: String) -> String {
        path.split(whereSeparator: { $0 == "/" || $0 == "\\" }).last.map(String.init) ?? path
    }
}

// MARK: - Context and environment

public enum DevContextTone: String, Sendable { case quiet, warning, danger }

/// How much of the model's window the last call filled (`contextShare`).
public struct DevContextShare: Equatable, Sendable {
    public var tokens: Int
    public var window: Int?
    public var percent: Int?
    public var tone: DevContextTone

    public init?(_ usage: TaskUsage?) {
        guard let context = usage?.context, context.tokens > 0 else { return nil }
        tokens = context.tokens
        window = context.window.flatMap { $0 > 0 ? $0 : nil }
        percent = window.map { min(999, Int((Double(context.tokens) / Double($0) * 100).rounded())) }
        tone = percent.map { $0 >= 80 ? .danger : $0 >= 50 ? .warning : .quiet } ?? .quiet
    }

    /// "52%" or "142k" when the window is unknown.
    public var value: String {
        percent.map { "\($0)%" } ?? BotUsageTotal.formatTokens(tokens)
    }
}

/// The Environment pod's facts (`environmentData`), labels left to the view.
public struct DevEnvironment: Equatable, Sendable {
    public enum State: String, Sendable { case connecting, ready }
    /// "cloud", "vm", "local", "browser", "auto" or "off".
    public var place: String
    public var computer: Bool
    public var state: State?
    /// nil is the bot's own private folder.
    public var folder: String?
    public var branch: String?

    /// Nil when there is nothing to show: no computer, no folder, no branch.
    /// `computerStarting`: the phone is starting the bot's computer.
    public static func make(botComputer: String?, taskSurface: String?, botCwd: String?, computerStarting: Bool = false, messages: [Message]) -> DevEnvironment? {
        let place = WorkPlace.effective(botComputer: botComputer, taskSurface: taskSurface)
        let computer = place == "cloud" || place == "vm" || place == "local"
        let recent = Array(messages.suffix(DevDetector.window))
        // Ready only when something proves it: a screen frame from the
        // computer. (The desktop also reads a tool row's place, which the
        // phone's wire does not carry.)
        let ranThere = recent.contains { $0.kind == .screen }
        let state: State? = computerStarting ? .connecting : (computer && ranThere ? .ready : nil)
        let folder = botCwd.flatMap { $0.isEmpty ? nil : $0 }
        let branch = DevPodSources.currentBranch(recent)
        if !computer && folder == nil && branch == nil { return nil }
        return DevEnvironment(place: place, computer: computer, state: state, folder: folder, branch: branch)
    }
}
