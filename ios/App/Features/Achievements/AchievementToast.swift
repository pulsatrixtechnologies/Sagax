// The unlock banner (AchievementToaster.tsx): a rarity badge with the icon,
// "Achievement unlocked" and the points, the name, the reward, and a close
// button. It sits in a window of its own above every sheet, so a banner is
// seen wherever the person is, and lets touches through elsewhere.
//
// `achievementsHost()` on the app's root drives the store: the first read
// and `app.opened` for each pairing, a reload whenever the app comes back
// to the front.
import CompanionCore
import SwiftUI
import UIKit

extension View {
    /// The achievements of the paired person: reads, reports, banners.
    /// `session` is passed in: the root's environment object is set inside.
    func achievementsHost(_ session: Session) -> some View { modifier(AchievementsHost(session: session)) }
}

private struct AchievementsHost: ViewModifier {
    @ObservedObject var session: Session
    @Environment(\.scenePhase) private var scenePhase
    @ObservedObject private var store = AchievementStore.shared

    func body(content: Content) -> some View {
        content
            .task(id: session.connection?.id) { await start() }
            .onValueChange(of: scenePhase) { phase in
                if phase == .active, Self.live { Task { await store.reload() } }
            }
            .onValueChange(of: store.toast) { item in
                AchievementToastWindow.shared.show(item)
            }
            // A banner waits while the person types (TYPING_QUIET_MS).
            .onReceive(NotificationCenter.default.publisher(for: UITextView.textDidChangeNotification)) { _ in
                AchievementTyping.lastKeystroke = Date()
            }
            .onReceive(NotificationCenter.default.publisher(for: UITextField.textDidChangeNotification)) { _ in
                AchievementTyping.lastKeystroke = Date()
            }
    }

    /// The parity captures and the demo never report: a banner over a
    /// reference screen would break it. `-achievementsLive` turns it on for
    /// the UI tests.
    static var live: Bool {
        if ProcessInfo.processInfo.arguments.contains("-achievementsLive") { return true }
        return !ParityMode.isActive
    }

    private func start() async {
        let gate = session.surfaceGate
        guard let client = session.settingsClient, !session.isDemo, gate.allows(.achievements) else {
            store.attach(client: nil, connectionID: nil)
            return
        }
        store.attach(client: client, connectionID: session.connection?.id)
        if Self.live { await store.appOpened() }
    }
}

/// The window the banner is drawn in.
@MainActor
final class AchievementToastWindow {
    static let shared = AchievementToastWindow()
    private var window: PassthroughWindow?

    func show(_ item: AchievementToastItem?) {
        if item != nil, window == nil, let scene = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene })
            .first(where: { $0.activationState == .foregroundActive }) ?? UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first {
            let window = PassthroughWindow(windowScene: scene)
            window.windowLevel = .alert + 1
            window.backgroundColor = .clear
            let host = UIHostingController(rootView: AchievementToastLayer().themeRoot())
            host.view.backgroundColor = .clear
            window.rootViewController = host
            window.isHidden = false
            self.window = window
        }
    }
}

/// Touches land on the banner only; everywhere else they go to the app.
final class PassthroughWindow: UIWindow {
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        guard let hit = super.hitTest(point, with: event), hit !== rootViewController?.view else { return nil }
        return hit
    }
}

private struct AchievementToastLayer: View {
    @ObservedObject private var store = AchievementStore.shared

    var body: some View {
        VStack {
            if let item = store.toast {
                AchievementToastView(item: item) { store.dismissToast() }
                    .padding(.horizontal, 12)
                    .padding(.top, 6)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: 520)
        .frame(maxWidth: .infinity)
        .animation(.spring(response: 0.42, dampingFraction: 0.86), value: store.toast)
    }
}

struct AchievementToastView: View {
    @Environment(\.themePalette) var themePalette
    @Environment(\.locale) private var locale
    let item: AchievementToastItem
    let dismiss: () -> Void

    private var language: String? { AchievementLanguage.current ?? locale.language.languageCode?.identifier }

    var body: some View {
        let tint = AchievementWording.color(item.definition.rarity)
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: AchievementWording.symbol(item.definition.icon))
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 44, height: 44)
                .background(tint, in: Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    Image(systemName: "trophy.fill").font(.system(size: 10, weight: .semibold))
                    Text("Achievement unlocked")
                    Text(verbatim: "+\(item.points)")
                }
                .font(Theme.Font.labelMedium)
                .foregroundStyle(tint)
                Text(verbatim: item.definition.name.resolved(language))
                    .font(Theme.Font.bodyMedium)
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(1)
                if let reward = item.rewardLabel(language) {
                    Text(verbatim: reward)
                        .font(Theme.Font.label)
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 0)
            Button(action: dismiss) {
                Image(systemName: "xmark")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.textSecondary)
                    .frame(width: 30, height: 30)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("Dismiss"))
            .accessibilityIdentifier("achievement-toast-dismiss")
        }
        .padding(12)
        .background(Theme.cardRaised, in: RoundedRectangle(cornerRadius: max(Theme.Metric.cardRadius, 4), style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: max(Theme.Metric.cardRadius, 4), style: .continuous).strokeBorder(tint.opacity(0.5), lineWidth: 1))
        .shadow(color: .black.opacity(0.25), radius: 12, y: 4)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("achievement-toast")
    }
}
