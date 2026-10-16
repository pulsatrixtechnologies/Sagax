import XCTest

@testable import CompanionCore

/// The dev context pods' detector and sources, mirroring
/// `src/components/dev-pods/detector.test.ts` case for case so the phone and
/// the desktop agree on when a conversation is development work.
final class DevPodsTests: XCTestCase {
    private var seq = 0

    private func text(_ role: Message.Role, _ body: String) -> Message {
        seq += 1
        var message = Message(id: "m\(seq)", role: role, kind: .text, at: Double(seq))
        message.text = body
        return message
    }

    private func tool(_ name: String, ok: Bool? = true, summary: String? = nil, output: String? = nil) -> Message {
        seq += 1
        var message = Message(id: "m\(seq)", role: .bot, kind: .activity, at: Double(seq))
        message.tool = ToolActivity(name: name, ok: ok, output: output, summary: summary)
        return message
    }

    // MARK: Signals

    func testClassifiesGitPrEditAndShellRows() {
        XCTAssertEqual(DevDetector.toolKind(ToolActivity(name: "Bash", summary: "git commit -m 'x'")), .git)
        XCTAssertEqual(DevDetector.toolKind(ToolActivity(name: "Bash", summary: "gh pr create --title 'x'")), .pr)
        XCTAssertEqual(DevDetector.toolKind(ToolActivity(name: "apply_patch")), .edit)
        XCTAssertEqual(DevDetector.toolKind(ToolActivity(name: "Edit")), .edit)
        XCTAssertEqual(DevDetector.toolKind(ToolActivity(name: "Bash", summary: "ls -la")), .shell)
        XCTAssertNil(DevDetector.toolKind(ToolActivity(name: "WebSearch")))
        XCTAssertEqual(DevDetector.toolKind(ToolActivity(name: "mcp__local__git_commit")), .git)
        XCTAssertNil(DevDetector.toolKind(ToolActivity(name: "mcp__github__create_pull_request")))
    }

    func testScoresACodingRunAboveTheThresholdAndAPlainChatAtZero() {
        let coding = [
            text(.user, "fix the login bug"),
            tool("Read", summary: "src/lib/auth.ts"),
            tool("Edit", summary: "src/lib/auth.ts"),
            tool("Bash", summary: "git commit -am fix"),
        ]
        XCTAssertGreaterThanOrEqual(DevDetector.signals(coding).score, DevDetector.enterScore)
        let chat = [text(.user, "what's the weather like?"), text(.bot, "Sunny, 21 degrees."), text(.user, "thanks")]
        XCTAssertEqual(DevDetector.signals(chat).score, 0)
    }

    func testCountsCodeBlocksPullRequestLinksAndRepoPathsInReplies() {
        let replies = [
            text(.bot, "Here:\n```ts\nconst a = 1;\n```\nand\n```bash\npnpm test\n```"),
            text(.bot, "Opened https://github.com/acme/app/pull/12 for src/components/Foo.tsx"),
        ]
        let signals = DevDetector.signals(replies)
        XCTAssertEqual(signals.codeBlocks, 2)
        XCTAssertEqual(signals.prLinks, 1)
        XCTAssertEqual(signals.repoPaths, 1)
        XCTAssertGreaterThanOrEqual(signals.score, DevDetector.enterScore)
    }

    func testCapsOneChattySignalSoShellAloneNeverSwitchesThePodsOn() {
        let shellOnly = (0..<10).map { _ in tool("Bash", summary: "echo hi") }
        XCTAssertLessThan(DevDetector.signals(shellOnly).score, DevDetector.enterScore)
    }

    func testAnExplicitMarkOrTheComputerAddsToTheScore() {
        XCTAssertGreaterThanOrEqual(DevDetector.signals([], explicit: true).score, DevDetector.enterScore)
        XCTAssertEqual(DevDetector.signals([], computerActive: true).score, 1)
    }

    func testReadsOnlyTheRecentWindow() {
        let old = [tool("Edit"), tool("Bash", summary: "git commit -am x")]
        let chatter = (0..<DevDetector.window).map { _ in text(.user, "hello") }
        XCTAssertEqual(DevDetector.signals(old + chatter).score, 0)
    }

    // MARK: Hysteresis

    private func run(_ scores: [Int], start: DevModeState = .off) -> [Bool] {
        var state = start
        return scores.map { score in
            state = DevDetector.step(state, score: score)
            return state.active
        }
    }

    func testStaysOffUnderTheEnterScore() {
        XCTAssertEqual(run([0, 1, 2, 3, 3, 2]), [false, false, false, false, false, false])
    }

    func testTurnsOnAtTheEnterScoreAndHoldsThroughADipAboveTheExitScore() {
        XCTAssertEqual(run([DevDetector.enterScore, 2, 3, 2]), [true, true, true, true])
    }

    func testDoesNotFlickerOffOnOneOrTwoQuietEvaluations() {
        XCTAssertEqual(run([DevDetector.enterScore, 0, 0, 5, 0, 0]), [true, true, true, true, true, true])
    }

    func testTurnsOffOnlyAfterTheExitStreak() {
        let states = run([DevDetector.enterScore] + Array(repeating: 0, count: DevDetector.exitStreak))
        XCTAssertEqual(states.last, false)
        XCTAssertTrue(states.dropLast().allSatisfy { $0 })
    }

    func testReturnsTheSameStateWhenNothingChanges() {
        let on = DevDetector.step(.off, score: DevDetector.enterScore)
        XCTAssertEqual(DevDetector.step(on, score: DevDetector.enterScore), on)
        XCTAssertEqual(DevDetector.step(.off, score: 0), .off)
    }

    // MARK: Sources

