// The classification band of a confidential thread (CompanionCore
// `ConfidentialBanner`): a solid band across the conversation, at the top
// under the header and again above the composer, like the marking on a
// classified document. It is the same in light and dark (white on deep
// blue, about 11:1), has no close control, and its height is reserved so
// the transcript never jumps.
import CompanionCore
import SwiftUI

struct ConfidentialBannerView: View {
    enum Edge { case top, bottom }
    let edge: Edge

    /// Deep classification blue, identical in both themes.
    static let band = Color(red: 0.0, green: 0.2, blue: 0.627)

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: ConfidentialBanner.symbol)
                .font(.system(size: 11, weight: .bold))
            Text(LocalizedStringKey(ConfidentialBanner.labelKey))
                .font(.system(size: 12, weight: .heavy))
                .tracking(2)
                .textCase(.uppercase)
        }
        .foregroundStyle(Color.white)
        .frame(maxWidth: .infinity)
        .frame(height: CGFloat(ConfidentialBanner.height))
        .background(Self.band)
        .environment(\.colorScheme, .dark)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(LocalizedStringKey(ConfidentialBanner.accessibilityKey)))
        .accessibilityAddTraits(.isStaticText)
        .accessibilityIdentifier(edge == .top ? "confidential-banner-top" : "confidential-banner-bottom")
    }
}

/// The lock and « Confidentiel » of a confidential thread's row and title.
struct ConfidentialMark: View {
    var showsLabel = true

    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: ConfidentialBanner.symbol)
                .font(.caption2.weight(.semibold))
            if showsLabel {
                Text("Confidential")
                    .font(.caption2.weight(.semibold))
            }
        }
        .foregroundStyle(ConfidentialBannerView.band)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("Confidential"))
        .accessibilityIdentifier("confidential-mark")
    }
}
