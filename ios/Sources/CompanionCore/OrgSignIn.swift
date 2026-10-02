// Connecting the phone to an organization server ("Sign in with Pulsatrix").
//
// The server is the OpenID Connect client: the phone opens
// `<server>/auth/oidc/start?client=phone[&return=sagax]` in the system
// authentication sheet (Perspicax, passkeys and Safari's cookies all work
// there), and the server ends the sheet on a pairing invite
// (`sagax://pair?address=&token=&name=`) or, for a refusal, on
// `sagax://pair?address=&error=<code>`. The two-minute credential is
// redeemed through the ordinary `POST /api/pair`, which answers a bearer for
// a session bound to the person (their private threads, their payer, their
// member permissions). No Perspicax token ever reaches the phone.
//
// This file holds the parts with no UI: what the sheet came back with, the
// errors a person can act on, and the small state machine the pairing
// screen follows so a failure is always shown and never "bounces back".
import Foundation

/// What the authentication sheet came back with.
public enum PulsatrixSignInOutcome: Equatable, Sendable {
    /// A pairing invite for the server the sign-in started on.
    case invite(PairingInvite)
    /// The server refused the sign-in and said why (`error=<code>`).
    case refused(code: String)
    /// The person closed the sheet.
    case cancelled
    /// Anything else: another server's link, a malformed link.
    case unexpected
}

extension PulsatrixSignIn {
    /// Read the link the sheet ended on. `nil` is a sheet that ended without
    /// a link (closed by the person).
    public static func outcome(from callback: URL?, expectedOrigin: URL) -> PulsatrixSignInOutcome {
        guard let callback else { return .cancelled }
        if let invite = invite(from: callback, expectedOrigin: expectedOrigin) {
            return .invite(invite)
        }
        guard let scheme = callback.scheme?.lowercased(), callbackSchemes.contains(scheme),
              callback.host?.lowercased() == "pair",
              let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems,
              let code = items.first(where: { $0.name == "error" })?.value, !code.isEmpty
        else { return .unexpected }
        // A refusal naming another server is not this sign-in's.
        if let address = items.first(where: { $0.name == "address" })?.value,
           let named = URL(string: address), !sameOrigin(named, expectedOrigin) {
            return .unexpected
        }
        let cleaned = String(code.filter { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "_" || $0 == "-") }.prefix(40))
        return cleaned.isEmpty ? .unexpected : .refused(code: cleaned)
    }
}

/// Why connecting to a server did not work, in terms a person can act on.
public enum OrgConnectError: Error, Equatable, Sendable {
    /// No answer from the address (offline, wrong address, server down).
    case unreachable(host: String)
    /// The address answers but is not a Sagax server.
    case notAServer(host: String)
    /// The server answered and said no (`message` is its own words).
    case refused(message: String)
    /// The server signs people in with Pulsatrix: sign in first.
    case needsSignIn
    /// The person closed the sign-in sheet.
    case signInCancelled
    /// The server refused the sign-in itself (`code` from `error=`).
    case signInRefused(code: String)
    /// The sheet ended somewhere unexpected.
    case signInUnexpected
    /// The phone could not keep the session (Keychain).
    case deviceStorage(detail: String)
    /// The single-use sign-in credential expired or was used already.
    case credentialExpired

    /// Map a failure from probing, signing in or redeeming.
    public static func from(_ error: Error, host: String) -> OrgConnectError {
        if let mapped = error as? OrgConnectError { return mapped }
        if error is PairingRouteError { return .unreachable(host: host) }
        if let urlError = error as? URLError {
            return urlError.code == .cancelled ? .signInCancelled : .unreachable(host: host)
        }
        if let api = error as? APIError {
            switch api {
            case .transport: return .unreachable(host: host)
            case .badURL: return .notAServer(host: host)
            case let .status(code, message):
                switch code {
                case 401, 410: return .credentialExpired
                case 404: return .notAServer(host: host)
                case 403:
                    return .refused(message: message ?? "The server refused this phone. Ask an administrator.")
                case 502, 503, 504: return .unreachable(host: host)
                default:
                    return .refused(message: message ?? "The server answered with an error (\(code)).")
                }
            }
        }
        return .refused(message: error.localizedDescription)
    }

    /// The sign-in sheet's own outcome, when it is not an invite.
    public static func from(_ outcome: PulsatrixSignInOutcome) -> OrgConnectError? {
        switch outcome {
        case .invite: return nil
        case .cancelled: return .signInCancelled
        case let .refused(code): return .signInRefused(code: code)
        case .unexpected: return .signInUnexpected
        }
    }

