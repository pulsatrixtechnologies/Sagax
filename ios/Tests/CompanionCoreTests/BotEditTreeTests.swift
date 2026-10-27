import XCTest
@testable import CompanionCore

/// Edit bot in the Grok Bot layout (2026-10-27) moves fields and actions,
/// never drops one.
final class BotEditTreeTests: XCTestCase {
    /// Every field and action Edit bot had before this layout, by its old
    /// place: the phone's identity block (avatar, Name, Title, Description,
    /// Appearance > Avatar, Voice calls), then its groups (Instructions,
    /// Model and tools, Security, History and usage), which are also the
    /// iPad editor's sections.
    private let before: [BotEditItem] = [
        .avatar, .name, .role, .botDescription,
        .callVoice, .callSpeed, .callLanguage,
        .soul, .skills, .memory,
        .model, .computer, .access, .slack, .voiceAlerts,
        .approvals, .perspicaxProfiles, .whoCanSee, .sharedWith,
        .overview, .usage, .changes,
    ]

    /// Every editor section (`DesktopPanelSection`) the old lists showed.
    func testEverySectionStillHasARow() {
        let reachable = BotEditTree.reachable(.everything).map(\.item)
        for section in DesktopPanelSection.allCases {
            XCTAssertTrue(reachable.contains { $0.section == section }, "\(section) lost its row")
        }
    }

    func testEveryFieldAndActionFromBeforeStillHasAPlace() {
        let reachable = Set(BotEditTree.reachable(.everything).map(\.item))
        for item in before {
            XCTAssertTrue(reachable.contains(item), "\(item) lost its place")
        }
    }

    func testEveryRowOfTheTreeIsReachable() {
        let reachable = Set(BotEditTree.reachable(.everything).map(\.item))
        XCTAssertEqual(reachable, Set(BotEditItem.allCases))
    }

    func testEachRowHasOnePlace() {
        let items = BotEditTree.reachable(.everything).map(\.item)
        XCTAssertEqual(items.count, Set(items).count, "a row shows in two places")
    }

    /// The header first, the main sections in the wizard's order, then
    /// Advanced, then Archive and Delete apart.
    func testTheRootFollowsTheWizardsOrder() {
        let root = BotEditTree.cards(.root, .everything)
        XCTAssertEqual(root.first, [.header])
        XCTAssertEqual(root[1], [.identity, .personality, .model, .approvals, .toolsApps, .routines, .sharing])
        XCTAssertEqual(root[2], [.advanced])
        XCTAssertEqual(Array(root.suffix(2)), [[.archive], [.delete]])
        XCTAssertTrue(root.suffix(2).joined().allSatisfy(\.destructive))
        XCTAssertFalse(root.dropLast(2).joined().contains(where: \.destructive))
    }

    func testDetailIsOneLevelIn() {
        XCTAssertEqual(BotEditTree.path(to: BotEditItem.name), [.identity])
        XCTAssertEqual(BotEditTree.path(to: BotEditItem.callVoice), [.identity])
        XCTAssertEqual(BotEditTree.path(to: BotEditItem.soul), [.personality])
        XCTAssertEqual(BotEditTree.path(to: BotEditItem.access), [.toolsApps])
        XCTAssertEqual(BotEditTree.path(to: BotEditItem.sharedWith), [.sharing])
        XCTAssertEqual(BotEditTree.path(to: BotEditItem.changes), [.advanced])
        XCTAssertEqual(BotEditTree.path(to: BotEditItem.model), [])
        XCTAssertEqual(BotEditTree.path(to: BotEditItem.approvals), [])
        XCTAssertEqual(BotEditTree.path(to: BotEditItem.delete), [])
        // a deep link to a section opens its page through its parents
        XCTAssertEqual(BotEditTree.path(to: DesktopPanelSection.sharing), [.sharing])
        XCTAssertEqual(BotEditTree.path(to: DesktopPanelSection.permissions), [])
        XCTAssertEqual(BotEditTree.path(to: DesktopPanelSection.history), [.advanced])
    }

