// The run card's rules, case for case from the desktop's
// `src/lib/verify-steps.test.ts`.
import XCTest
@testable import CompanionCore

final class RunStepsTests: XCTestCase {
    private var seq = 0

    private func chip(_ prefix: String, name: String, command: String, ok: Bool?) -> Message {
        seq += 1
        var message = Message(id: "\(prefix)\(seq)", role: .bot, kind: .activity, at: Double(seq))
        message.tool = ToolActivity(name: name, ok: ok)
        message.tool?.summary = command
        return message
    }

    /// Claude-style chip: the tool name with the command riding in `summary`.
    private func claude(_ command: String, _ ok: Bool? = nil) -> Message { chip("c", name: "Bash", command: command, ok: ok) }
    /// Codex-style chip: the command is the name AND the summary.
    private func codex(_ command: String, _ ok: Bool? = nil) -> Message { chip("x", name: command, command: command, ok: ok) }
    /// ACP-style chip: an 80-char title plus the full command in `summary`.
    private func acp(_ command: String, _ ok: Bool? = nil) -> Message { chip("a", name: String(command.prefix(80)), command: command, ok: ok) }
    private func text(_ body: String) -> Message {
        seq += 1
        var message = Message(id: "m\(seq)", role: .bot, kind: .text, at: Double(seq))
        message.text = body
        return message
    }
    private func ask(_ body: String) -> Message {
        seq += 1
        var message = Message(id: "u\(seq)", role: .user, kind: .text, at: Double(seq))
        message.text = body
        return message
    }
    private func stagedSkill() throws -> Message {
        seq += 1
        let json = #"{"id":"o\#(seq)","role":"bot","kind":"options","at":\#(seq),"card":{"title":"Enable this skill?","subtitle":"","options":[],"skillRequest":{"version":1,"requestId":"r","botId":"b","threadId":"t","stagedId":"s","action":"create","name":"verify-omb","gist":"g","warnings":[],"createdAt":1}}}"#
        return try JSONDecoder().decode(Message.self, from: Data(json.utf8))
    }

    private let doctor = "pnpm control:omb doctor --url http://127.0.0.1:8799"
    private let send = "node --experimental-strip-types scripts/control-omb.ts send --bot x --text y"
    private let press = "./node_modules/.bin/control-atlas.mjs press \"Meta+K\""
    private let push = "git push origin main"

    func testAcceptsControlCLIInvocations() {
        let cases: [(String, String)] = [
            ("pnpm control:omb doctor --url http://127.0.0.1:1", "doctor"),
            ("pnpm run control:omb doctor", "doctor"),
            ("npm run control:omb -- doctor", "doctor"),
            (send, "send"),
            (press, "press"),
            ("cd repo && node scripts/control-omb.ts doctor", "doctor"),
            ("node scripts\\control-omb.ts doctor", "doctor"),
            ("FOO=1 pnpm control:omb wait --bot b", "wait"),
            ("timeout 30 npx tsx ./scripts/control-omb.ts screenshot > out.png 2>&1", "screenshot"),
            ("sudo -u maus pnpm control:omb doctor", "doctor"),
        ]
        for (command, subcommand) in cases {
            let parsed = RunSteps.parseControlCommand(command)
            XCTAssertEqual(parsed?.subcommand, subcommand, command)
            XCTAssertEqual(parsed?.dryRun, false, command)
        }
    }

    func testRejectsWhenTheCLIIsNotWhatRuns() {
        for command in [
            "cat scripts/control-omb.ts", "sed -n 1,40p scripts/control-omb.ts", "git log -- scripts/control-omb.ts",
            "grep -n doctor scripts/control-omb.ts", "cat docs/access-control-omb.tsx", "npmcontrol:omb doctor",
            "pnpm typecheck", "pnpm typecheck && pnpm test",
        ] {
            XCTAssertNil(RunSteps.parseControlCommand(command), command)
        }
    }