    /// Shown in the banner on the connect screen.
    public var message: String {
        switch self {
        case let .unreachable(host):
            return "Can't reach \(host). Check the address and your connection, then try again."
        case let .notAServer(host):
            return "\(host) isn't a Sagax server. Check the address and try again."
        case let .refused(message):
            return message
        case .needsSignIn:
            return "This server signs people in with Pulsatrix. Tap Sign in with Pulsatrix."
        case .signInCancelled:
            return "Sign-in was cancelled. Tap Continue with Pulsatrix to try again."
        case let .signInRefused(code):
            switch code {
            case "role":
                return "Your Pulsatrix account can't use this server. Ask an administrator."
            case "unavailable":
                return "The server can't reach Pulsatrix right now. Try again in a moment."
            case "binding", "state", "expired":
                return "The sign-in took too long or was opened elsewhere. Try again."
            case "access_denied":
                return "Pulsatrix did not allow the sign-in."
            default:
                return "The server refused the sign-in (\(code)). Try again, or ask an administrator."
            }
        case .signInUnexpected:
            return "The sign-in ended unexpectedly. Try again."
        case let .deviceStorage(detail):
            return "Signed in, but this phone couldn't keep the session securely (\(detail)). Builds without signing can't save it; use a signed build."
        case .credentialExpired:
            return "The sign-in expired before the phone could use it. Sign in again."
        }
    }

    /// Whether signing in again is the way forward.
    public var offersSignInAgain: Bool {
        switch self {
        case .needsSignIn, .signInCancelled, .signInRefused, .signInUnexpected, .credentialExpired: return true
        default: return false
        }
    }
}

/// The connect screen's sign-in progress. Pure, so every transition is
/// tested; the view only renders it.
public struct OrgConnectFlow: Equatable, Sendable {
    public enum Phase: Equatable, Sendable {
        /// Nothing chosen yet.
        case idle
        /// Asking the server how it signs people in.
        case probing
        /// The server is known; `signIn` says it offers Pulsatrix sign-in.
        case ready(signIn: Bool)
        /// The authentication sheet is open.
        case signingIn
        /// Redeeming the credential the sheet returned.
        case redeeming
        /// Paired: the session is in the Keychain.
        case connected
        /// Stopped with a reason the screen shows.
        case failed(OrgConnectError)
    }

    public private(set) var phase: Phase = .idle
    /// Whether the chosen server offers Pulsatrix sign-in (kept across a
    /// failure so the button stays).
    public private(set) var offersSignIn = false
    /// The return scheme the sign-in asks for.
    public private(set) var returnScheme = PulsatrixSignIn.legacyCallbackScheme

    public enum Event: Equatable, Sendable {
        case chose
        case probed(ServerIdentity?)
        case probeFailed(OrgConnectError)
        case startSignIn
        case signInEnded(PulsatrixSignInOutcome)
        case redeemed
        case redeemFailed(OrgConnectError)
        case reset
    }

    public init() {}

    public var error: OrgConnectError? {
        if case let .failed(error) = phase { return error }
        return nil
    }

    public var isBusy: Bool {
        phase == .probing || phase == .signingIn || phase == .redeeming
    }

    /// Apply an event. Returns false when the event does not fit the
    /// current phase (it is then ignored).
    @discardableResult
    public mutating func handle(_ event: Event) -> Bool {
        switch (phase, event) {
        case (_, .reset):
            self = OrgConnectFlow()
        case (_, .chose):
            self = OrgConnectFlow()
            phase = .probing
        case let (.probing, .probed(identity)):
            let environment = identity
            offersSignIn = environment?.kind == "perspicax" && environment?.nativeReturn == true
            returnScheme = PulsatrixSignIn.returnScheme(for: environment)
            phase = .ready(signIn: offersSignIn)
        case let (.probing, .probeFailed(error)):
            phase = .failed(error)
        case (.ready(signIn: true), .startSignIn):
            phase = .signingIn
        case (.failed, .startSignIn) where offersSignIn:
            phase = .signingIn
        case let (.signingIn, .signInEnded(outcome)):
            if case .invite = outcome {
                phase = .redeeming
            } else {
                phase = .failed(OrgConnectError.from(outcome) ?? .signInUnexpected)
            }
        case (.redeeming, .redeemed):
            phase = .connected
        case let (.redeeming, .redeemFailed(error)):
            phase = .failed(error)
        default:
            return false
        }
        return true
    }
}
