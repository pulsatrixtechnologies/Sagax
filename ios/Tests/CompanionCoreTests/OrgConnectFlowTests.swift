import Foundation
import XCTest
@testable import CompanionCore

/// Connecting to an organization server: the sheet's outcomes, the errors a
/// person sees, and the connect screen's state machine. The owner's report
/// ("Connect goes back and nothing happens") was a failure the screen did
/// not show; every path here ends in a phase the screen renders.
final class OrgConnectFlowTests: XCTestCase {
    private let origin = URL(string: "https://bot.acme.test")!
    private let credential = "omb_pair_" + String(repeating: "A1b2_C3d4-", count: 4) + "xyz"
    private let sagaxIdentity = ServerIdentity(kind: "perspicax", protocol: "oidc", issuer: "https://px.acme.test", loginPath: "/auth/oidc/start", nativeReturn: true, phoneReturnSchemes: ["sagax", "openmausbot"])

    // MARK: return scheme and start URL

    func testAServerThatAdvertisesThePhoneReturnIsAskedForSagax() throws {
        XCTAssertEqual(PulsatrixSignIn.returnScheme(for: sagaxIdentity), "sagax")
        XCTAssertEqual(PulsatrixSignIn.startURL(base: origin, returnScheme: "sagax")?.absoluteString, "https://bot.acme.test/auth/oidc/start?client=phone&return=sagax")
        let json = #"{"environmentId":"e","label":"Acme","identity":{"kind":"perspicax","nativeReturn":true,"phoneReturnSchemes":["sagax","openmausbot"]}}"#
        let decoded = try JSONDecoder().decode(ServerEnvironment.self, from: Data(json.utf8))
        XCTAssertEqual(PulsatrixSignIn.returnScheme(for: decoded.identity), "sagax")
    }

    func testAnOlderServerKeepsTheLegacyReturn() {
        let older = ServerIdentity(kind: "perspicax", nativeReturn: true)
        XCTAssertEqual(PulsatrixSignIn.returnScheme(for: older), "openmausbot")
        XCTAssertEqual(PulsatrixSignIn.returnScheme(for: nil), "openmausbot")
        XCTAssertEqual(PulsatrixSignIn.startURL(base: origin, returnScheme: "openmausbot")?.absoluteString, "https://bot.acme.test/auth/oidc/start?client=phone")
    }

    // MARK: sheet outcomes

    func testTheSagaxInviteIsAccepted() throws {
        let link = URL(string: "sagax://pair?address=https%3A%2F%2Fbot.acme.test&token=\(credential)&name=Acme")!
        guard case let .invite(invite) = PulsatrixSignIn.outcome(from: link, expectedOrigin: origin) else {
            return XCTFail("expected an invite")
        }
        XCTAssertEqual(invite.credential, credential)
        XCTAssertEqual(invite.connection.name, "Acme")
    }

    func testARefusalCarriesItsCode() {
        let link = URL(string: "sagax://pair?address=https%3A%2F%2Fbot.acme.test&error=role")!
        XCTAssertEqual(PulsatrixSignIn.outcome(from: link, expectedOrigin: origin), .refused(code: "role"))
        // another server's refusal is not this sign-in's
        let other = URL(string: "sagax://pair?address=https%3A%2F%2Fevil.test&error=role")!
        XCTAssertEqual(PulsatrixSignIn.outcome(from: other, expectedOrigin: origin), .unexpected)
    }

    func testAClosedSheetIsACancelAndJunkIsUnexpected() {
        XCTAssertEqual(PulsatrixSignIn.outcome(from: nil, expectedOrigin: origin), .cancelled)
        XCTAssertEqual(PulsatrixSignIn.outcome(from: URL(string: "sagax://pair")!, expectedOrigin: origin), .unexpected)
        XCTAssertEqual(PulsatrixSignIn.outcome(from: URL(string: "https://bot.acme.test/pair#signin_error=role")!, expectedOrigin: origin), .unexpected)
    }

    // MARK: error mapping