    /// Nothing technical on the first level: the engine's sections live
    /// one page down.
    func testNothingTechnicalOnTheRoot() {
        let root = Set(BotEditTree.cards(.root, .everything).joined())
        for item: BotEditItem in [.access, .perspicaxProfiles, .slack, .overview, .usage, .changes, .computer] {
            XCTAssertFalse(root.contains(item), "\(item) is on the first level")
        }
    }

    /// An organization member editing their own bot: the gate gives them
    /// the owner's sections and their own Archive and Delete, no admin.
    func testAMemberEditsTheirOwnBot() {
        var bot = Bot.editFixture
        bot.ownerUserId = "member-1"
        let gate = SurfaceGate(
            scope: .serverClient, organization: true,
            viewer: ConfigViewer(principalId: "member-1", role: "member", permissions: ["bots.create", "bots.tools", "bots.approvalLevel", "bots.behaviour"])
        )
        let context = BotEditContext(gate: gate, bot: bot)
        let rows = Set(BotEditTree.reachable(context).map(\.item))
        for item: BotEditItem in [.identity, .personality, .soul, .model, .approvals, .toolsApps, .routines, .archive, .delete] {
            XCTAssertTrue(rows.contains(item), "a member cannot reach \(item) on their own bot")
        }
    }

    /// A section the pairing cannot reach hides its row; a page with
    /// nothing left hides too.
    func testHiddenSectionsDropTheirRows() {
        let context = BotEditContext(sections: [.model, .voice], archive: false, delete: false)
        let root = BotEditTree.cards(.root, context).joined()
        XCTAssertTrue(root.contains(.model))
        XCTAssertTrue(root.contains(.identity), "identity always shows")
        XCTAssertFalse(root.contains(.toolsApps))
        XCTAssertFalse(root.contains(.sharing))
        XCTAssertFalse(root.contains(.advanced))
        XCTAssertFalse(root.contains(.archive))
        XCTAssertFalse(root.contains(.delete))
        XCTAssertTrue(BotEditTree.cards(.identity, context).joined().contains(.voiceAlerts))
    }

    func testTheSummariesReadTheBot() {
        var bot = Bot.editFixture
        bot.title = "  Researcher "
        bot.instructionsLead = nil
        bot.computer = "off"
        XCTAssertEqual(BotEditSummary.role(bot), "Researcher")
        XCTAssertFalse(BotEditSummary.soulWritten(bot))
        XCTAssertTrue(BotEditSummary.workspaceOff(bot))
        bot.instructionsLead = "You keep things short."
        XCTAssertTrue(BotEditSummary.soulWritten(bot))
        XCTAssertEqual(BotEditSummary.mcp(nil), .all)
        XCTAssertEqual(BotEditSummary.mcp([]), .none)
        XCTAssertEqual(BotEditSummary.mcp(["files"]), .some(["files"]))
        let rules = [
            CustomRuleRow(id: "a", botId: bot.id, when: "x", behavior: .ask),
            CustomRuleRow(id: "b", botId: bot.id, when: "y", behavior: .deny),
            CustomRuleRow(id: "c", botId: bot.id, when: "z", behavior: .deny),
            CustomRuleRow(id: "d", botId: nil, when: "every bot", behavior: .allow),
            CustomRuleRow(id: "e", botId: bot.id, when: "off", behavior: .allow, enabled: false),
        ]
        let counts = BotEditSummary.ruleCounts(rules, botId: bot.id)
        XCTAssertEqual(counts.ask, 1)
        XCTAssertEqual(counts.deny, 2)
        XCTAssertEqual(counts.allow, 0)
    }
}

private extension Bot {
    static var editFixture: Bot {
        let json = #"{"id":"b1","threadId":"t1","name":"Scout","title":"","description":"","notifications":true,"color":"blue","unread":false,"modelSelection":{"instanceId":"claude","model":"default"},"createdAt":0}"#
        return try! JSONDecoder().decode(Bot.self, from: Data(json.utf8))
    }
}
