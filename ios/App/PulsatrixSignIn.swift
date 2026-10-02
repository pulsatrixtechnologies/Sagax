// "Sign in with Pulsatrix" on an organization server (slice 2): the server's
// own sign-in runs in the system authentication sheet, sharing Safari's
// cookies so a person already signed in to Perspicax is not asked again. The
// server ends it on `sagax://pair?address=...&token=...`, the same
// invite a pairing QR code carries, and the app redeems it through the
// existing pairing path (`POST /api/pair`). No Perspicax token reaches the
// phone: the server is the OpenID Connect client.
import AuthenticationServices
import CompanionCore
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

@MainActor
final class PulsatrixWebSignIn: NSObject, ObservableObject, ASWebAuthenticationPresentationContextProviding {
    @Published private(set) var running = false
    private var session: ASWebAuthenticationSession?

    /// Open the sign-in; `completion` gets the invite, or nil when the person
    /// closed the sheet or the server answered with something else.
    func start(origin: URL, completion: @escaping (PairingInvite?) -> Void) {
        guard !running, let url = PulsatrixSignIn.startURL(base: origin) else { return }
        let session = ASWebAuthenticationSession(url: url, callbackURLScheme: PulsatrixSignIn.callbackScheme) { [weak self] callback, _ in
            Task { @MainActor in
                self?.running = false
                self?.session = nil
                completion(callback.flatMap { PulsatrixSignIn.invite(from: $0, expectedOrigin: origin) })
            }
        }
        session.prefersEphemeralWebBrowserSession = false
        session.presentationContextProvider = self
        self.session = session
        running = session.start()
    }

    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        #if canImport(UIKit)
        return MainActor.assumeIsolated {
            UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .flatMap(\.windows)
                .first(where: \.isKeyWindow) ?? ASPresentationAnchor()
        }
        #else
        return ASPresentationAnchor()
        #endif
    }
}