    func testErrorsMapToSomethingAPersonCanActOn() {
        let host = "bot.acme.test"
        XCTAssertEqual(OrgConnectError.from(APIError.transport("offline"), host: host), .unreachable(host: host))
        XCTAssertEqual(OrgConnectError.from(URLError(.notConnectedToInternet), host: host), .unreachable(host: host))
        XCTAssertEqual(OrgConnectError.from(URLError(.cancelled), host: host), .signInCancelled)
        XCTAssertEqual(OrgConnectError.from(PairingRouteError(attemptedHosts: [host]), host: host), .unreachable(host: host))
        XCTAssertEqual(OrgConnectError.from(APIError.status(code: 404, message: nil), host: host), .notAServer(host: host))
        XCTAssertEqual(OrgConnectError.from(APIError.status(code: 401, message: "expired"), host: host), .credentialExpired)
        XCTAssertEqual(OrgConnectError.from(APIError.status(code: 403, message: "Not for you"), host: host), .refused(message: "Not for you"))
        XCTAssertEqual(OrgConnectError.from(APIError.status(code: 503, message: nil), host: host), .unreachable(host: host))
        XCTAssertEqual(OrgConnectError.from(.cancelled), .signInCancelled)
        XCTAssertEqual(OrgConnectError.from(.refused(code: "role")), .signInRefused(code: "role"))
        XCTAssertNil(OrgConnectError.from(.invite(PairingInvite(connection: Connection.parse("https://bot.acme.test")!, credential: credential))))
        // every message is non-empty and has no dashes the house style forbids
        let all: [OrgConnectError] = [.unreachable(host: host), .notAServer(host: host), .refused(message: "x"), .needsSignIn, .signInCancelled, .signInRefused(code: "role"), .signInRefused(code: "weird"), .signInUnexpected, .deviceStorage(detail: "d"), .credentialExpired]
        for error in all {
            XCTAssertFalse(error.message.isEmpty)
            XCTAssertFalse(error.message.contains("\u{2014}") || error.message.contains("\u{2013}"), error.message)
        }
        XCTAssertTrue(OrgConnectError.signInCancelled.offersSignInAgain)
        XCTAssertFalse(OrgConnectError.unreachable(host: host).offersSignInAgain)
    }

    // MARK: state machine

    func testTheHappyPath() {
        var flow = OrgConnectFlow()
        XCTAssertTrue(flow.handle(.chose))
        XCTAssertEqual(flow.phase, .probing)
        XCTAssertTrue(flow.isBusy)
        XCTAssertTrue(flow.handle(.probed(sagaxIdentity)))
        XCTAssertEqual(flow.phase, .ready(signIn: true))
        XCTAssertEqual(flow.returnScheme, "sagax")
        XCTAssertTrue(flow.handle(.startSignIn))
        XCTAssertEqual(flow.phase, .signingIn)
        let invite = PairingInvite(connection: Connection.parse("https://bot.acme.test")!, credential: credential)
        XCTAssertTrue(flow.handle(.signInEnded(.invite(invite))))
        XCTAssertEqual(flow.phase, .redeeming)
        XCTAssertTrue(flow.handle(.redeemed))
        XCTAssertEqual(flow.phase, .connected)
    }

    func testEveryFailureIsShownAndSignInCanBeRetried() {
        var flow = OrgConnectFlow()
        flow.handle(.chose)
        flow.handle(.probed(sagaxIdentity))
        flow.handle(.startSignIn)
        flow.handle(.signInEnded(.cancelled))
        XCTAssertEqual(flow.error, .signInCancelled)
        XCTAssertFalse(flow.isBusy)
        // retry from the failure
        XCTAssertTrue(flow.handle(.startSignIn))
        flow.handle(.signInEnded(.refused(code: "role")))
        XCTAssertEqual(flow.error, .signInRefused(code: "role"))
        XCTAssertTrue(flow.handle(.startSignIn))
        flow.handle(.signInEnded(.invite(PairingInvite(connection: Connection.parse("https://bot.acme.test")!, credential: credential))))
        flow.handle(.redeemFailed(.deviceStorage(detail: "A required entitlement isn't present.")))
        XCTAssertEqual(flow.error, .deviceStorage(detail: "A required entitlement isn't present."))
        XCTAssertTrue(flow.offersSignIn)
    }

    func testASoloServerNeverOffersSignIn() {
        var flow = OrgConnectFlow()
        flow.handle(.chose)
        flow.handle(.probed(nil))
        XCTAssertEqual(flow.phase, .ready(signIn: false))
        XCTAssertFalse(flow.handle(.startSignIn))
        XCTAssertEqual(flow.phase, .ready(signIn: false))
    }

    func testAnUnreachableServerIsAFailureNotSilence() {
        var flow = OrgConnectFlow()
        flow.handle(.chose)
        flow.handle(.probeFailed(.unreachable(host: "bot.acme.test")))
        XCTAssertEqual(flow.error, .unreachable(host: "bot.acme.test"))
        XCTAssertFalse(flow.handle(.startSignIn))
    }

    func testEventsOutOfOrderAreIgnored() {
        var flow = OrgConnectFlow()
        XCTAssertFalse(flow.handle(.redeemed))
        XCTAssertFalse(flow.handle(.signInEnded(.cancelled)))
        XCTAssertEqual(flow.phase, .idle)
        flow.handle(.chose)
        flow.handle(.probed(sagaxIdentity))
        flow.handle(.reset)
        XCTAssertEqual(flow, OrgConnectFlow())
    }
}
