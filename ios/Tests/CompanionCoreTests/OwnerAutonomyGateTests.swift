// "Autonomy first" (2026-10-26): on an organization server, a member's bots
// run in their own environment, so the phone opens to the bot's owner what
// the server lets them change, and never to a person who does not own the
// bot. Each blocking removed has its pair: the member may on their own bot,
// and still may not on someone else's (BotFieldRules.swift, SurfaceGate).
import Foundation
import XCTest
@testable import CompanionCore

final class OwnerAutonomyGateTests: XCTestCase {
    private let alice = "pr_00000000-0000-4000-8000-00000000a11c"
    private let bob = "pr_00000000-0000-4000-8000-000000000b0b"

    private func member(_ permissions: [String]? = nil, readOnly: Bool = false) -> SurfaceGate {
        SurfaceGate(scope: .serverClient, organization: true,
                    viewer: ConfigViewer(principalId: alice, role: "member", botsReadOnly: readOnly, permissions: permissions))
    }

    private let admin = SurfaceGate(scope: .serverAdmin, organization: true)
    /// A client pairing on a personal server: unchanged, its rights are the scope's.
    private let soloClient = SurfaceGate(scope: .serverClient)

    private func bot(_ id: String, owner: String?, hidden: Bool = false) throws -> Bot {
        var json: [String: Any] = [
            "id": id, "threadId": "t-\(id)", "name": id.capitalized, "title": "", "description": "", "notifications": true,
            "color": "green", "unread": false, "modelSelection": ["instanceId": "claude", "model": "m"], "createdAt": 1,
            "hidden": hidden,
        ]
        if let owner { json["ownerUserId"] = owner }
        return try JSONDecoder().decode(Bot.self, from: JSONSerialization.data(withJSONObject: json))
    }

    private func mine() throws -> Bot { try bot("mine", owner: alice) }
    private func theirs() throws -> Bot { try bot("theirs", owner: bob) }

    // MARK: Ownership and permissions

    func testOwnershipIsThePrincipalNeverAnotherPersonOrAnUnownedBot() throws {
        let gate = member()
        XCTAssertTrue(gate.ownsBot(try mine()))
        XCTAssertTrue(gate.ownsBot(ownerUserId: alice.uppercased()), "case and spaces do not matter")
        XCTAssertFalse(gate.ownsBot(try theirs()))
        XCTAssertFalse(gate.ownsBot(try bot("operator", owner: nil)), "an unowned bot is the operator's")
        let anonymous = SurfaceGate(scope: .serverClient, organization: true, viewer: ConfigViewer(role: "member"))
        XCTAssertFalse(anonymous.ownsBot(try mine()), "no principal owns nothing")
    }

    func testAMemberHoldsTheKeysAboutTheirOwnThingsWhateverTheListSays() {
        // the server adds MEMBER_ALWAYS_PERMISSIONS to every member's list
        let narrow = member([])
        XCTAssertTrue(narrow.can("bots.create"))
        XCTAssertTrue(narrow.can("bots.behaviour"))
        XCTAssertTrue(narrow.can("bots.tools"))
        XCTAssertFalse(narrow.can("host.shell"))
        XCTAssertFalse(narrow.can("bots.computer"))
        XCTAssertTrue(member(["host.shell"]).can("host.shell"))
        XCTAssertTrue(member(nil).can("bots.approvalLevel"), "no list: the member defaults")
        XCTAssertFalse(soloClient.can("bots.create"), "a personal server's client session holds no key")
    }

    // MARK: C7 Access and Permissions (botAccessEdit, canEditBotField)

    func testAMemberEditsAccessAndPermissionsOfTheirOwnBotOnly() throws {
        let gate = member()
        XCTAssertTrue(gate.allows(.botAccessEdit, bot: try mine()))
        XCTAssertFalse(gate.allows(.botAccessEdit, bot: try theirs()))
        for field in ["approvalMode", "chiefOfStaff", "approvePeerComms", "computer", "browser", "mcpServers"] {
            XCTAssertTrue(gate.canEditBotField(try mine(), field), field)
            XCTAssertFalse(gate.canEditBotField(try theirs(), field), field)
        }
    }

