// A bot's run in the current ask, read off its tool chips: the desktop's
// `src/lib/verify-steps.ts`, ported rule for rule so the phone's run card
// (`VerifyCard.tsx`) lists the same steps. Every shell command the bot ran
// is a step; the ones through a control CLI (`pnpm control:omb doctor`, a
// `control-<app>.mjs` script) are the verified ones. Reads (`cat`, `git
// log`, `gh pr view`) are not steps: looking is not doing.
import Foundation

public struct RunStep: Equatable, Hashable, Sendable, Identifiable {
    public enum Status: String, Sendable { case running, passed, failed }
    public var id: String
    public var command: String
    /// The control subcommand for a verified step, else the program that did
    /// the work, with its subcommand for the few whose subcommand matters.
    public var label: String
    public var status: Status
    /// `--dry-run` anywhere in the invocation: the step proves nothing.
    public var dryRun: Bool
    /// The step ran through a control CLI, so its outcome is a verification.
    public var verified: Bool
}

public struct RunSummary: Equatable, Sendable {
    public var total = 0
    public var verified = 0
    public var passed = 0
    public var failed = 0
    public var running = 0
    public var dryRuns = 0

    /// The desktop's English label ("3 steps · 2 verified · 1 failed"); the
    /// app words the same parts in the reader's language.
    public var englishLabel: String {
        var parts = [total == 1 ? "1 step" : "\(total) steps"]
        if verified > 0 { parts.append("\(verified) verified") }
        if failed > 0 { parts.append("\(failed) failed") }
        if running > 0 { parts.append("\(running) running") }
        if dryRuns == 1 { parts.append("1 dry run") } else if dryRuns > 1 { parts.append("\(dryRuns) dry runs") }
        return parts.joined(separator: " · ")
    }
}

public enum RunSteps {
    /// The sentence the server expands into a skill-authoring turn
    /// (`shared/learn-request.ts` SAVE_RUN_AS_SKILL_LINE).
    public static let saveRunAsSkillLine = "Save the steps below as a reusable skill for my review."

    /// A tool name that is itself a command line rather than a bare tool name.
    public static func nameIsCommand(_ name: String) -> Bool {
        name.contains { $0.isWhitespace || $0 == "/" }
    }

    /// The command a tool chip ran: the driver's summary, never the name.
    public static func command(of message: Message) -> String? {
        guard message.kind == .activity, let summary = message.tool?.summary, !summary.isEmpty else { return nil }
        return summary
    }

    // MARK: parsing one command line

