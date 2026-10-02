import SwiftUI

/// After the first connection: ask once for notifications, in the same
/// design as the other onboarding pages.
struct NotificationOnboardingView: View {
    @EnvironmentObject private var session: Session
    @State private var enabling = false
    let onContinue: () -> Void

    var body: some View {
        OnboardingPage {
            OnboardingHero(
                title: "Stay in the loop",
                subtitle: "Get alerts while Sagax is open or was recently in the background. Alerts stop after iOS fully suspends or closes the app.",
                color: "green"
            )
            CardSection {
                CardRow(title: "Approvals that are waiting for you", systemImage: "checkmark.circle")
                CardHairline(leadingInset: 44.8)
                CardRow(title: "Finished work and important updates", systemImage: "sparkles")
            }
        } footer: {
            VStack(spacing: 4) {
                OnboardingCapsule(title: "Enable notifications", busy: enabling, identifier: "notifications-enable") {
                    enabling = true
                    Task {
                        await session.enableNotifications()
                        enabling = false
                        onContinue()
                    }
                }
                Button(action: onContinue) {
                    Text("Not now")
                        .font(Theme.Font.rowTitle)
                        .foregroundStyle(Theme.textSecondary)
                        .frame(maxWidth: .infinity)
                        .frame(height: 40)
                }
                .buttonStyle(.plain)
                .disabled(enabling)
            }
        }
    }
}
