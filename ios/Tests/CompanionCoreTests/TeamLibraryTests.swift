// Templates on the iPad desktop sidebar: the gate and the catalog.
import Foundation
import XCTest
@testable import CompanionCore

final class TeamLibraryTests: XCTestCase {
    func testOnlyAnAdminSessionReachesTemplates() {
        XCTAssertTrue(SurfaceGate(scope: .serverAdmin).allows(.templates))
        XCTAssertFalse(SurfaceGate(scope: .serverClient).allows(.templates))
        // the desktop remote client hides Templates
        XCTAssertFalse(SurfaceGate(scope: .sidecar).allows(.templates))
    }

    func testDecodesTheCatalogAndSkipsAMalformedTeam() throws {
        let json = #"""
        {"repositoryUrl":"https://example.test/teams","teams":[
          {"slug":"support","name":"Support desk","summary":"Answers tickets.","category":"ops","members":3,"manifest":"x","readme":"y","skills":[],"requires":{"apps":[]}},
          {"slug":"broken"},
          {"slug":"sales","name":"Sales","summary":"Pipeline."}
        ]}
        """#
        let catalog = try JSONDecoder().decode(TeamLibraryCatalog.self, from: Data(json.utf8))
        XCTAssertEqual(catalog.teams.map(\.slug), ["support", "sales"])
        XCTAssertEqual(catalog.teams.first?.members, 3)
        XCTAssertEqual(catalog.repositoryUrl, "https://example.test/teams")
    }
}