    private static let segment = JS.regex(#"\s*(?:&&|\|\||;|\||\r?\n)\s*"#)
    private static let envAssignment = JS.regex(#"^[A-Za-z_][A-Za-z0-9_]*="#)
    private static let wrapper: Set<String> = ["env", "sudo"]
    private static let wrapperValueFlag: Set<String> = ["-u", "-g", "-C"]
    private static let packageRunner: Set<String> = ["pnpm", "npm", "yarn", "bun"]
    private static let packageRunnerWord: Set<String> = ["run", "exec", "-s", "--silent", "-r", "--"]
    private static let scriptRunner: Set<String> = ["node", "npx", "tsx"]
    private static let cliScript = JS.regex(#"^control:[\w-]+$"#)
    private static let cliFile = JS.regex(#"^control-[\w-]+\.(?:mjs|ts|js|cjs)$"#)
    private static let redirect = JS.regex(#"^\d*[<>]"#)
    private static let url = JS.regex(#"^[a-z][a-z0-9+.-]*://"#, [.caseInsensitive])
    private static let longFlagWithValue = JS.regex(#"^--[^=]+$"#)
    private static let dryRunFlag = JS.regex(#"(?:^|\s)--dry-run(?:=|\s|$)"#)

    private static func segments(_ command: String) -> [String] {
        let ns = command as NSString
        var parts: [String] = []
        var cursor = 0
        for match in segment.matches(in: command, range: NSRange(location: 0, length: ns.length)) {
            parts.append(ns.substring(with: NSRange(location: cursor, length: match.range.location - cursor)))
            cursor = match.range.location + match.range.length
        }
        parts.append(ns.substring(from: cursor))
        return parts
    }

    private static func words(_ segment: String) -> [String] {
        segment.split(whereSeparator: { $0.isWhitespace }).map(String.init)
    }

    private static func unquote(_ token: String) -> String {
        var value = Substring(token)
        while let first = value.first, "'\"`".contains(first) { value = value.dropFirst() }
        while let last = value.last, "'\"`".contains(last) { value = value.dropLast() }
        return String(value)
    }

    private static func basename(_ token: String) -> String {
        let bare = unquote(token)
        let last = bare.split(omittingEmptySubsequences: false, whereSeparator: { $0 == "/" || $0 == "\\" }).last.map(String.init) ?? ""
        return last.isEmpty ? bare : last
    }

    private static func strip(_ argv: [String], runners: Bool) -> [String] {
        var index = 0
        while index < argv.count {
            let word = argv[index]
            if JS.test(envAssignment, word) {
                index += 1
            } else if word == "timeout" || word == "cd" {
                index += 2
            } else if wrapper.contains(word) {
                index += 1
                while index < argv.count, argv[index].hasPrefix("-") {
                    index += wrapperValueFlag.contains(argv[index]) ? 2 : 1
                }
            } else if !runners {
                break
            } else if word == "deno" {
                index += index + 1 < argv.count && argv[index + 1] == "run" ? 2 : 1
            } else if packageRunner.contains(word) {
                index += 1
                while index < argv.count, packageRunnerWord.contains(argv[index]) { index += 1 }
            } else if scriptRunner.contains(word) {
                index += 1
                while index < argv.count, argv[index].hasPrefix("-") { index += 1 }
            } else {
                break
            }
        }
        return index < argv.count ? Array(argv[index...]) : []
    }

    private static func cliToken(_ word: String) -> String? {
        let token = unquote(word)
        if JS.test(cliScript, token) { return token }
        let name = basename(token)
        return JS.test(cliFile, name) ? name : nil
    }

    private static func subcommand(_ rest: [String], cli: String) -> String {
        var valueNext = false
        for raw in rest {
            let token = unquote(raw)
            if token.hasPrefix("-") {
                valueNext = JS.test(longFlagWithValue, token) && token != "--dry-run"
            } else if valueNext {
                valueNext = false
            } else if !token.isEmpty && !JS.test(redirect, token) && !JS.test(url, token) {
                return token
            }
        }
        return cli
    }

    /// What a command line invokes when its first program (after runners) is
    /// a control CLI; nil for anything else, reading the CLI's source included.
    public static func parseControlCommand(_ command: String) -> (subcommand: String, dryRun: Bool)? {
        for part in segments(command) {
            let argv = strip(words(part), runners: true)
            if let first = argv.first, let cli = cliToken(first) {
                return (subcommand(Array(argv.dropFirst()), cli: cli), JS.test(dryRunFlag, part))
            }
        }
        return nil
    }

    // MARK: reads

    private static let readProgram: Set<String> = [
        "cat", "less", "more", "head", "tail", "wc", "stat", "file", "du", "df", "ls", "tree", "find",
        "which", "type", "where", "whereis", "pwd", "echo", "printf", "printenv", "env", "ps", "pgrep", "top",
        "grep", "rg", "ag", "ack", "fgrep", "egrep", "awk", "cut", "sort", "uniq", "tr", "diff", "cmp",
        "md5", "shasum", "sha256sum", "jq", "yq", "column",
        "export", "unset", "alias", "true", "false", ":", "sleep", "exit",
    ]
    private static let gitRead: Set<String> = ["status", "log", "diff", "show", "blame", "branch", "tag", "ls-files", "rev-parse", "remote", "describe", "shortlog", "reflog"]
    private static let gitValueFlag: Set<String> = ["-C", "-c"]
    private static let ghRead: Set<String> = ["pr view", "pr list", "pr checks", "pr diff", "issue view", "issue list", "run view", "run list"]
    private static let ghValueFlag: Set<String> = ["-R", "--repo"]
    private static let sedInPlace = JS.regex(#"^(?:-[a-zA-Z]*i|--in-place)"#)
    private static let httpMutation = JS.regex(#"^(?:POST|PUT|PATCH|DELETE)$"#, [.caseInsensitive])
    private static let methodFlag = JS.regex(#"^(?:-X|--request|--method)(?:=(.*))?$"#)
    private static let methodAttached = JS.regex(#"^-X(\w+)$"#)
    private static let transferFlag = JS.regex(#"^(?:-d|--data(?:-\w+)?|-F|--form|-T|--upload-file|-o|--output|-O|--remote-name|--output-document|--post-data|--post-file)(?:=|$)"#)
    private static let ghFieldFlag = JS.regex(#"^(?:-f|-F|--field|--raw-field)(?:=|$)"#)

    private static func bareWords(_ rest: [String], valueFlags: Set<String>) -> [String] {
        var found: [String] = []
        var index = 0
        while index < rest.count {
            let token = unquote(rest[index])
            if valueFlags.contains(token) {
                index += 2
                continue
            }
            if !(token.hasPrefix("-") || JS.test(redirect, token) || JS.test(url, token) || token.isEmpty) {
                found.append(token)
            }
            index += 1
        }
        return found
    }

    private static func group(_ regex: NSRegularExpression, _ text: String, _ index: Int) -> String?? {
        let ns = text as NSString
        guard let match = regex.firstMatch(in: text, range: NSRange(location: 0, length: ns.length)) else { return nil }
        let range = match.range(at: index)
        return .some(range.location == NSNotFound ? nil : ns.substring(with: range))
    }

    private static func mutatesOverHTTP(_ rest: [String]) -> Bool {
        for (index, raw) in rest.enumerated() {
            let token = unquote(raw)
            if let attached = group(methodAttached, token, 1) {
                if let method = attached, JS.test(httpMutation, method) { return true }
                continue
            }
            guard let flag = group(methodFlag, token, 1) else { continue }
            let method = flag ?? unquote(index + 1 < rest.count ? rest[index + 1] : "")
            if JS.test(httpMutation, method) { return true }
        }
        return false
    }

    private static func isRead(_ argv: [String]) -> Bool {
        guard let first = argv.first else { return true }
        let program = basename(first)
        if readProgram.contains(program) { return true }
        let rest = Array(argv.dropFirst())
        switch program {
        case "sed":
            return !rest.contains { JS.test(sedInPlace, unquote($0)) }
        case "git":
            guard let sub = bareWords(rest, valueFlags: gitValueFlag).first else { return true }
            return gitRead.contains(sub)
        case "gh":
            let found = bareWords(rest, valueFlags: ghValueFlag)
            guard let group = found.first else { return true }
            if group == "api" {
                return !mutatesOverHTTP(rest) && !rest.contains { JS.test(ghFieldFlag, unquote($0)) }
            }
            return ghRead.contains("\(group) \(found.count > 1 ? found[1] : "undefined")")
        case "curl", "wget":
            return !mutatesOverHTTP(rest) && !rest.contains { JS.test(transferFlag, unquote($0)) }
        default:
            return false
        }
    }

    private static let labelledBySubcommand: Set<String> = ["git", "gh", "npm", "pnpm", "docker", "kubectl"]

    private static func label(_ argv: [String]) -> String {
        let program = basename(argv[0])
        guard labelledBySubcommand.contains(program) else { return program }
        let rest = packageRunner.contains(program)
            ? argv.dropFirst().filter { !packageRunnerWord.contains($0) }
            : Array(argv.dropFirst())
        let flags = program == "git" ? gitValueFlag : program == "gh" ? ghValueFlag : []
        guard let sub = bareWords(rest, valueFlags: flags).first else { return program }
        return "\(program) \(sub)"
    }

    /// What a command line did, or nil when every segment only looked.
    public static func parseRunCommand(_ command: String) -> (label: String, verified: Bool, dryRun: Bool)? {
        if let control = parseControlCommand(command) {
            return (control.subcommand, true, control.dryRun)
        }
        for part in segments(command) {
            let argv = strip(words(part), runners: false)
            if isRead(strip(argv, runners: true)) { continue }
            return (label(argv), false, JS.test(dryRunFlag, part))
        }
        return nil
    }

    // MARK: the run

    private static func askIndex(_ messages: [Message]) -> Int {
        for index in messages.indices.reversed() {
            let message = messages[index]
            if message.role == .user, message.kind == .text, !JS.trim(message.text ?? "").isEmpty { return index }
        }
        return -1
    }

    /// The first line of the person's last message, at most 300 characters.
    public static func askText(_ messages: [Message]) -> String? {
        let index = askIndex(messages)
        guard index >= 0 else { return nil }
        let first = JS.trim(messages[index].text ?? "").components(separatedBy: .newlines).first ?? ""
        let line = JS.trim(first)
        return line.isEmpty ? nil : String(line.prefix(300))
    }

    /// Every command the bot ran in the current ask, in order, reads left out.
    public static func steps(_ messages: [Message]) -> [RunStep] {
        var out: [RunStep] = []
        for message in messages.dropFirst(askIndex(messages) + 1) {
            guard let command = command(of: message), let parsed = parseRunCommand(command) else { continue }
            let status: RunStep.Status = message.tool?.ok.map { $0 ? .passed : .failed } ?? .running
            out.append(RunStep(id: message.id, command: command, label: parsed.label, status: status, dryRun: parsed.dryRun, verified: parsed.verified))
        }
        return out
    }

    /// Whether a run is worth a card: something was verified, or the bot did
    /// more than one thing.
    public static func showRun(_ steps: [RunStep]) -> Bool {
        steps.contains(where: \.verified) || steps.count >= 2
    }

    /// The counts. A settled dry run is neither passed nor failed.
    public static func summary(_ steps: [RunStep]) -> RunSummary {
        var counts = RunSummary()
        counts.total = steps.count
        for step in steps {
            if step.verified { counts.verified += 1 }
            if step.dryRun && step.status != .running {
                counts.dryRuns += 1
            } else {
                switch step.status {
                case .running: counts.running += 1
                case .passed: counts.passed += 1
                case .failed: counts.failed += 1
                }
            }
        }
        return counts
    }

    /// The bot already staged a skill from this run: an options message
    /// carrying a skill proposal after the run's first step.
    public static func skillStaged(_ messages: [Message], steps: [RunStep]) -> Bool {
        guard let first = steps.first, let start = messages.firstIndex(where: { $0.id == first.id }) else { return false }
        return messages[(start + 1)...].contains { $0.kind == .options && $0.card?.skillRequest != nil }
    }

    private static func stepLine(_ step: RunStep) -> String {
        let mark: String
        if step.dryRun {
            mark = "[dry run]"
        } else {
            switch step.status {
            case .passed: mark = "✓"
            case .failed: mark = "✗"
            case .running: mark = "…"
            }
        }
        return "\(mark) \(step.label) — \(step.command)\(step.verified ? " (verified)" : "")"
    }

    /// The text Save as skill puts into the composer for the person to send.
    public static func skillPrompt(_ steps: [RunStep], ask: String? = nil) -> String {
        let lines: [String]
        if steps.contains(where: \.verified) {
            lines = ["Create a verification skill from the run below."]
                + (ask.map { ["Goal: \($0)"] } ?? [])
                + ["Do not re-run these steps; their results are in this thread. Use the passing ones as the recipe with their exact commands and note the failed ones as gotchas."]
        } else {
            lines = [
                saveRunAsSkillLine,
                "Goal: \(ask ?? "the run below")",
                "Keep the exact commands and note the failed ones as gotchas. Do not re-run anything.",
            ]
        }
        return (lines + [""] + steps.map(stepLine) + ["", ""]).joined(separator: "\n")
    }
}
