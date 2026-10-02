// "Sign in to an organization": the server address (prefilled with the last
// one used), then Sign in with Pulsatrix in the system sheet, then the
// session goes to the Keychain and the chats load. Every step that fails
// says why on this screen (OrgConnectFlow); nothing bounces back.
import CompanionCore
import SwiftUI

enum OrgServerMemory {
    static let key = "sagax.organization.lastServer"

    static var last: String {
        get { UserDefaults.standard.string(forKey: key) ?? "" }
        set { UserDefaults.standard.set(newValue, forKey: key) }
    }

    /// `bot.example.com` means https; an explicit http stays (a local server).
    static func origin(from text: String) -> URL? {
        var trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if !trimmed.contains("://") { trimmed = "https://" + trimmed }
        guard var components = URLComponents(string: trimmed),
              let scheme = components.scheme?.lowercased(), scheme == "https" || scheme == "http",
              let host = components.host, !host.isEmpty, !host.contains(" ")
        else { return nil }
        components.path = ""
        components.query = nil
        components.fragment = nil
        return components.url
    }
}

struct OrgSignInView: View {
    @EnvironmentObject private var session: Session
    @StateObject private var signIn = PulsatrixWebSignIn()
    @State private var address = OrgServerMemory.last
    @State private var flow = OrgConnectFlow()
    @State private var serverName: String?
    let onBack: () -> Void
    let onDone: () -> Void

    var body: some View {
        OnboardingPage(
            title: "Sign in to an organization",
            leading: .init(systemImage: "chevron.left", label: "Back", identifier: "org-back") { if !flow.isBusy { onBack() } }
        ) {
            OnboardingHero(
                title: "Your organization",
                subtitle: "Sagax opens your organization's Pulsatrix sign-in. Your private chats, your keys and your permissions come with you.",
                color: "purple",
                mascotSize: 88
            )

            if let error = flow.error {
                OnboardingErrorBanner(message: error.localizedMessage)
            }

            SectionLabel(text: "Server address")
            CardSection {
                OnboardingField(placeholder: "bot.example.com", text: $address, identifier: "org-address")
                    .disabled(flow.isBusy)
                    .onSubmit(start)
                if let serverName, flow.offersSignIn {
                    CardHairline()
                    CardRow(title: LocalizedStringKey(serverName), subtitle: "Signs people in with Pulsatrix", systemImage: "checkmark.shield", accessory: .none)
                }
            }
            Footer(text: "Ask your administrator for this address. It is remembered on this phone for next time.")
        } footer: {
            OnboardingCapsule(
                title: "Continue with Pulsatrix",
                busyTitle: busyTitle,
                busy: flow.isBusy,
                enabled: OrgServerMemory.origin(from: address) != nil,
                identifier: "org-continue",
                action: start
            )
        }
        .interactiveDismissDisabled(flow.isBusy)
    }

    private var busyTitle: LocalizedStringKey {
        switch flow.phase {
        case .probing: "Contacting the server..."
        case .signingIn: "Signing in..."
        case .redeeming: "Connecting..."
        default: "Continue with Pulsatrix"
        }
    }

    private func start() {
        guard !flow.isBusy, let origin = OrgServerMemory.origin(from: address) else { return }
        let host = origin.host ?? address
        flow.handle(.chose)
        serverName = nil
        Task { @MainActor in
            guard let connection = Connection.parse(origin.absoluteString) else {
                flow.handle(.probeFailed(.notAServer(host: host)))
                return
            }
            let probe = CompanionClient(connection: connection, token: nil, requestTimeout: 10)
            let environment: ServerEnvironment
            do {
                environment = try await probe.environment()
            } catch {
                flow.handle(.probeFailed(OrgConnectError.from(error, host: host)))
                return
            }
            flow.handle(.probed(environment.identity))
            guard flow.offersSignIn else {
                flow.handle(.reset)
                flow.handle(.chose)
                flow.handle(.probeFailed(.refused(message: String(localized: "This address is a computer, not an organization. Go back and choose Connect my computer."))))
                return
            }
            serverName = environment.label
            flow.handle(.startSignIn)
            signIn.start(origin: origin, scheme: flow.returnScheme) { outcome in
                flow.handle(.signInEnded(outcome))
                guard case let .invite(invite) = outcome else { return }
                Task { @MainActor in await redeem(invite, host: host) }
            }
        }
    }

    @MainActor
    private func redeem(_ invite: PairingInvite, host: String) async {
        do {
            try await session.pair(
                with: invite.connection,
                credential: invite.credential,
                deviceName: PairingView.deviceName(),
                pairRequestId: UUID().uuidString
            )
            OrgServerMemory.last = address.trimmingCharacters(in: .whitespacesAndNewlines)
            flow.handle(.redeemed)
            onDone()
        } catch {
            flow.handle(.redeemFailed(Self.map(error, host: host)))
        }
    }

    /// The Keychain's own error is the phone's, not the server's.
    static func map(_ error: Error, host: String) -> OrgConnectError {
        if let keychain = error as? SagaxSharedKeychainError {
            switch keychain {
            case .configurationMissing:
                return .deviceStorage(detail: "Keychain not configured")
            case let .security(status):
                return .deviceStorage(detail: SecCopyErrorMessageString(status, nil) as String? ?? "status \(status)")
            }
        }
        return OrgConnectError.from(error, host: host)
    }
}

extension OrgConnectError {
    /// `message`, in the app's language (the core keeps the English).
    var localizedMessage: String {
        switch self {
        case let .unreachable(host):
            return String(localized: "Can't reach \(host). Check the address and your connection, then try again.")
        case let .notAServer(host):
            return String(localized: "\(host) isn't a Sagax server. Check the address and try again.")
        case let .refused(message):
            return message
        case .needsSignIn:
            return String(localized: "This server signs people in with Pulsatrix. Tap Sign in with Pulsatrix.")
        case .signInCancelled:
            return String(localized: "Sign-in was cancelled. Tap Continue with Pulsatrix to try again.")
        case let .signInRefused(code):
            switch code {
            case "role": return String(localized: "Your Pulsatrix account can't use this server. Ask an administrator.")
            case "unavailable": return String(localized: "The server can't reach Pulsatrix right now. Try again in a moment.")
            case "binding", "state", "expired": return String(localized: "The sign-in took too long or was opened elsewhere. Try again.")
            case "access_denied": return String(localized: "Pulsatrix did not allow the sign-in.")
            default: return String(localized: "The server refused the sign-in (\(code)). Try again, or ask an administrator.")
            }
        case .signInUnexpected:
            return String(localized: "The sign-in ended unexpectedly. Try again.")
        case let .deviceStorage(detail):
            return String(localized: "Signed in, but this phone couldn't keep the session securely (\(detail)). Builds without signing can't save it; use a signed build.")
        case .credentialExpired:
            return String(localized: "The sign-in expired before the phone could use it. Sign in again.")
        }
    }
}
