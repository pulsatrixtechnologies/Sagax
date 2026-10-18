// Signing in again before deleting the account (2026-10-18): Perspicax
// erases a person only after a sign-in of the last five minutes, never with a
// token the server refreshed. The server's own start
// (`POST /api/me/reauth`, then `/auth/oidc/reauth?ticket=`) runs in the system
// authentication sheet and asks Perspicax for a new sign-in
// (`prompt=login`); it ends on `sagax://account-reauth?status=ok`, and the
// app sends the deletion again. No Perspicax token reaches the phone: the
// server keeps that sign-in for this one deletion.
import AuthenticationServices
import CompanionCore
import Foundation
#if canImport(UIKit)
import UIKit
#endif

@MainActor
final class AccountReauthSheet: NSObject, ASWebAuthenticationPresentationContextProviding {
    static let shared = AccountReauthSheet()
    private var session: ASWebAuthenticationSession?

    enum Failure: LocalizedError {
        case cancelled, failed(String?)

        var errorDescription: String? {
            switch self {
            case .cancelled:
                String(localized: "You did not sign in again. Nothing was deleted.")
            case let .failed(code):
                code == "reauth_subject"
                    ? String(localized: "Another account signed in at Pulsatrix. Sign in with your own account to delete it. Nothing was deleted.")
                    : String(localized: "Signing in again did not work. Nothing was deleted; try again.")
            }
        }
    }

    /// Run the sign-in again for this connection; returns once the server
    /// keeps it, throws otherwise.
    func signInAgain(with client: CompanionClient) async throws {
        let url = try await client.beginAccountReauth()
        let outcome: AccountReauthOutcome = try await withCheckedThrowingContinuation { continuation in
            let sheet = ASWebAuthenticationSession(url: url, callbackURLScheme: "sagax") { [weak self] callback, error in
                Task { @MainActor in
                    self?.session = nil
                    if callback == nil, (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin {
                        continuation.resume(throwing: Failure.cancelled)
                        return
                    }
                    continuation.resume(returning: CompanionClient.accountReauthOutcome(callback))
                }
            }
            // Safari's passkeys, as the sign-in itself: Perspicax keeps no
            // browser session, so it asks for the factors again anyway.
            sheet.prefersEphemeralWebBrowserSession = false
            sheet.presentationContextProvider = self
            session = sheet
            if !sheet.start() {
                session = nil
                continuation.resume(throwing: Failure.failed(nil))
            }
        }
        if case let .failed(code) = outcome { throw Failure.failed(code) }
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
