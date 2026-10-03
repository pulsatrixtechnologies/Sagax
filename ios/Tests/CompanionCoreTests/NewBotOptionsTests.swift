// New bot's More options (WP13, rows NB2-NB4, NB6): the starting role
// menu's groups, what a preset or a built-in role fills, the lines under
// the picker, the team list, the read-only notice and the pairing gates.
import XCTest
@testable import CompanionCore

final class NewBotOptionsTests: XCTestCase {
    private func preset(_ id: String, source: String, publisher: String? = nil, package: String = "Pack") -> BotPreset {
        BotPreset(id: id, source: source, key: id, name: id.uppercased(), packageName: package, release: "1.2", publisherName: publisher)
    }

    func testGroupsKeepTheServersOrderOrganizationThenImported() {
        let groups = NewBotRules.presetGroups([
            preset("a", source: "org", publisher: "Acme"),
            preset("b", source: "org", publisher: "Acme"),
            preset("c", source: "org", package: "Shelf"),
            preset("d", source: "file"),
        ])
        XCTAssertEqual(groups.map(\.label), [.organization("Acme"), .organization("Shelf"), .imported])
        XCTAssertEqual(groups.map { $0.presets.map(\.id) }, [["a", "b"], ["c"], ["d"]])
    }

    func testAPresetFillsItsOwnFieldsAndEmptiesTheRest() {
        var p = preset("p", source: "file")
        p.bot = .init(title: "Analyst", soul: "Be exact.", appearance: .init(color: "blue", mascotBody: "round"))
        let fill = NewBotRules.fill(p)
        XCTAssertEqual(fill.name, "P", "no bot name: the preset's label")
        XCTAssertEqual(fill.title, "Analyst")
        XCTAssertEqual(fill.description, "")
        XCTAssertEqual(fill.soul, "Be exact.")
        XCTAssertEqual(fill.color, "blue")
        XCTAssertEqual(fill.mascotBody, "round")
        XCTAssertNil(fill.mascotExpression)
    }

    func testBuiltInRolesAreTheDesktops() {
        XCTAssertEqual(NewBotRules.builtInRoles.map(\.id), ["assistant", "inbox", "research", "coder", "community", "ops"])
        let scout = NewBotRules.fill(NewBotRules.builtInRoles[2])
        XCTAssertEqual(scout.name, "Scout")
        XCTAssertEqual(scout.title, "Researcher")
        XCTAssertTrue(scout.soul.hasPrefix("You research questions"))
        XCTAssertNil(scout.color)
    }

    func testSummaryLines() {
        var p = preset("p", source: "org", publisher: "Acme")
        p.description = "For analysts."
        p.skills = [.init(name: "a", description: nil), .init(name: "b", description: nil)]
        p.skillsEnabled = true
        p.notes = ["MEMORY.md"]
        XCTAssertEqual(NewBotRules.summary(p), [
            .fromOrganization(package: "Pack", release: "1.2", publisher: "Acme"),
            .text("For analysts."),
            .skills(names: "a, b", switchedOn: true),
            .notes("MEMORY.md"),
            .keeps,
        ])
        XCTAssertEqual(NewBotRules.summary(preset("f", source: "file")), [.from(package: "Pack", release: "1.2"), .keeps])
    }

    func testTeamsAreSectionsThenBotsSectionsOnce() throws {
        let data = Data(#"""
        [{"id":"1","threadId":"t1","name":"A","title":"","description":"","notifications":true,"color":"green","unread":false,"section":"Ops","modelSelection":{"instanceId":"c","model":"m"},"createdAt":1},
         {"id":"2","threadId":"t2","name":"B","title":"","description":"","notifications":true,"color":"green","unread":false,"section":"Lab","modelSelection":{"instanceId":"c","model":"m"},"createdAt":1},
         {"id":"3","threadId":"t3","name":"C","title":"","description":"","notifications":true,"color":"green","unread":false,"modelSelection":{"instanceId":"c","model":"m"},"createdAt":1}]
        """#.utf8)
        let bots = try JSONDecoder().decode([Bot].self, from: data)
        XCTAssertEqual(NewBotRules.teams(sections: ["Admin", "Ops", ""], bots: bots), ["Admin", "Ops", "Lab"])
    }

    func testReadOnlyNotice() {
        func config(_ viewer: ConfigViewer?) -> ConfigStatus? {
            var json: [String: Any] = [:]
            if let viewer {
                var v: [String: Any] = [:]
                if let r = viewer.botsReadOnly { v["botsReadOnly"] = r }
                if let c = viewer.canCreateBots { v["canCreateBots"] = c }
                json["viewer"] = v
            }
            let data = try! JSONSerialization.data(withJSONObject: json)
            return try? JSONDecoder().decode(ConfigStatus.self, from: data)
        }
        XCTAssertFalse(NewBotRules.readOnly(nil))
        XCTAssertFalse(NewBotRules.readOnly(config(ConfigViewer())))
        XCTAssertTrue(NewBotRules.readOnly(config(ConfigViewer(botsReadOnly: true))))
        XCTAssertTrue(NewBotRules.readOnly(config(ConfigViewer(canCreateBots: false))))
        XCTAssertFalse(NewBotRules.readOnly(config(ConfigViewer(canCreateBots: true))))
    }

    func testGates() {
        let sidecar = SurfaceGate(scope: .sidecar)
        let client = SurfaceGate(scope: .serverClient)
        let admin = SurfaceGate(scope: .serverAdmin)
        XCTAssertTrue(sidecar.allows(.createBotTeam))
        XCTAssertTrue(admin.allows(.createBotTeam))
        XCTAssertFalse(client.allows(.createBotTeam))
        XCTAssertTrue(sidecar.allows(.createBotPresets))
        XCTAssertFalse(SurfaceGate(scope: .sidecar, sidecarRoutes: []).allows(.createBotPresets))
        XCTAssertTrue(admin.allows(.createBotPresets))
        XCTAssertFalse(client.allows(.createBotPresets))
    }
}
