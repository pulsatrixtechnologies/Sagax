// Routines in my name (matrix AU19), as src/lib/routine-delegation.ts does
// it on the desktop: after a person creates a routine on an organization
// server (the editor, the Automations calendar's quick create), a person
// whose routines may not act in their name yet is sent to the Perspicax
// consent once (a later routine never sends them again). The Organization
// page shows the outcome once.
//
// The consent: POST /api/org/routine-delegation answers the authorization
// address and sets the flow's binding cookie; Perspicax signs the person in
// and returns to the server's callback, which ends on
// `/#routine-delegation=ok` or `/#routine-delegation-error=<code>`. On the
// phone that runs in a sheet's web view holding the binding cookie, which
// stops at that address and says how it went.
import CompanionCore
import SwiftUI
import UIKit
import WebKit

extension Session {
    /// A routine was created (`saveRoutine`): on an organization server,
    /// `ensureRoutineDelegation`.
    func routineCreated() {
        guard surfaceGate.allows(.orgRoutineDelegation), let client = settingsClient else { return }
        Task { await RoutineDelegationFlow.shared.ensure(client: client) }
    }
}

@MainActor
final class RoutineDelegationFlow: ObservableObject {
    static let shared = RoutineDelegationFlow()

    /// The outcome of the last consent, shown once on the Organization page.
    @Published var pendingOutcome: RoutineDelegationReturn?
    /// Bumped when a consent ended: the Organization page reloads.
    @Published private(set) var generation = 0

    private let defaults = UserDefaults.standard

    private init() {
#if DEBUG
        // UI tests start each run as a person never asked.
        if ProcessInfo.processInfo.arguments.contains("-resetRoutineDelegationConsent") {
            for key in defaults.dictionaryRepresentation().keys where key.hasPrefix(RoutineDelegation.autoConsentKey) {
                defaults.removeObject(forKey: key)
            }
        }
#endif
    }

    /// Starts the consent once per person; nothing when it is active or was
    /// already started by an earlier routine.
    func ensure(client: CompanionClient) async {
        guard let status = try? await client.routineDelegation() else { return }
        let key = RoutineDelegation.autoConsentKey(for: status)
        guard RoutineDelegation.shouldStart(status, alreadyAsked: defaults.object(forKey: key) != nil) else { return }
        defaults.set(Date().timeIntervalSince1970 * 1000, forKey: key)
        await start(client: client, after: 0.8)
    }

    /// The consent sheet, over whatever is on screen (a sheet that just
    /// saved is given `delay` to close first).
    func start(client: CompanionClient, after delay: Double = 0) async {
        let started: RoutineDelegationStart
        do { started = try await client.startRoutineDelegation() } catch {
            pendingOutcome = .error("unavailable")
            return
        }
        if delay > 0 { try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000)) }
        guard let top = Self.topViewController() else { return }
        let host = UIHostingController(rootView: RoutineDelegationConsentView(start: started) { [weak self] outcome in
            if let outcome { self?.pendingOutcome = outcome }
            self?.generation += 1
            top.presentedViewController?.dismiss(animated: true)
        }.themeRoot())
        host.modalPresentationStyle = .pageSheet
        host.view.accessibilityIdentifier = "routine-delegation-consent"
        top.present(host, animated: true)
    }

    static func topViewController() -> UIViewController? {
        let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive } ?? UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        let root = scene?.windows.first { $0.isKeyWindow }?.rootViewController ?? scene?.windows.first?.rootViewController
        var top = root
        while let next = top?.presentedViewController, !next.isBeingDismissed { top = next }
        return top
    }

    /// The sentence for an outcome (`routineDelegationReturnText`).
    static func text(_ outcome: RoutineDelegationReturn) -> String {
        switch outcome {
        case .ok: return String(localized: "Your routines can act in your name.")
        case .error("routines_subject"): return String(localized: "You signed in to Perspicax with another account. Try again with yours.")
        case .error("routines_scope"): return String(localized: "Perspicax did not grant routine delegation. It needs an update.")
        case .error("routines_session"): return String(localized: "Your session ended during the authorization. Sign in and try again.")
        case .error("rate_limited"): return String(localized: "Perspicax is busy right now. Wait a minute and allow your routines again.")
        case let .error(code): return String(localized: "The authorization did not complete (\(code)).")
        }
    }
}

/// The consent at Perspicax, in a web view that stops on the way back.
struct RoutineDelegationConsentView: View {
    @Environment(\.themePalette) var themePalette
    let start: RoutineDelegationStart
    let done: (RoutineDelegationReturn?) -> Void
    @State private var outcome: RoutineDelegationReturn?
    @State private var loading = true

    var body: some View {
        NavigationStack {
            Group {
                if let outcome {
                    VStack(spacing: 14) {
                        Image(systemName: outcome == .ok ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                            .font(.system(size: 40))
                            .foregroundStyle(outcome == .ok ? Theme.success : Theme.warning)
                        Text(verbatim: RoutineDelegationFlow.text(outcome))
                            .font(Theme.Font.body)
                            .foregroundStyle(Theme.textPrimary)
                            .multilineTextAlignment(.center)
                            .accessibilityIdentifier("routine-delegation-outcome")
                    }
                    .padding(32)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    VStack(spacing: 0) {
                        Text("Your routines run on this server while you are away and act in your name: they use your Perspicax tools and the bot owner's model access. It is allowed by default; Perspicax asks you to confirm it once, after your first routine. You can revoke it in Perspicax.")
                            .font(Theme.Font.label)
                            .foregroundStyle(Theme.textSecondary)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 10)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .accessibilityIdentifier("routine-delegation-help")
                        ConsentWebView(start: start, loading: $loading) { outcome = $0 }
                            .overlay { if loading { ProgressView().tint(Theme.textSecondary) } }
                    }
                }
            }
            .background(Theme.bg.ignoresSafeArea())
            .navigationTitle(Text("Routines in my name"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(outcome == nil ? String(localized: "Close") : String(localized: "Done")) { done(outcome) }
                        .accessibilityIdentifier("routine-delegation-close")
                }
            }
        }
    }
}

private struct ConsentWebView: UIViewRepresentable {
    let start: RoutineDelegationStart
    @Binding var loading: Bool
    let finished: (RoutineDelegationReturn) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        // Nothing of the sign-in stays on the phone.
        configuration.websiteDataStore = .nonPersistent()
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        view.accessibilityIdentifier = "routine-delegation-web"
        let store = configuration.websiteDataStore.httpCookieStore
        let cookies = start.cookies
        let url = start.authorizationURL
        Task { @MainActor in
            for cookie in cookies { await store.setCookie(cookie) }
            view.load(URLRequest(url: url))
        }
        return view
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate {
        let parent: ConsentWebView
        init(_ parent: ConsentWebView) { self.parent = parent }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
            if let outcome = RoutineDelegationReturn(fragment: navigationAction.request.url?.fragment) {
                await MainActor.run { parent.finished(outcome) }
                return .cancel
            }
            return .allow
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            parent.loading = false
            // A same-document hash change reaches no policy check.
            if let outcome = RoutineDelegationReturn(fragment: webView.url?.fragment) { parent.finished(outcome) }
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { parent.loading = false }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { parent.loading = false }
    }
}
