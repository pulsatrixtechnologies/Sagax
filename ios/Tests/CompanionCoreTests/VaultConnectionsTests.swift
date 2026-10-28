import XCTest
@testable import CompanionCore

final class VaultConnectionsTests: XCTestCase {
    func testTheListKeepsWalletsAndOnePasswordAndNoCardNumber() throws {
        let json = """
        {"items":[],"purchases":[],"wallets":{"shop_pay":{"chosen":true,"ready":false,"missing":"shop CLI"},"link":{"chosen":false,"ready":false,"missing":"no session"},"other":{"chosen":true,"ready":true,"missing":""}},"onePassword":{"available":false,"reason":"absent"}}
        """
        let list = try JSONDecoder().decode(VaultList.self, from: Data(json.utf8))
        XCTAssertEqual(VaultWallet.rows(list.wallets).map(\.id), ["shop_pay", "link"])
        XCTAssertEqual(list.wallets?["shop_pay"]?.chosen, true)
        XCTAssertFalse(list.wallets?["link"]?.ready ?? true)
        XCTAssertEqual(list.onePassword?.reason, "absent")
        XCTAssertTrue(OnePasswordSettings.shown(list.onePassword))
        XCTAssertFalse(OnePasswordSettings.shown(OnePasswordStatusPublic(available: false, via: nil, reason: "organization")))
        XCTAssertFalse(json.contains("4111"))
        let older = try JSONDecoder().decode(VaultList.self, from: Data(#"{"items":[],"purchases":[]}"#.utf8))
        XCTAssertNil(older.wallets)
        XCTAssertNil(older.onePassword)
    }
}