    func testWhatTheServerKeepsStaysKeptOnTheOwnersBot() throws {
        let gate = member()
        // the server's managed cloud computer, the working folder, standing grants
        for field in ["cloudBackend", "cwd", "alwaysAllow"] {
            XCTAssertFalse(gate.canEditBotField(try mine(), field), field)
        }
        let granted = member(["bots.computer", "folders.botWorkingFolder"])
        XCTAssertTrue(granted.canEditBotField(try mine(), "cloudBackend"))
        XCTAssertTrue(granted.canEditBotField(try mine(), "cwd"))
        XCTAssertFalse(granted.canEditBotField(try theirs(), "cwd"))
    }

    func testAnyoneStillChangesHowABotLooks() throws {
        XCTAssertTrue(member().canEditBotField(try theirs(), "pinned"))
        XCTAssertTrue(member().canEditBotField(try theirs(), "color"))
    }

    func testAReadOnlyPersonChangesNothingEvenOnTheirOwnBot() throws {
        let gate = member(readOnly: true)
        XCTAssertFalse(gate.allows(.botAccessEdit, bot: try mine()))
        XCTAssertFalse(gate.allows(.advancedBotPanel, bot: try mine()))
        XCTAssertFalse(gate.canEditBotField(try mine(), "name"))
    }

    // MARK: C8 the gate reads the viewer

