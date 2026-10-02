// The first screen, and the home of a phone that is not connected: the
// Sagax owl and three ways in. An organization signs people in with
// Pulsatrix; a computer pairs with its QR code; the demo needs nothing.
import SwiftUI

struct SagaxWelcomeView: View {
    let onOrganization: () -> Void
    let onComputer: () -> Void
    let onDemo: () -> Void
    @State private var showingSettings = false

    var body: some View {
        OnboardingPage(
            trailing: .init(systemImage: "gearshape", label: "Settings", identifier: "welcome-settings") { showingSettings = true }
        ) {
            OnboardingHero(
                title: "Welcome to Sagax",
                subtitle: "Your bots keep working on your computer or your organization's server. Follow them, answer their questions and send them work from here."
            )

            CardSection {
                CardRow(
                    title: "Sign in to an organization",
                    subtitle: "With your Pulsatrix account. Passkeys work.",
                    systemImage: "building.2",
                    accessory: .chevron,
                    action: onOrganization
                )
                .accessibilityIdentifier("welcome-organization")
                CardHairline(leadingInset: 44.8)
                CardRow(
                    title: "Connect my computer",
                    subtitle: "Scan the QR code shown in Sagax on your computer.",
                    systemImage: "laptopcomputer",
                    accessory: .chevron,
                    action: onComputer
                )
                .accessibilityIdentifier("welcome-computer")
            }

            SectionLabel(text: "No account yet?")
                .padding(.top, Theme.Metric.cardGap)
            CardSection {
                CardRow(
                    title: "Try the demo",
                    subtitle: "Made-up bots and chats. Nothing leaves this phone.",
                    systemImage: "sparkles",
                    accessory: .chevron,
                    action: onDemo
                )
                .accessibilityIdentifier("welcome-demo")
            }
            Footer(text: "Your data stays on your computer or your organization's server. This phone keeps only a sign-in, in the Keychain.")
        }
        .sheet(isPresented: $showingSettings) {
            SettingsView(onConnect: {
                showingSettings = false
                onComputer()
            }, close: { showingSettings = false })
        }
    }
}
