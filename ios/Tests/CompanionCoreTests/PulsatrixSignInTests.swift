import Foundation
import XCTest
@testable import CompanionCore

/// "Sign in with Pulsatrix" from the phone (slice 2): the descriptor says the
/// server returns to native apps, the sheet opens `?client=phone`, and the
/// server's answer is the invite link the app already accepts from a QR code.
final class PulsatrixSignInTests: XCTestCase {
    private let credential = "omb_pair_" + String(repeating: "A1b2_C3d4-", count: 4) + "xyz"

    func testDescriptorWithoutIdentityDecodesAndOffersNothing() throws {
        let json = #"{"environmentId":"e1","label":"Home","platform":"darwin","version":"1.0.0","capabilities":{"emailSignIn":false}}"#
        let environment = try JSONDecoder().decode(ServerEnvironment.self, from: Data(json.utf8))
        XCTAssertNil(environment.identity)
        XCTAssertFalse(environment.offersPulsatrixSignIn)
    }

    func testDescriptorWithANativeReturnOffersTheSignIn() throws {
        let json = #"{"environmentId":"e1","label":"Acme","identity":{"kind":"perspicax","protocol":"oidc","issuer":"https://px.acme.test","loginPath":"/auth/oidc/start","nativeReturn":true}}"#
        let environment = try JSONDecoder().decode(ServerEnvironment.self, from: Data(json.utf8))
        XCTAssertEqual(environment.identity?.issuer, "https://px.acme.test")
        XCTAssertTrue(environment.offersPulsatrixSignIn)
        // a slice 1 server: no native return, the phone keeps the QR path
        let older = #"{"environmentId":"e1","label":"Acme","identity":{"kind":"perspicax","protocol":"oidc","issuer":"https://px.acme.test","loginPath":"/auth/oidc/start"}}"#
        XCTAssertFalse(try JSONDecoder().decode(ServerEnvironment.self, from: Data(older.utf8)).offersPulsatrixSignIn)
    }

    func testStartURLAsksForThePhoneReturn() {
        XCTAssertEqual(PulsatrixSignIn.startURL(base: URL(string: "https://bot.acme.test")!)?.absoluteString, "https://bot.acme.test/auth/oidc/start?client=phone")
        XCTAssertEqual(PulsatrixSignIn.startURL(base: URL(string: "http://127.0.0.1:18788/pair?x=1#y")!)?.absoluteString, "http://127.0.0.1:18788/auth/oidc/start?client=phone")
        XCTAssertNil(PulsatrixSignIn.startURL(base: URL(string: "sagax://pair")!))
    }

    func testTheServersReturnLinkIsAnInvite() throws {
        let link = URL(string: "sagax://pair?address=\("https://bot.acme.test".addingPercentEncoding(withAllowedCharacters: .alphanumerics)!)&token=\(credential)&name=Acme%20%26%20Co")!
        let invite = try XCTUnwrap(PairingInvite.parse(link))
        XCTAssertEqual(invite.credential, credential)
        XCTAssertEqual(invite.connection.name, "Acme & Co")
        XCTAssertNotNil(PulsatrixSignIn.invite(from: link, expectedOrigin: URL(string: "https://bot.acme.test")!))
        // an answer naming another server is not taken
        XCTAssertNil(PulsatrixSignIn.invite(from: link, expectedOrigin: URL(string: "https://other.acme.test")!))
        // a six-digit companion code is not a sign-in credential
        let companion = URL(string: "sagax://pair?address=https%3A%2F%2Fbot.acme.test&code=123456")!
        XCTAssertNil(PulsatrixSignIn.invite(from: companion, expectedOrigin: URL(string: "https://bot.acme.test")!))
    }
}
