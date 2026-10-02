// Colours for the mascots and the rest of the app: the twelve Sagax bot
// colours (`MausColors` in CompanionCore, copied from `src/lib/mascot.ts`) as
// SwiftUI colours, and the small hex helpers the renderers share.
import CompanionCore
import SwiftUI

enum MausPalette {
    /// A bot colour name (or a `#RRGGBB`) as its palette colour; unknown
    /// names are a neutral grey so a typo never paints a bot as another one.
    static func color(_ name: String) -> Color {
        Color(hex: MausColors.hex(for: name) ?? "#8E8E93")
    }

    /// The colour as text or a tint on the app's own surfaces (`MAUS_INK`):
    /// black reads as a cool slate there.
    static func ink(_ name: String) -> Color {
        Color(hex: MausColors.ink[name] ?? MausColors.hex(for: name) ?? "#8E8E93")
    }
}

extension Color {
    init(hex: String) {
        let c = RGB(hex: hex)
        self.init(.sRGB, red: c.r / 255, green: c.g / 255, blue: c.b / 255, opacity: 1)
    }

    init(hex: String, opacity: Double) {
        let c = RGB(hex: hex)
        self.init(.sRGB, red: c.r / 255, green: c.g / 255, blue: c.b / 255, opacity: opacity)
    }

    init(_ rgba: RGBA, opacity: Double = 1) {
        self.init(.sRGB, red: rgba.r / 255, green: rgba.g / 255, blue: rgba.b / 255, opacity: rgba.a * opacity)
    }
}

/// The person, not a bot: the roster header and the settings row. A letter
/// rather than a mascot, deliberately: the mascots mean "this is a bot".
struct ProfileAvatar: View {
    let name: String
    var size: CGFloat = 34

    var body: some View {
        Circle()
            .fill(MausPalette.color("green"))
            .frame(width: size, height: size)
            .overlay {
                Text(initial)
                    .font(.system(size: size * 0.45, weight: .semibold))
                    .foregroundStyle(.white)
            }
    }

    private var initial: String {
        String(name.trimmingCharacters(in: .whitespaces).prefix(1)).uppercased()
    }
}

/// Paths in a mascot's viewBox, parsed once per string.
enum MascotPaths {
    static func path(_ d: String) -> Path { Path(SVGPath.cached(d)) }

    static func union(_ ds: [String]) -> Path {
        var p = Path()
        for d in ds { p.addPath(path(d)) }
        return p
    }
}

extension GraphicsContext {
    /// `around(o, inner)`: run `inner` in a context whose transforms pivot on `o`.
    mutating func pivot(_ o: CGPoint, rotate degrees: Double = 0, scaleX: CGFloat = 1, scaleY: CGFloat = 1) {
        translateBy(x: o.x, y: o.y)
        if degrees != 0 { rotate(by: .degrees(degrees)) }
        if scaleX != 1 || scaleY != 1 { scaleBy(x: scaleX, y: scaleY) }
        translateBy(x: -o.x, y: -o.y)
    }
}

/// The app's mascot states, as the characters read them.
extension MausState {
    var owlState: OwlState { OwlState.forMaus(rawValue) }
    var shapeMood: ShapeMood { ShapeMood.forState(rawValue) }
    var trombiPose: TrombiPose { TrombiPose.forState(rawValue) }
}