    func testReadsTheBranchFromTheNewestGitRowNeverAGuess() {
        XCTAssertNil(DevPodSources.currentBranch([text(.user, "hi")]))
        let messages = [
            tool("Bash", summary: "git checkout -b feat/old"),
            tool("Bash", summary: "git commit -m 'x'", output: "[feat/new 1a2b3c4] x\n 1 file changed"),
        ]
        XCTAssertEqual(DevPodSources.currentBranch(messages), "feat/new")
        XCTAssertNil(DevPodSources.currentBranch([tool("Bash", summary: "git checkout -- src/a.ts")]))
        XCTAssertNil(DevPodSources.currentBranch([tool("Bash", ok: false, summary: "git switch -c fix/login")]))
        XCTAssertEqual(DevPodSources.currentBranch([tool("Bash", summary: "git switch -c fix/login")]), "fix/login")
    }

    func testListsPullRequestsAndCommitsNewestFirstOnceEach() {
        let messages = [
            tool("Bash", summary: "git commit -m \"Fix the login\"", output: "[main abcdef1] Fix the login"),
            tool("Bash", summary: "gh pr create --title \"Login fix\" --body x", output: "https://github.com/acme/app/pull/42\n"),
            text(.bot, "Done: https://github.com/acme/app/pull/42"),
        ]
        let changes = DevPodSources.changes(messages)
        XCTAssertEqual(changes.map(\.key), ["pull:acme/app#42", "commit:abcdef1"])
        // the reply's bare link is newer, the title still comes from gh pr create
        XCTAssertEqual(changes[0].kind, .pull)
        XCTAssertEqual(changes[0].title, "Login fix")
        XCTAssertEqual(changes[0].repo, "acme/app")
        XCTAssertEqual(changes[0].number, 42)
        XCTAssertEqual(changes[0].url, "https://github.com/acme/app/pull/42")
        XCTAssertEqual(changes[0].whereLabel, "acme/app #42")
        XCTAssertEqual(changes[1].kind, .commit)
        XCTAssertEqual(changes[1].title, "Fix the login")
        XCTAssertEqual(changes[1].sha, "abcdef1")
        XCTAssertEqual(changes[1].whereLabel, "abcdef1")
    }

    func testABareLinkGivesARepoAndNumberTitle() {
        let changes = DevPodSources.changes([text(.bot, "See https://github.com/acme/app/pull/7.")])
        XCTAssertEqual(changes.map(\.title), ["app #7"])
    }

    func testListsTheFilesTheBotAttachedNotThePersons() {
        var fromBot = text(.bot, "here")
        fromBot.attachments = [MessageImageAttachment(kind: "file", path: "/api/files/a/report.pdf", mime: "application/pdf", name: "report.pdf")]
        var fromPerson = text(.user, "mine")
        fromPerson.attachments = [MessageImageAttachment(kind: "image", path: "/api/files/b/me.png", mime: "image/png")]
        var unnamed = text(.bot, "chart")
        unnamed.attachments = [MessageImageAttachment(kind: "image", path: "/api/files/c/chart%20one.png?v=2", mime: "image/png")]
        XCTAssertEqual(DevPodSources.outputs([fromPerson, fromBot, unnamed]).map(\.name), ["chart one.png", "report.pdf"])
    }

    func testFolderLabel() {
        XCTAssertEqual(DevPodSources.folderLabel("/Users/me/sagax/"), "sagax")
        XCTAssertEqual(DevPodSources.folderLabel("C:\\work\\app"), "app")
    }

    // MARK: Context and environment

    func testContextShareAndTone() throws {
        func usage(_ tokens: Int, _ window: Int?) -> TaskUsage {
            TaskUsage(input: 0, output: 0, turns: 1, context: TaskUsage.Context(tokens: tokens, window: window))
        }
        XCTAssertNil(DevContextShare(nil))
        XCTAssertNil(DevContextShare(usage(0, 1000)))
        let quiet = try XCTUnwrap(DevContextShare(usage(100, 1000)))
        XCTAssertEqual(quiet.percent, 10)
        XCTAssertEqual(quiet.tone, .quiet)
        XCTAssertEqual(quiet.value, "10%")
        XCTAssertEqual(DevContextShare(usage(600, 1000))?.tone, .warning)
        XCTAssertEqual(DevContextShare(usage(900, 1000))?.tone, .danger)
        let unknown = try XCTUnwrap(DevContextShare(usage(142_000, nil)))
        XCTAssertNil(unknown.percent)
        XCTAssertEqual(unknown.value, "142k")
    }

    func testEnvironmentShowsOnlyWhatTheConversationSays() {
        XCTAssertNil(DevEnvironment.make(botComputer: "off", taskSurface: nil, botCwd: nil, messages: []))
        let cloud = DevEnvironment.make(botComputer: "cloud", taskSurface: nil, botCwd: nil, messages: [])
        XCTAssertEqual(cloud?.computer, true)
        XCTAssertNil(cloud?.state)
        var screen = Message(id: "s", role: .bot, kind: .screen, at: 1)
        screen.hasImage = true
        XCTAssertEqual(DevEnvironment.make(botComputer: "cloud", taskSurface: nil, botCwd: nil, messages: [screen])?.state, .ready)
        XCTAssertEqual(DevEnvironment.make(botComputer: "cloud", taskSurface: nil, botCwd: nil, computerStarting: true, messages: [])?.state, .connecting)
        let pinned = DevEnvironment.make(botComputer: "auto", taskSurface: "vm", botCwd: "/work/app", messages: [tool("Bash", summary: "git switch main")])
        XCTAssertEqual(pinned?.place, "vm")
        XCTAssertEqual(pinned?.folder, "/work/app")
        XCTAssertEqual(pinned?.branch, "main")
    }
}
