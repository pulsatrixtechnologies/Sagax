// The terms of use, accepted once per account (App Store guideline 1.2,
// Session+Moderation.swift): shown after connecting while the server says
// this person has not accepted them. "I agree" is kept on the server with
// its date, so no other device asks again. The demo asks too.
import CompanionCore
import SwiftUI

struct TermsAcceptanceSheet: View {
    @Environment(\.themePalette) var themePalette
    @Environment(\.openURL) private var openURL
    @EnvironmentObject private var session: Session
    @State private var saving = false
    @State private var failed = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Image(systemName: "checkmark.shield")
                        .font(.system(size: 40))
                        .foregroundStyle(Theme.blue)
                    Text("Before you continue, read and accept the terms of use.")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(Theme.textPrimary)
                    Text("There is zero tolerance for objectionable or abusive content. Anyone can report a message or block a person, and the admins review every report.")
                        .font(.system(size: 15))
                        .foregroundStyle(Theme.textSecondary)
                    Button {
                        openURL(Moderation.termsURL)
                    } label: {
                        Label("Read the terms", systemImage: "arrow.up.right")
                    }
                    .accessibilityIdentifier("terms-read")
                    if failed {
                        Text("Could not save your answer. Check the connection and try again.")
                            .font(.system(size: 14))
                            .foregroundStyle(.red)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(24)
            }
            .safeAreaInset(edge: .bottom) {
                Button {
                    saving = true
                    failed = false
                    Task {
                        failed = !(await session.acceptTerms())
                        saving = false
                    }
                } label: {
                    Text("I agree")
                        .font(.system(size: 17, weight: .semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                }
                .buttonStyle(.borderedProminent)
                .disabled(saving)
                .padding(.horizontal, 24)
                .padding(.bottom, 12)
                .accessibilityIdentifier("terms-accept")
            }
            .navigationTitle("Terms of use")
            .navigationBarTitleDisplayMode(.inline)
        }
        .interactiveDismissDisabled()
        .accessibilityIdentifier("terms-sheet")
    }
}
