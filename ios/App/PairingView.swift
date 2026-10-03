// Pairing: make QR scanning the obvious path, then keep discovery and manual
// entry available without making network plumbing part of onboarding.
import SwiftUI
import CompanionCore
#if canImport(UIKit)
import UIKit
#endif

struct PairingView: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @StateObject private var discovery = Discovery()

    @State private var manualAddress = ""
    @State private var code = ""
    @State private var scannedCredential: String?
    /// Stable across Retry. If the Mac committed a device but the response
    /// was lost, repeating this same logical request recovers its token.
    @State private var pairRequestId: String?
    @State private var chosen: Connection?
    @State private var submission = CompanionPairingSubmissionState()
    @State private var failure: String?
    @State private var showingScanner = false
    @State private var choiceGeneration = 0
    /// Set when the chosen server signs people in with Pulsatrix and returns
    /// to native apps (its descriptor's `identity.nativeReturn`).
    @State private var pulsatrixOrigin: URL?
    @State private var pulsatrixScheme = PulsatrixSignIn.legacyCallbackScheme
    @StateObject private var pulsatrixSignIn = PulsatrixWebSignIn()

    private let onCancel: () -> Void
    /// Set when this page was opened from the welcome screen's choices.
    private let onBack: (() -> Void)?

    init(onCancel: @escaping () -> Void = {}, onBack: (() -> Void)? = nil) {
        self.onCancel = onCancel
        self.onBack = onBack
    }

    private var pairing: Bool { submission.isInFlight }

    var body: some View {
        OnboardingPage(
            title: "Connect my computer",
            leading: .init(systemImage: onBack == nil ? "xmark" : "chevron.left", label: onBack == nil ? "Not now" : "Back", identifier: "pairing-close") {
                guard submission.allowsNavigation else { return }
                (onBack ?? onCancel)()
            }
        ) {
            if let failure {
                OnboardingErrorBanner(message: failure)
            }
            if let chosen {
                confirmationView(for: chosen)
            } else {
                pairingHero
                qrAction
                otherWays
            }
        }
        .onAppear {
            accept(session.pairingInvite)
            discovery.start()
        }
        .onDisappear {
            choiceGeneration += 1
            discovery.stop()
        }
        .onValueChange(of: session.pairingInvite) { invite in accept(invite) }
        .fullScreenCover(isPresented: $showingScanner) {
            PairingScannerSheet { payload in
                guard let url = URL(string: payload), let invite = PairingInvite.parse(url) else {
                    return "That isn't a Sagax pairing QR code."
                }
                accept(invite)
                return nil
            }
        }
        .interactiveDismissDisabled(pairing)
    }

    private var pairingHero: some View {
        OnboardingHero(
            title: "Connect your computer",
            subtitle: "In Sagax on your computer, open Settings, then Phone, then Set up a phone. Scan the code it shows.",
            color: "green",
            mascotSize: 88
        )
    }

    private var qrAction: some View {
        OnboardingCapsule(title: "Scan QR code", identifier: "pairing-scan") {
            failure = nil
            showingScanner = true
        }
        .padding(.horizontal, 23.17)
        .padding(.bottom, Theme.Metric.cardGap)
    }

    private var otherWays: some View {
        VStack(spacing: 0) {
            SectionLabel(text: "Nearby computers")
            CardSection {
                discoveredComputers
            }
            SectionLabel(text: "Address and code")
                .padding(.top, Theme.Metric.cardGap)
            CardSection {
                manualEntry
            }
            Footer(text: "Use the address shown in Settings, then Phone, on your computer. A server's pairing link works too.")
        }
    }

    @ViewBuilder
    private var discoveredComputers: some View {
        if let discoveryFailure = discovery.failure {
            CardRow(title: discoveryFailure, systemImage: "wifi.exclamationmark")
        } else if discovery.found.isEmpty {
            HStack(spacing: 10) {
                Text("Computers ready to pair appear here.")
                    .font(Theme.Font.rowTitle)
                    .foregroundStyle(Theme.textSecondary)
                Spacer()
                if discovery.browsing {
                    ProgressView()
                        .controlSize(.small)
                        .accessibilityLabel("Looking for computers")
                }
            }
            .padding(.horizontal, Theme.Metric.rowInset)
            .frame(minHeight: Theme.Metric.rowHeight)
        } else {
            ForEach(Array(discovery.found.enumerated()), id: \.element.id) { index, service in
                if index > 0 { CardHairline(leadingInset: 44.8) }
                CardRow(title: LocalizedStringKey(service.name), systemImage: "laptopcomputer", accessory: .chevron) {
                    Task { await choose(service) }
                }
                .accessibilityHint("Enter the code shown on this computer")
            }
        }
    }

    private var manualEntry: some View {
        VStack(spacing: 0) {
            OnboardingField(placeholder: "Computer address", text: $manualAddress, identifier: "pairing-address")
                .onSubmit(continueWithAddress)
            CardHairline()
            CardRow(title: "Continue", accessory: .chevron, style: .action, action: continueWithAddress)
                .disabled(manualAddress.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .accessibilityIdentifier("pairing-continue")
        }
    }

    private func continueWithAddress() {
        failure = nil
        guard !manualAddress.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        // The whole link a server printed (https://host/pair#code=...) is
        // fine here too: it names both the address and the code.
        if let url = URL(string: manualAddress.trimmingCharacters(in: .whitespacesAndNewlines)),
           let invite = PairingInvite.parse(url) {
            accept(invite)
            return
        }
        guard let connection = Self.parse(manualAddress) else {
            failure = String(localized: "That address doesn't look right. Copy it from Phone settings on your computer and try again.")
            return
        }
        choiceGeneration += 1
        scannedCredential = nil
        pairRequestId = nil
        chosen = connection
    }

    @ViewBuilder
    private func confirmationView(for connection: Connection) -> some View {
        let badge = connectionBadge(for: connection)
        VStack(spacing: 0) {
            OnboardingHero(
                title: LocalizedStringKey(connection.name),
                subtitle: LocalizedStringKey(badge.title),
                color: "green",
                mascotSize: 72
            )

            SectionLabel(text: "Address")
            CardSection {
                CardRow(title: LocalizedStringKey(connection.pairingConsentOrigin), systemImage: badge.systemImage)
            }
            Footer(text: "Make sure this is the computer or server you expect before connecting.")

            if let origin = pulsatrixOrigin, scannedCredential == nil {
                SectionLabel(text: "Your organization")
                    .padding(.top, Theme.Metric.cardGap)
                CardSection {
                    CardRow(
                        title: "Sign in with Pulsatrix",
                        subtitle: "This server signs people in with Pulsatrix.",
                        systemImage: "building.2",
                        accessory: .chevron,
                        style: .action
                    ) { startPulsatrixSignIn(origin) }
                    .disabled(pairing || pulsatrixSignIn.running)
                    .accessibilityIdentifier("pairing-pulsatrix")
                }
            }

            if let credential = scannedCredential {
                if !connectionIsProtected(connection) {
                    Footer(text: "Only continue on a network you trust. Local connections are authenticated but not encrypted.")
                }
                OnboardingCapsule(title: "Connect", busyTitle: "Connecting...", busy: pairing, identifier: "pairing-connect") {
                    beginSubmission(connection, credential: credential, fromSignIn: false)
                }
                .padding(.horizontal, 23.17)
                .padding(.top, Theme.Metric.cardGap)
            } else {
                SectionLabel(text: "Pairing code")
                    .padding(.top, Theme.Metric.cardGap)
                CardSection {
                    TextField(text: $code) {
                        Text(verbatim: "000000").foregroundStyle(Theme.placeholder)
                    }
                    .keyboardType(.asciiCapable)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .textContentType(.oneTimeCode)
                    .font(.system(size: 24, weight: .semibold, design: .rounded))
                    .foregroundStyle(Theme.textPrimary)
                    .multilineTextAlignment(.center)
                    .frame(height: 56)
                    .accessibilityIdentifier("pairing-code")
                    .onValueChange(of: code) { value in
                        // six digits for a computer, ABCD-EFGH-JKLM for a server
                        code = String(value.uppercased().filter { $0.isASCII && ($0.isNumber || $0.isLetter || $0 == "-") }.prefix(14))
                    }
                }
                Footer(text: code.count >= 12 && !Self.codeLooksComplete(code)
                    ? "A server's code is 12 letters and digits, never 0, O, 1 or I."
                    : "The code shown on your computer: 6 digits, or 12 characters for a server.")
                OnboardingCapsule(title: "Connect", busyTitle: "Connecting...", busy: pairing, enabled: Self.codeLooksComplete(code), identifier: "pairing-connect") {
                    beginSubmission(connection, credential: code, fromSignIn: false)
                }
                .padding(.horizontal, 23.17)
                .padding(.top, Theme.Metric.cardGap)
            }

            Button {
                Haptics.selection()
                chosen = nil
                code = ""
                scannedCredential = nil
                pairRequestId = nil
                failure = nil
            } label: {
                Text("Choose a different computer")
                    .font(Theme.Font.rowTitle)
                    .foregroundStyle(Theme.textSecondary)
                    .frame(maxWidth: .infinity)
                    .frame(height: 44)
            }
            .buttonStyle(.plain)
            .disabled(!submission.allowsNavigation)
            .padding(.top, 8)
            .accessibilityIdentifier("pairing-different")
        }
        .task(id: connection.pairingConsentOrigin) {
            await probePulsatrixSignIn(connection)
        }
    }

    /// Ask the chosen server whether it signs people in with Pulsatrix.
    /// Anything but a clear yes keeps the code entry alone.
    @MainActor
    private func probePulsatrixSignIn(_ connection: Connection) async {
        pulsatrixOrigin = nil
        guard scannedCredential == nil, let base = connection.baseURL else { return }
        let probe = CompanionClient(connection: connection, token: nil, requestTimeout: 8)
        guard let environment = try? await probe.environment(), environment.offersPulsatrixSignIn else { return }
        guard chosen?.pairingConsentOrigin == connection.pairingConsentOrigin else { return }
        pulsatrixScheme = PulsatrixSignIn.returnScheme(for: environment.identity)
        pulsatrixOrigin = base
    }

    @MainActor
    private func startPulsatrixSignIn(_ origin: URL) {
        failure = nil
        pulsatrixSignIn.start(origin: origin, scheme: pulsatrixScheme) { outcome in
            guard case let .invite(invite) = outcome else {
                failure = (OrgConnectError.from(outcome) ?? .signInUnexpected).localizedMessage
                return
            }
            // The person chose this server and signed in on it: redeem the
            // two-minute credential it handed back right away, and keep this
            // screen (with the reason) if that fails.
            accept(invite)
            beginSubmission(invite.connection, credential: invite.credential, fromSignIn: true)
        }
    }

    @MainActor
    private func choose(_ service: Discovery.Found) async {
        choiceGeneration += 1
        let generation = choiceGeneration
        failure = nil
        pairRequestId = nil
        do {
            let resolved = try await discovery.resolve(service)
            guard generation == choiceGeneration else { return }
            chosen = resolved
        } catch {
            guard generation == choiceGeneration else { return }
            failure = error.localizedDescription
        }
    }

    @MainActor
    private func beginSubmission(_ connection: Connection, credential: String, fromSignIn: Bool) {
        guard submission.begin() else { return }
        Task { await submit(connection, credential: credential, fromSignIn: fromSignIn) }
    }

    @MainActor
    private func submit(_ connection: Connection, credential: String, fromSignIn: Bool) async {
        failure = nil
        var succeeded = false
        defer {
            submission.finish()
            // A deep link received during the commit cannot replace the
            // consent screen. If this request failed, present it only after
            // the in-flight request has fully settled.
            if succeeded {
                session.consumePairingInvite()
                onCancel()
            } else {
                accept(session.pairingInvite)
            }
        }
        let cameFromScanner = scannedCredential != nil
        let requestId = pairRequestId ?? UUID().uuidString
        pairRequestId = requestId
        do {
            try await session.pair(
                with: connection,
                credential: credential,
                deviceName: Self.deviceName(),
                pairRequestId: requestId
            )
            pairRequestId = nil
            succeeded = true
        } catch {
            if fromSignIn {
                // A sign-in's credential is single use: stay on this server,
                // say why, and offer the sign-in again.
                failure = OrgSignInView.map(error, host: connection.displayAddress).localizedMessage
                scannedCredential = nil
                pairRequestId = nil
                return
            }
            if cameFromScanner {
                if error is PairingRouteError {
                    failure = error.localizedDescription
                } else {
                    failure = "\(error.localizedDescription) " + String(localized: "Start pairing again on your computer and scan the new QR code.")
                    chosen = nil
                    scannedCredential = nil
                    pairRequestId = nil
                }
            } else {
                failure = error.localizedDescription
                if !(error is PairingRouteError) {
                    code = ""
                    pairRequestId = nil
                }
            }
        }
    }

    /// A companion's six digits, or a server's twelve characters.
    static func codeLooksComplete(_ code: String) -> Bool {
        (code.count == 6 && code.allSatisfy(\.isNumber)) || PairingInvite.normalizedServerCode(code) != nil
    }

    private func accept(_ invite: PairingInvite?) {
        guard submission.allowsNavigation, let invite else { return }
        choiceGeneration += 1
        chosen = invite.connection
        scannedCredential = invite.credential
        pairRequestId = UUID().uuidString
        code = ""
        failure = nil
        session.consumePairingInvite()
    }

    private func connectionIsProtected(_ connection: Connection) -> Bool {
        connection.activeEndpoint?.protectsCredentials
            ?? connection.automaticEndpoints.first?.protectsCredentials
            ?? false
    }

    private func connectionBadge(for connection: Connection) -> (title: String, systemImage: String) {
        let kind = connection.activeEndpoint?.kind ?? connection.automaticEndpoints.first?.kind
        if kind == .hosted {
            return ("HTTPS connection", "lock.shield.fill")
        }
        if kind == .tailnet {
            return ("Tailscale connection", "lock.shield.fill")
        }
        return ("Trusted local connection", "checkmark.shield.fill")
    }

    static func deviceName() -> String {
        #if canImport(UIKit)
        return UIDevice.current.name
        #else
        return "Companion"
        #endif
    }

    static func parse(_ text: String) -> Connection? {
        Connection.parse(text)
    }
}
