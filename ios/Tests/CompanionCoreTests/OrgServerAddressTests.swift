import Foundation
import XCTest
@testable import CompanionCore

/// "Your organization": the Server address field ships empty (no build
/// proposes a server of ours) and only brings back the address this phone
/// already used, so an existing sign-in keeps working.
final class OrgServerAddressTests: XCTestCase {
    private var defaults: UserDefaults!
    private let suite = "OrgServerAddressTests"

    override func setUp() {
        super.setUp()
        defaults = UserDefaults(suiteName: suite)
        defaults.removePersistentDomain(forName: suite)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suite)
        super.tearDown()
    }

    func testAFreshInstallStartsWithAnEmptyFieldAndAnHttpsPlaceholder() {
        XCTAssertEqual(OrgServerAddress.initial(in: defaults), "")
        XCTAssertEqual(OrgServerAddress.placeholder, "https://…")
    }

    func testTheAddressThisPhoneAlreadyUsedComesBack() {
        defaults.set("https://sagax.example.test", forKey: OrgServerAddress.storageKey)
        XCTAssertEqual(OrgServerAddress.initial(in: defaults), "https://sagax.example.test")
        XCTAssertEqual(OrgServerAddress.storageKey, "sagax.organization.lastServer")
    }

    func testABlankSavedAddressStaysEmpty() {
        defaults.set("   ", forKey: OrgServerAddress.storageKey)
        XCTAssertEqual(OrgServerAddress.initial(in: defaults), "")
    }
}