    func testTheLiveGateReadsTheConfigViewerAndFallsBackToTheAccount() throws {
        let connection = Connection(id: "c", name: "Org", host: "example.test", port: 443,
                                    serverEnvironmentId: "env", serverScopes: ["client"])
        let account = try JSONDecoder().decode(AuthSession.self, from: Data(
            #"{"kind":"session","scopes":["client"],"principalId":"\#(alice)","role":"member"}"#.utf8))
        let fromAccount = SurfaceGate(connection: connection, account: account)
        XCTAssertTrue(fromAccount.allows(.advancedBotPanel, bot: try mine()))
        XCTAssertFalse(fromAccount.allows(.advancedBotPanel, bot: try theirs()))
        let fromConfig = SurfaceGate(connection: connection, account: account,
                                     viewer: ConfigViewer(principalId: alice, role: "member", permissions: ["host.shell"]))
        XCTAssertTrue(fromConfig.allows(.commandAllowlistAdd))
    }

    func testTheConfigViewerDecodesItsPermissionsAndTheOperator() throws {
        let viewer = try JSONDecoder().decode(ConfigViewer.self, from: Data(
            #"{"principalId":"pr_x","role":"member","permissions":["bots.create","host.shell"],"operator":false}"#.utf8))
        XCTAssertEqual(viewer.permissions, ["bots.create", "host.shell"])
        XCTAssertEqual(viewer.isOperator, false)
        let odd = try JSONDecoder().decode(ConfigViewer.self, from: Data(#"{"role":"member","permissions":"all"}"#.utf8))
        XCTAssertNil(odd.permissions, "an odd list reads as the member defaults, never a failed config")
        XCTAssertEqual(odd.role, "member")
    }

    // MARK: C10 delete and pin, C9 archive

    func testAMemberDeletesAndArchivesTheirOwnBotOnly() throws {
        let gate = member()
        XCTAssertTrue(gate.allows(.botOwnerExtras, bot: try mine()))
        XCTAssertFalse(gate.allows(.botOwnerExtras, bot: try theirs()))
        XCTAssertTrue(gate.allows(.archiveBot, bot: try mine()))
        XCTAssertFalse(gate.allows(.archiveBot, bot: try theirs()))

        XCTAssertTrue(BotPanelAction.available(gate: gate, bot: try mine(), viewerId: alice).contains(.delete))
        XCTAssertFalse(BotPanelAction.available(gate: gate, bot: try theirs(), viewerId: alice).contains(.delete))

        let ownMenu = NavigationMenus.bot(try mine(), BotMenuContext(gate: gate, showThreads: true, canMoveToSection: true, viewerId: alice, activeBotCount: 3))
        XCTAssertTrue(ownMenu.items.contains(.archive))
        XCTAssertTrue(ownMenu.items.contains(.delete))
        let otherMenu = NavigationMenus.bot(try theirs(), BotMenuContext(gate: gate, showThreads: true, canMoveToSection: true, viewerId: alice, activeBotCount: 3))
        XCTAssertFalse(otherMenu.items.contains(.archive))
        XCTAssertFalse(otherMenu.items.contains(.delete))

        let ownPlan = BotActionsMenuPlan(gate: gate, bot: try mine(), viewerId: alice, editable: true, zipExport: true, inspector: true, activeBotCount: 3)
        XCTAssertTrue(ownPlan.items.contains(.archive))
        let otherPlan = BotActionsMenuPlan(gate: gate, bot: try theirs(), viewerId: alice, editable: false, zipExport: false, inspector: true, activeBotCount: 3)
        XCTAssertFalse(otherPlan.items.contains(.archive))
    }

    func testAMemberRestoresTheirOwnArchivedBotsOnly() throws {
        let gate = member()
        let archived = [try bot("old", owner: alice, hidden: true), try bot("gone", owner: bob, hidden: true), try mine()]
        XCTAssertEqual(gate.restorableArchivedBots(archived).map(\.id), ["old"])
        XCTAssertTrue(NavigationMenus.account(gate: gate, hasArchivedBots: true, achievementsReady: false, connected: true)
            .flatMap { $0 }.contains(.archivedBots))
        XCTAssertEqual(admin.restorableArchivedBots(archived).map(\.id), ["old", "gone"], "an admin restores every one")
        XCTAssertFalse(NavigationMenus.account(gate: soloClient, hasArchivedBots: true, achievementsReady: false, connected: true)
            .flatMap { $0 }.contains(.archivedBots))
    }

    // MARK: C18 advanced panel, C29 overview, C25 inspector

    func testTheEditorListsTheOwnersSectionsAndNoOneElses() throws {
        let gate = member()
        let own = DesktopPanelSection.visible(gate: gate, bot: try mine())
        for section in [DesktopPanelSection.overview, .soul, .skills, .memory, .access, .model, .permissions, .history] {
            XCTAssertTrue(own.contains(section), section.rawValue)
        }
        let other = DesktopPanelSection.visible(gate: gate, bot: try theirs())
        for section in [DesktopPanelSection.overview, .soul, .skills, .memory, .access, .model, .permissions, .history] {
            XCTAssertFalse(other.contains(section), section.rawValue)
        }
        XCTAssertTrue(DesktopPersonaEditor.offered(gate: gate, bot: try mine()))
    }

    func testThePromptPreviewStaysWithTheServerScope() throws {
        // GET /api/bots/:id/system-prompt is admin scope on a server
        XCTAssertFalse(member().allows(.promptPreview))
        XCTAssertTrue(admin.allows(.promptPreview))
        XCTAssertTrue(SurfaceGate(scope: .sidecar).allows(.promptPreview))
    }

    func testTheOwnerOpensTheOverviewAndTheInspectorOfTheirOwnBotOnly() throws {
        let gate = member()
        XCTAssertTrue(gate.allows(.botOverview, bot: try mine()))
        XCTAssertFalse(gate.allows(.botOverview, bot: try theirs()))
        XCTAssertTrue(gate.allows(.inspector, bot: try mine()))
        XCTAssertFalse(gate.allows(.inspector, bot: try theirs()))
        let plan = BotActionsMenuPlan(gate: gate, bot: try mine(), viewerId: alice, editable: true, zipExport: true, inspector: true, activeBotCount: 3)
        XCTAssertTrue(plan.items.contains(.inspector))
    }

    // MARK: C22 voice notes, C19 model

    func testVoiceNotesAndTheModelAreTheOwners() throws {
        let gate = member()
        XCTAssertTrue(gate.allows(.voiceNotesSetting, bot: try mine()))
        XCTAssertFalse(gate.allows(.voiceNotesSetting, bot: try theirs()))
        XCTAssertTrue(gate.canEditBotField(try mine(), "modelSelection"))
        XCTAssertFalse(gate.canEditBotField(try theirs(), "modelSelection"))
        XCTAssertTrue(gate.canEditBotField(try mine(), "voiceNotes"))
        XCTAssertFalse(gate.canEditBotField(try theirs(), "voiceNotes"))
    }

    // MARK: C30 new bot's team, C23 command rules

    func testAMembersNewBotNamesItsTeam() {
        XCTAssertTrue(member().allows(.createBotTeam))
        XCTAssertFalse(member(readOnly: true).allows(.createBotTeam))
        XCTAssertFalse(soloClient.allows(.createBotTeam), "a personal server's client session: unchanged")
    }

    func testAddingACommandRuleFollowsTheServersHostShellKey() {
        // canManageCommandAllowlist: an admin, or host.shell; never the owner alone
        XCTAssertFalse(member().allows(.commandAllowlistAdd))
        XCTAssertTrue(member(["host.shell"]).allows(.commandAllowlistAdd))
        XCTAssertTrue(admin.allows(.commandAllowlistAdd))
        XCTAssertFalse(soloClient.allows(.commandAllowlistAdd))
    }

    // MARK: Unchanged pairings

    func testAnAdminAndAPersonalServersClientSessionKeepTheirGates() throws {
        for feature in [SurfaceFeature.advancedBotPanel, .botAccessEdit, .botOwnerExtras, .archiveBot, .voiceNotesSetting, .inspector] {
            XCTAssertTrue(admin.allows(feature, bot: try theirs()), feature.rawValue)
            XCTAssertFalse(soloClient.allows(feature, bot: try bot("solo", owner: "local-owner")), feature.rawValue)
        }
        XCTAssertTrue(admin.canEditBotField(try theirs(), "cwd"))
        XCTAssertFalse(soloClient.canEditBotField(try bot("solo", owner: nil), "approvalMode"))
    }
}

/// The phone's copy of the field and permission lists must match the
/// TypeScript the server enforces.
final class BotFieldRulesParityTests: XCTestCase {
    private func shared(_ name: String) throws -> String {
        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        return try String(contentsOf: root.appendingPathComponent("shared").appendingPathComponent(name), encoding: .utf8)
    }

    private func block(_ text: String, from start: String, to end: String) throws -> String {
        let begin = try XCTUnwrap(text.range(of: start), start)
        let rest = text[begin.upperBound...]
        let finish = try XCTUnwrap(rest.range(of: end), end)
        return String(rest[..<finish.lowerBound])
    }

    private func quoted(_ text: String) -> [String] {
        let regex = try! NSRegularExpression(pattern: #""([A-Za-z.]+)""#)
        return regex.matches(in: text, range: NSRange(text.startIndex..., in: text)).compactMap { match in
            Range(match.range(at: 1), in: text).map { String(text[$0]) }
        }
    }

    func testTheFieldListsMatchSharedViewerCapabilities() throws {
        let text = try shared("viewer-capabilities.ts")
        let client = quoted(try block(text, from: "CLIENT_BOT_PATCH_FIELDS = [", to: "]"))
        XCTAssertEqual(Set(client), BotFieldRules.clientFields)
        let member = quoted(try block(text, from: "...CLIENT_BOT_PATCH_FIELDS,", to: "]"))
        XCTAssertEqual(Set(member).union(client), BotFieldRules.memberFields)
    }

    func testTheFieldPermissionsAndMemberKeysMatchSharedPermissions() throws {
        let text = try shared("permissions.ts")
        let map = try block(text, from: "BOT_FIELD_PERMISSIONS: Readonly<Record<string, PermissionKey>> = {", to: "};")
        let regex = try NSRegularExpression(pattern: #"^\s*([A-Za-z]+):\s*"([a-zA-Z.]+)""#, options: .anchorsMatchLines)
        var parsed: [String: String] = [:]
        for match in regex.matches(in: map, range: NSRange(map.startIndex..., in: map)) {
            parsed[String(map[Range(match.range(at: 1), in: map)!])] = String(map[Range(match.range(at: 2), in: map)!])
        }
        XCTAssertEqual(parsed, BotFieldRules.fieldPermissions)

        let entries = try NSRegularExpression(pattern: #"key: "([a-zA-Z.]+)", group: "[a-z]+", memberDefault: (true|false), adminOnly: (true|false)(, memberAlways: true)?"#)
        var defaults = Set<String>()
        var always = Set<String>()
        for match in entries.matches(in: text, range: NSRange(text.startIndex..., in: text)) {
            let key = String(text[Range(match.range(at: 1), in: text)!])
            let adminOnly = text[Range(match.range(at: 3), in: text)!] == "true"
            if text[Range(match.range(at: 2), in: text)!] == "true", !adminOnly { defaults.insert(key) }
            if match.range(at: 4).location != NSNotFound, !adminOnly { always.insert(key) }
        }
        XCTAssertFalse(defaults.isEmpty)
        XCTAssertEqual(defaults, BotFieldRules.memberDefaultPermissions)
        XCTAssertEqual(always, BotFieldRules.memberAlwaysPermissions)
    }
}