    func testMarksADryRunWhereverTheFlagSitsInTheSegment() {
        XCTAssertEqual(RunSteps.parseControlCommand("pnpm control:omb send --bot b --dry-run")?.dryRun, true)
        XCTAssertEqual(RunSteps.parseControlCommand("pnpm control:omb --dry-run send")?.subcommand, "send")
        XCTAssertEqual(RunSteps.parseControlCommand("pnpm control:omb --dry-run send")?.dryRun, true)
        XCTAssertEqual(RunSteps.parseControlCommand("pnpm control:omb doctor && pnpm release --dry-run")?.dryRun, false)
    }

    func testFallsBackToTheCLITokenWithoutASubcommand() {
        XCTAssertEqual(RunSteps.parseControlCommand("pnpm control:omb --help")?.subcommand, "control:omb")
        XCTAssertEqual(RunSteps.parseControlCommand("./scripts/control-atlas.mjs && echo done")?.subcommand, "control-atlas.mjs")
    }

    func testReadsAreNotSteps() {
        for command in [
            "cat scripts/x.ts", "git log --oneline", "git -C repo status --short", "gh pr view 12", "gh api repos/o/r/pulls/1",
            "grep -rn foo src", "sed -n 1,5p f", "curl https://x", "curl -sSL https://x", "ls -la | grep foo",
            "head -n 20 f; tail -n 5 f", "cd repo", "FOO=1", "export FOO=bar", "echo done > out.txt",
        ] {
            XCTAssertNil(RunSteps.parseRunCommand(command), command)
        }
    }

    func testStepsAreLabelledByWhatDidTheWork() {
        let cases: [(String, String)] = [
            (push, "git push"), ("git -C repo commit -m x", "git commit"), ("gh release create v1 --notes x", "gh release"),
            ("gh api -X POST repos/o/r/issues -f title=x", "gh api"), ("gh api --method DELETE repos/o/r/issues/1", "gh api"),
            ("npm publish", "npm publish"), ("pnpm typecheck", "pnpm typecheck"), ("pnpm run build", "pnpm build"),
            ("sed -i 's/a/b/' f", "sed"), ("curl -X POST https://x -d '{}'", "curl"), ("curl -o out.zip https://x", "curl"),
            ("wget --post-data a=b https://x", "wget"), ("docker compose up -d", "docker compose"),
            ("kubectl apply -f k.yaml", "kubectl apply"), ("npx tsx scripts/x.ts", "npx"),
            ("./node_modules/.bin/vitest run", "vitest"), ("FOO=1 timeout 30 git push", "git push"),
            ("sudo -u maus systemctl restart omb", "systemctl"),
        ]
        for (command, label) in cases {
            let parsed = RunSteps.parseRunCommand(command)
            XCTAssertEqual(parsed?.label, label, command)
            XCTAssertEqual(parsed?.verified, false, command)
            XCTAssertEqual(parsed?.dryRun, false, command)
        }
        XCTAssertEqual(RunSteps.parseRunCommand("cat a && npm publish")?.label, "npm publish")
        XCTAssertEqual(RunSteps.parseRunCommand("cd repo && git status && git push")?.label, "git push")
        XCTAssertEqual(RunSteps.parseRunCommand("npm publish | tee out.log")?.label, "npm publish")
        XCTAssertEqual(RunSteps.parseRunCommand(doctor)?.label, "doctor")
        XCTAssertEqual(RunSteps.parseRunCommand(doctor)?.verified, true)
        XCTAssertEqual(RunSteps.parseRunCommand("git status && \(send)")?.label, "send")
        XCTAssertEqual(RunSteps.parseRunCommand("\(doctor) --dry-run")?.dryRun, true)
        XCTAssertEqual(RunSteps.parseRunCommand("npm publish --dry-run")?.dryRun, true)
    }

