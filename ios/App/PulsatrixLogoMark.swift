// The Pulsatrix logo (the owl mask with the ECG pulse, public/brand/
// pulsatrix-owl-mark.svg) where the screen speaks for the brand: onboarding,
// sign-in, pairing and the Settings footer. White on a dark page, navy
// (#03153c) on a light one, like the desktop's PulsatrixMark. The bot
// mascots stay for the bots.
import SwiftUI

struct PulsatrixLogoMark: View {
    @Environment(\.colorScheme) private var colorScheme
    /// The mark's width; its height follows the 28 by 25 drawing.
    var size: CGFloat = 96

    static let navy = Color(red: 3 / 255, green: 21 / 255, blue: 60 / 255)

    var body: some View {
        Image("PulsatrixLogo")
            .renderingMode(.template)
            .resizable()
            .aspectRatio(28 / 25, contentMode: .fit)
            .frame(width: size)
            .foregroundStyle(colorScheme == .dark ? Color.white : Self.navy)
            .accessibilityLabel(Text(verbatim: "Pulsatrix"))
            .accessibilityIdentifier("pulsatrix-logo")
    }
}
