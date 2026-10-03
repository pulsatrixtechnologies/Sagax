// The connector card (feature parity CA10, ConnectorCard.tsx): a bot asked
// to connect an app from the conversation. Connect asks the computer for the
// provider's sign-in page and opens it in ASWebAuthenticationSession; the
// card then checks the connection (every 4 s while it waits, as the desktop
// polls) and the computer resumes the paused task once the app is
// connected. "Continue task" resumes by hand; the X is "Not now".
import SwiftUI
import AuthenticationServices
import CompanionCore
import UIKit

struct ConnectorCardView: View {
    @Environment(\.themePalette) var themePalette
    let chat: Chat
    let message: Message
    let connector: ConnectorRequestCard
    @EnvironmentObject private var session: Session
    @State private var busy = false
    @State private var localError: String?

    private var tint: Color { MausPalette.color(message.from?.color ?? chat.color) }
    private var connected: Bool { connector.state == .connected }
    private var canAuthorize: Bool { session.surfaceGate.allows(.connectorCardAuthorize) }

    var body: some View {
        if connector.dismissed != true {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top, spacing: 11) {
                    Text(String(connector.label.prefix(1)).uppercased())
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(Theme.readable(tint))
                        .frame(width: 38, height: 38)
                        .background(tint.opacity(0.13), in: RoundedRectangle(cornerRadius: 11, style: .continuous))
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(spacing: 6) {
                            Text(connector.label)
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundStyle(Theme.textPrimary)
                                .lineLimit(1)
                            if connected {
                                Label("Connected", systemImage: "checkmark")
                                    .font(.system(size: 11, weight: .semibold))
                                    .foregroundStyle(Theme.success)
                                    .padding(.horizontal, 7)
                                    .padding(.vertical, 2)
                                    .background(Theme.success.opacity(0.15), in: Capsule())
                            }
                        }
                        Text(description)
                            .font(.system(size: 14))
                            .foregroundStyle(Theme.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                        if !connected {
                            Text("Sign in or enter the app key on the secure connection page, never in chat.")
                                .font(.system(size: 12))
                                .foregroundStyle(Theme.textTertiary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        if let error = localError ?? connector.error, !error.isEmpty {
                            Text(error)
                                .font(.system(size: 12.5))
                                .foregroundStyle(Theme.danger)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    Spacer(minLength: 0)
                    if !connected {
                        Button {
                            Haptics.selection()
                            Task { await session.dismissConnectorCard(message, in: chat) }
                        } label: {
                            Image(systemName: "xmark")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(Theme.textSecondary)
                                .frame(width: 28, height: 28)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text("Not now"))
                        .accessibilityIdentifier("connector-dismiss-\(message.id)")
                    }
                }

                HStack(spacing: 8) {
                    HStack(spacing: 5) {
                        if connector.state == .authorizing {
                            ProgressView().controlSize(.mini)
                        } else {
                            Image(systemName: "powerplug")
                        }
                        Text(statusLine)
                    }
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textSecondary)
                    Spacer(minLength: 4)
                    actionButton
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 22, style: .continuous).fill(Theme.inset))
            .overlay {
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .strokeBorder(connector.isPending ? tint.opacity(0.65) : Color.clear, lineWidth: 1.25)
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("connector-card-\(message.id)")
            // While the provider's page waits on the person, ask the computer
            // whether the app is connected, as the desktop polls.
            .task(id: ConnectorCardRules.polls(connector)) {
                guard ConnectorCardRules.polls(connector) else { return }
                for _ in 0..<ConnectorCardRules.pollLimit {
                    try? await Task.sleep(nanoseconds: UInt64(ConnectorCardRules.pollInterval * 1_000_000_000))
                    guard !Task.isCancelled else { return }
                    if await session.connectorCardStatus(message, in: chat) == true { return }
                }
            }
        }
    }

    private var description: String {
        guard connected else { return connector.description }
        return connector.resumed == true
            ? String(localized: "Connected securely. Your bot is continuing the task.")
            : String(localized: "Connected securely. Continue the paused task when you're ready.")
    }

    private var statusLine: String {
        switch connector.state {
        case .authorizing: String(localized: "Waiting for sign-in…")
        case .connected: String(localized: "Ready to use")
        default: String(localized: "Requested by your bot")
        }
    }

    @ViewBuilder
    private var actionButton: some View {
        switch ConnectorCardRules.action(connector) {
        case let .connect(label):
            if canAuthorize {
                filledButton(connectTitle(label), systemImage: "powerplug.fill", id: "connector-connect-\(message.id)") {
                    await connect()
                }
            }
        case .continueTask:
            filledButton(String(localized: "Continue task"), systemImage: "arrow.clockwise", id: "connector-continue-\(message.id)") {
                localError = await session.resumeConnectorCard(message, in: chat)
            }
        case .continuing:
            Label("Continuing", systemImage: "checkmark")
                .font(.system(size: 12.5, weight: .semibold))
                .foregroundStyle(Theme.success)
                .accessibilityIdentifier("connector-continuing-\(message.id)")
        }
    }

    private func connectTitle(_ label: ConnectorCardRules.ConnectLabel) -> String {
        switch label {
        case .connectSecurely: String(localized: "Connect securely")
        case .tryAgain: String(localized: "Try again")
        case .openAgain: String(localized: "Open again")
        }
    }

    private func filledButton(
        _ title: String, systemImage: String, id: String, _ action: @escaping () async -> Void
    ) -> some View {
        Button {
            Haptics.selection()
            busy = true
            localError = nil
            Task {
                await action()
                busy = false
            }
        } label: {
            HStack(spacing: 6) {
                if busy { ProgressView().controlSize(.mini).tint(.white) } else { Image(systemName: systemImage) }
                Text(title)
            }
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(.white)
            .padding(.horizontal, 12)
            .frame(height: 34)
            .background(Capsule().fill(Theme.readable(tint)))
        }
        .buttonStyle(.plain)
        .disabled(busy)
        .accessibilityIdentifier(id)
    }

    /// The computer marks the card authorizing and returns the provider's
    /// page; the phone shows it and checks the connection once it closes.
    private func connect() async {
        do {
            let url = try await session.authorizeConnectorCard(message, in: chat)
            await ConnectorSignIn.open(url)
            _ = await session.connectorCardStatus(message, in: chat)
        } catch {
            localError = error.localizedDescription
        }
    }
}

/// The provider's sign-in page in ASWebAuthenticationSession. The page has
/// no way back into the app (the provider finishes on its own site), so
/// the session ends when the person closes it; the computer learns the
/// result from the provider and the card asks it.
@MainActor
enum ConnectorSignIn {
    private final class Anchor: NSObject, ASWebAuthenticationPresentationContextProviding {
        func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
            MainActor.assumeIsolated {
                let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
                return scenes.flatMap(\.windows).first(where: \.isKeyWindow) ?? ASPresentationAnchor()
            }
        }
    }

    private static let anchor = Anchor()
    private static var current: ASWebAuthenticationSession?

    static func open(_ url: URL) async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: nil) { _, _ in
                Task { @MainActor in current = nil }
                continuation.resume()
            }
            session.presentationContextProvider = anchor
            session.prefersEphemeralWebBrowserSession = false
            current = session
            if !session.start() {
                current = nil
                continuation.resume()
            }
        }
    }
}