    func testCommandIsTheSummaryNeverTheName() {
        XCTAssertEqual(RunSteps.command(of: claude(doctor)), doctor)
        XCTAssertEqual(RunSteps.command(of: codex("ls -la")), "ls -la")
        var read = claude("x")
        read.tool = ToolActivity(name: "Read", ok: true)
        XCTAssertNil(RunSteps.command(of: read))
        XCTAssertNil(RunSteps.command(of: text(doctor)))
        var stuck = Message(id: "s1", role: .bot, kind: .activity, at: 1)
        stuck.tool = ToolActivity(name: "Same call repeated 3× — Bash: \(doctor) — it may be stuck", ok: false)
        XCTAssertNil(RunSteps.command(of: stuck))
        XCTAssertEqual(RunSteps.steps([stuck]), [])
        XCTAssertFalse(RunSteps.nameIsCommand("Bash"))
        XCTAssertTrue(RunSteps.nameIsCommand("ls -la"))
        XCTAssertTrue(RunSteps.nameIsCommand("./scripts/x.mjs"))
    }

    func testListsEveryCommandFromEveryDriverShape() {
        let steps = RunSteps.steps([
            ask("verify the fixture"), text("Checking the fixture"), claude("pnpm typecheck", true), claude(doctor, true),
            codex(send, false), acp(press), claude("git status", true), claude("cat scripts/control-omb.ts", true), claude(push, true),
        ])
        XCTAssertEqual(steps.map(\.label), ["pnpm typecheck", "doctor", "send", "press", "git push"])
        XCTAssertEqual(steps.map(\.status), [.passed, .passed, .failed, .running, .passed])
        XCTAssertEqual(steps.map(\.verified), [false, true, true, true, false])
        XCTAssertEqual(steps.map(\.command), ["pnpm typecheck", doctor, send, press, push])
    }

    func testStartsAtThePersonsLastMessage() {
        XCTAssertEqual(RunSteps.steps([ask("release it"), claude("npm publish", true), ask("now verify"), claude(doctor, true), claude(push, true)]).map(\.label), ["doctor", "git push"])
        XCTAssertEqual(RunSteps.steps([ask("release it"), claude("npm publish", true), ask("  "), claude(doctor, true)]).map(\.label), ["npm publish", "doctor"])
        XCTAssertEqual(RunSteps.steps([ask("release it"), claude("npm publish", true), text("done"), claude(doctor, true)]).map(\.label), ["npm publish", "doctor"])
        XCTAssertEqual(RunSteps.steps([claude("npm publish", true), claude(doctor, true)]).map(\.label), ["npm publish", "doctor"])
    }

    func testAskText() {
        XCTAssertEqual(RunSteps.askText([ask("  verify the fixture  \nthen push"), claude(doctor, true)]), "verify the fixture")
        XCTAssertEqual(RunSteps.askText([ask("first"), claude(doctor, true), ask("second"), claude(doctor, true)]), "second")
        XCTAssertEqual(RunSteps.askText([ask(String(repeating: "x", count: 400))])?.count, 300)
        XCTAssertNil(RunSteps.askText([claude(doctor, true)]))
        XCTAssertNil(RunSteps.askText([ask("   ")]))
        XCTAssertNil(RunSteps.askText([]))
    }

    func testShowRunNeedsAVerifiedStepOrTwoSteps() {
        let pair = RunSteps.steps([claude(push, true), claude("npm publish", true)])
        let single = RunSteps.steps([claude(doctor, true)])
        XCTAssertFalse(RunSteps.showRun([]))
        XCTAssertFalse(RunSteps.showRun([pair[0]]))
        XCTAssertTrue(RunSteps.showRun(pair))
        XCTAssertTrue(RunSteps.showRun(single))
    }

    func testSummaryCountsAndLabel() {
        let steps = RunSteps.steps([claude(doctor, true), claude(doctor, true), codex(send, false), acp(press), claude(push, true)])
        let summary = RunSteps.summary(steps)
        XCTAssertEqual([summary.total, summary.verified, summary.passed, summary.failed, summary.running, summary.dryRuns], [5, 4, 3, 1, 1, 0])
        XCTAssertEqual(summary.englishLabel, "5 steps · 4 verified · 1 failed · 1 running")
        XCTAssertEqual(RunSteps.summary(Array(steps.prefix(1))).englishLabel, "1 step · 1 verified")
        XCTAssertEqual(RunSteps.summary(Array(steps.suffix(1))).englishLabel, "1 step")
        let dry = RunSteps.steps([claude("\(doctor) --dry-run", true), claude("\(send) --dry-run", false), claude("\(press) --dry-run")])
        XCTAssertEqual(RunSteps.summary(dry).englishLabel, "3 steps · 3 verified · 1 running · 2 dry runs")
    }

    func testSkillStagedAfterTheRunsFirstStep() throws {
        let run = [claude(doctor, true), codex(send, false)]
        let steps = RunSteps.steps(run)
        XCTAssertFalse(RunSteps.skillStaged([text("hi")] + run, steps: steps))
        XCTAssertTrue(RunSteps.skillStaged([text("hi")] + run + [try stagedSkill()], steps: steps))
        XCTAssertFalse(RunSteps.skillStaged([try stagedSkill()] + run, steps: steps))
        XCTAssertFalse(RunSteps.skillStaged([try stagedSkill()], steps: []))
    }

    func testSkillPromptForAVerifiedRun() {
        let steps = RunSteps.steps([claude(doctor, true), codex(send, false), acp(press), claude("\(doctor) --dry-run", true), claude(push, true)])
        let prompt = RunSteps.skillPrompt(steps, ask: "verify the fixture")
        XCTAssertEqual(Array(prompt.components(separatedBy: "\n").prefix(4)), [
            "Create a verification skill from the run below.",
            "Goal: verify the fixture",
            "Do not re-run these steps; their results are in this thread. Use the passing ones as the recipe with their exact commands and note the failed ones as gotchas.",
            "",
        ])
        XCTAssertFalse(RunSteps.skillPrompt(steps).contains("Goal:"))
        XCTAssertTrue(prompt.hasSuffix("✓ git push — \(push)\n\n"))
        XCTAssertTrue(prompt.contains("✓ doctor — \(doctor) (verified)\n"))
        XCTAssertTrue(prompt.contains("✗ send — \(send) (verified)\n"))
        XCTAssertTrue(prompt.contains("… press — \(press) (verified)\n"))
        XCTAssertTrue(prompt.contains("[dry run] doctor — \(doctor) --dry-run (verified)\n"))
    }

    func testSkillPromptForAnUnverifiedRun() {
        let steps = RunSteps.steps([claude(push, true), claude("npm publish", false), claude("gh release create v1")])
        let prompt = RunSteps.skillPrompt(steps, ask: "publish the release")
        XCTAssertEqual(Array(prompt.components(separatedBy: "\n").prefix(4)), [
            RunSteps.saveRunAsSkillLine,
            "Goal: publish the release",
            "Keep the exact commands and note the failed ones as gotchas. Do not re-run anything.",
            "",
        ])
        XCTAssertEqual(RunSteps.skillPrompt(steps).components(separatedBy: "\n")[1], "Goal: the run below")
        XCTAssertFalse(prompt.contains("(verified)"))
        XCTAssertTrue(prompt.hasSuffix("… gh release — gh release create v1\n\n"))
    }

    func testToolSummaryDecodesFromTheWire() throws {
        let json = #"{"id":"t1","role":"bot","kind":"activity","at":1,"tool":{"name":"Bash","ok":true,"summary":"git push origin main"}}"#
        let message = try JSONDecoder().decode(Message.self, from: Data(json.utf8))
        XCTAssertEqual(RunSteps.command(of: message), "git push origin main")
    }
}
