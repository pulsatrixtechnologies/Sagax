// Hibou 98 and its Windows editions on the phone and the iPad: the window
// chrome the desktop draws around the app (src/components/retro98/
// RetroChrome.tsx, retro-chrome.css and src/styles/retro-editions/*.css),
// translated into a native view.
//
// - The desktop behind the window shows in the status bar: the teal of 98,
//   XP's sky over its green hill, Vista's and 7's aurora, 8's and 8.1's
//   flat colour, 10's blue bloom and 11's light bloom.
// - The title bar under it: the app's name (and the open bot's, as the
//   desktop's "Sagax - Nova") in the era's bar. 98: the navy gradient and
//   grey bevelled boxes. XP: Luna blue, rounded at the top, blue boxes and a
//   red close. Vista and 7: Aero, a translucent glass (a real material over
//   the wallpaper) with its reflections, the boxes hanging from the top edge
//   and the close wider and red. 8 and 8.1: flat, on the window frame's
//   colour. 10: a white bar with thin glyphs. 11: Mica, the wallpaper seen
//   through a frosted light tint, rounded at the top.
// - The caption boxes are drawn, as in a browser tab on the desktop, but do
//   nothing: the phone's own gestures close and switch apps. They are hidden
//   from VoiceOver.
//
// Nothing here exists under another skin: `RetroEdition.of` is nil and the
// bar takes no room (one view, never an `if` at the root, so a skin change
// does not reset the app's state).
import CompanionCore
import SwiftUI

enum RetroEdition: String, CaseIterable {
    case classic, xp, vista, win7, win8, win81, win10, win11

    /// The worn look's edition, or nil when Hibou 98 is not worn.
    static func of(_ palette: SkinPalette) -> RetroEdition? {
        guard palette.id == .retro98 else { return nil }
        guard let tint = palette.tint else { return .classic }
        return RetroEdition(rawValue: tint.rawValue) ?? .classic
    }

    /// The title bar's height (the desktop's px, as points).
    var titleHeight: CGFloat {
        switch self {
        case .classic: 22
        case .xp: 28
        case .vista, .win7, .win8: 30
        case .win81: 28
        case .win10, .win11: 32
        }
    }

    /// The top corners of the window (XP, Vista, 7 and 11 round them).
    var cornerRadius: CGFloat {
        switch self {
        case .xp: 8
        case .vista: 6
        case .win7: 7
        case .win11: 8
        default: 0
        }
    }
}

// MARK: - The desktop behind the window

/// The edition's wallpaper (`body` background of each edition's stylesheet).
struct RetroWallpaper: View {
    let edition: RetroEdition

    var body: some View {
        GeometryReader { geometry in
            let size = geometry.size
            ZStack {
                switch edition {
                case .classic:
                    Color(hex: 0x008080)
                case .xp:
                    LinearGradient(stops: [
                        .init(color: Color(hex: 0x1C5FD0), location: 0), .init(color: Color(hex: 0x3B84E6), location: 0.3),
                        .init(color: Color(hex: 0x7FB4EF), location: 0.58), .init(color: Color(hex: 0xB9D8F6), location: 0.72),
                        .init(color: Color(hex: 0xDCECFA), location: 0.8),
                    ], startPoint: .top, endPoint: .bottom)
                    glow(Color.white.opacity(0.6), at: CGPoint(x: 0.28, y: 0.22), size: size, scale: (0.44, 0.3))
                    Ellipse().fill(Color(hex: 0x4C9A2A))
                        .frame(width: size.width * 2.4, height: max(size.height * 0.96, 40))
                        .position(x: size.width * 0.38, y: size.height * 1.04 + max(size.height * 0.2, 12))
                case .vista:
                    LinearGradient(stops: [
                        .init(color: Color(hex: 0x021018), location: 0), .init(color: Color(hex: 0x063040), location: 0.38),
                        .init(color: Color(hex: 0x0B4A3C), location: 0.6), .init(color: Color(hex: 0x03141C), location: 1),
                    ], startPoint: UnitPoint(x: 0.2, y: 0), endPoint: UnitPoint(x: 0.8, y: 1))
                    glow(Color(red: 130 / 255, green: 230 / 255, blue: 120 / 255).opacity(0.7), at: CGPoint(x: 0.28, y: 0.64), size: size, scale: (1.1, 1.2))
                    glow(Color(red: 40 / 255, green: 180 / 255, blue: 200 / 255).opacity(0.65), at: CGPoint(x: 0.64, y: 0.46), size: size, scale: (0.96, 1.1))
                case .win7:
                    LinearGradient(stops: [
                        .init(color: Color(hex: 0x1D78CF), location: 0), .init(color: Color(hex: 0x105AA8), location: 0.55),
                        .init(color: Color(hex: 0x07326D), location: 1),
                    ], startPoint: .top, endPoint: .bottom)
                    glow(Color(red: 190 / 255, green: 235 / 255, blue: 1).opacity(0.8), at: CGPoint(x: 0.5, y: 0.44), size: size, scale: (0.68, 1.2))
                case .win8:
                    Color(hex: 0x00474F)
                case .win81:
                    Color(hex: 0x180052)
                case .win10:
                    RadialGradient(stops: [
                        .init(color: Color(hex: 0x00A2ED), location: 0), .init(color: Color(hex: 0x0063B1), location: 0.35),
                        .init(color: Color(hex: 0x002E6E), location: 0.7), .init(color: Color(hex: 0x001433), location: 1),
                    ], center: UnitPoint(x: 0.3, y: 1.1), startRadius: 0, endRadius: max(size.width, size.height) * 1.2)
                case .win11:
                    LinearGradient(stops: [
                        .init(color: Color(hex: 0xCFE0F6), location: 0), .init(color: Color(hex: 0xA8C6EE), location: 0.55),
                        .init(color: Color(hex: 0x8DB3E8), location: 1),
                    ], startPoint: UnitPoint(x: 0.3, y: 0), endPoint: UnitPoint(x: 0.7, y: 1))
                    glow(Color(hex: 0x2B7FFF).opacity(0.75), at: CGPoint(x: 0.62, y: 0.58), size: size, scale: (0.8, 1.1))
                    glow(Color.white.opacity(0.7), at: CGPoint(x: 0.62, y: 0.58), size: size, scale: (0.25, 0.35))
                }
            }
            .frame(width: size.width, height: size.height)
            .clipped()
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    /// A soft elliptical light, as the stylesheets' `radial-gradient(ellipse …)`.
    private func glow(_ color: Color, at point: CGPoint, size: CGSize, scale: (CGFloat, CGFloat)) -> some View {
        let w = max(size.width * scale.0, 1), h = max(size.height * scale.1, 1)
        return Ellipse()
            .fill(RadialGradient(colors: [color, color.opacity(0)], center: .center, startRadius: 0, endRadius: max(w, h) / 2))
            .frame(width: w, height: h)
            .position(x: size.width * point.x, y: size.height * point.y)
    }
}

// MARK: - The title bar

struct RetroTitleBar: View {
    let edition: RetroEdition
    let title: String
    /// Room on the leading side for the iPad's own window buttons.
    var leadingInset: CGFloat = 0

    var body: some View {
        let shape = UnevenRoundedRectangle(topLeadingRadius: edition.cornerRadius, topTrailingRadius: edition.cornerRadius, style: .continuous)
        HStack(spacing: edition == .classic ? 3 : 6) {
            if leadingInset > 0 { Color.clear.frame(width: leadingInset) }
            if centred { Spacer(minLength: 0) }
            if edition != .win8, edition != .win81 {
                PulsatrixLogoMark(size: edition == .classic ? 14 : 16)
                    .environment(\.colorScheme, darkInk ? .light : .dark)
                    .accessibilityHidden(true)
            }
            Text(verbatim: title)
                .font(titleFont)
                .foregroundStyle(ink)
                .shadow(color: textShadow, radius: glows ? 4 : 0, x: glows ? 0 : 1, y: glows ? 0 : 1)
                .shadow(color: glows ? .white : .clear, radius: 2)
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer(minLength: 0)
            RetroCaption(edition: edition)
                .frame(maxHeight: .infinity, alignment: hangs ? .top : .center)
        }
        .padding(.leading, leadingPad)
        .padding(.trailing, trailingPad)
        .frame(height: edition.titleHeight)
        .frame(maxWidth: .infinity)
        .background { background.clipShape(shape) }
        .overlay { highlight.clipShape(shape).allowsHitTesting(false) }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: title))
        .accessibilityAddTraits(.isHeader)
        .accessibilityIdentifier("retro.titlebar")
    }

    /// 8 and 8.1 centre the title, the others put it after the icon.
    private var centred: Bool { edition == .win8 || edition == .win81 }
    /// Vista's and 7's boxes hang from the top edge.
    private var hangs: Bool { edition == .vista || edition == .win7 }
    /// 7's dark title sits in a white glow (win7.css), not a drop shadow.
    private var glows: Bool { edition == .win7 }
    /// Dark text on a light bar (8, 10, 11).
    private var darkInk: Bool { edition == .win8 || edition == .win10 || edition == .win11 }

    private var leadingPad: CGFloat {
        switch edition {
        case .classic: 3
        case .xp: 7
        case .win11: 12
        default: 8
        }
    }

    private var trailingPad: CGFloat {
        switch edition {
        case .classic: 2
        case .xp: 5
        case .vista, .win7: 6
        default: 0
        }
    }

    private var ink: Color {
        switch edition {
        case .win7, .win8, .win10: .black
        case .win11: Color(hex: 0x1A1A1A)
        default: .white
        }
    }

    private var textShadow: Color {
        switch edition {
        case .xp: Color(hex: 0x0A1883)
        case .vista: Color.black.opacity(0.35)
        case .win7: .white
        default: .clear
        }
    }

    private var titleFont: Font {
        switch edition {
        case .classic: .custom("Verdana-Bold", fixedSize: 11)
        case .xp: .custom("TrebuchetMS-Bold", fixedSize: 13)
        case .vista, .win7: .system(size: 12.5)
        case .win8: .system(size: 13)
        case .win81, .win10, .win11: .system(size: 12)
        }
    }

    @ViewBuilder private var background: some View {
        switch edition {
        case .classic:
            LinearGradient(colors: [Color(hex: 0x000080), Color(hex: 0x1084D0)], startPoint: .leading, endPoint: .trailing)
        case .xp:
            LinearGradient(stops: [
                .init(color: Color(hex: 0x0A5FE8), location: 0), .init(color: Color(hex: 0x3D8DFB), location: 0.07),
                .init(color: Color(hex: 0x0A5FE8), location: 0.16), .init(color: Color(hex: 0x0450DD), location: 0.45),
                .init(color: Color(hex: 0x0659F0), location: 0.82), .init(color: Color(hex: 0x0A63FB), location: 0.9),
                .init(color: Color(hex: 0x0748C9), location: 0.96), .init(color: Color(hex: 0x04359F), location: 1),
            ], startPoint: .top, endPoint: .bottom)
        case .vista, .win7:
            // Aero: the wallpaper seen through a real blur, then the glass's tint and reflections
            ZStack {
                RetroWallpaper(edition: edition)
                Rectangle().fill(.ultraThinMaterial)
                LinearGradient(
                    colors: edition == .vista
                        ? [Color(red: 30 / 255, green: 48 / 255, blue: 60 / 255).opacity(0.62), Color(red: 10 / 255, green: 20 / 255, blue: 28 / 255).opacity(0.74)]
                        : [Color(red: 178 / 255, green: 206 / 255, blue: 236 / 255).opacity(0.62), Color(red: 138 / 255, green: 176 / 255, blue: 222 / 255).opacity(0.72)],
                    startPoint: .top, endPoint: .bottom
                )
                LinearGradient(stops: [
                    .init(color: .white.opacity(edition == .vista ? 0.2 : 0.42), location: 0),
                    .init(color: .white.opacity(edition == .vista ? 0.07 : 0.14), location: 0.46),
                    .init(color: .white.opacity(0), location: 0.47),
                ], startPoint: .top, endPoint: .bottom)
                LinearGradient(stops: [
                    .init(color: .clear, location: 0.18), .init(color: .white.opacity(edition == .vista ? 0.08 : 0.16), location: 0.22),
                    .init(color: .clear, location: 0.3), .init(color: .clear, location: 0.58),
                    .init(color: .white.opacity(edition == .vista ? 0.06 : 0.12), location: 0.63), .init(color: .clear, location: 0.71),
                ], startPoint: .leading, endPoint: .trailing)
            }
        case .win8:
            Color(hex: 0x00ABA9)
        case .win81:
            Color(hex: 0x5B5FC7)
        case .win10:
            Color.white
        case .win11:
            // Mica: the wallpaper through a frosted light tint
            ZStack {
                RetroWallpaper(edition: .win11)
                Rectangle().fill(.thinMaterial)
                LinearGradient(colors: [Color(red: 232 / 255, green: 239 / 255, blue: 250 / 255).opacity(0.8),
                                        Color(red: 240 / 255, green: 242 / 255, blue: 246 / 255).opacity(0.93)],
                               startPoint: .top, endPoint: .bottom)
            }
        }
    }

    @ViewBuilder private var highlight: some View {
        switch edition {
        case .xp:
            // inset 1px 1px 0 white 35 %, inset -1px 0 0 black 25 %
            ZStack(alignment: .topLeading) {
                VStack(spacing: 0) { Color.white.opacity(0.35).frame(height: 1); Spacer(minLength: 0) }
                HStack(spacing: 0) { Color.white.opacity(0.35).frame(width: 1); Spacer(minLength: 0); Color.black.opacity(0.25).frame(width: 1) }
            }
        case .vista, .win7:
            VStack(spacing: 0) { Color.white.opacity(edition == .vista ? 0.3 : 0.6).frame(height: 1); Spacer(minLength: 0) }
        case .win10:
            VStack(spacing: 0) { Spacer(minLength: 0); Color(hex: 0x0078D7).frame(height: 1) }
        case .win11:
            VStack(spacing: 0) { Spacer(minLength: 0); Color.black.opacity(0.08).frame(height: 1) }
        case .classic, .win8, .win81:
            EmptyView()
        }
    }
}

/// Minimize, maximize and close, drawn in the edition's style (decorative).
struct RetroCaption: View {
    let edition: RetroEdition

    var body: some View {
        HStack(spacing: spacing) {
            box(.minimize)
            box(.maximize)
            box(.close)
                .padding(.leading, edition == .classic ? 2 : edition == .xp ? 2 : 0)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private enum Kind { case minimize, maximize, close }

    private var spacing: CGFloat {
        switch edition {
        case .classic: 0
        case .xp: 2
        case .vista, .win7: -1
        default: 0
        }
    }

    @ViewBuilder private func box(_ kind: Kind) -> some View {
        switch edition {
        case .classic:
            glyph(kind, color: .black, weight: 1.6)
                .frame(width: 16, height: 14)
                .background(Color(hex: 0xC0C0C0))
                .overlay(RetroBevel())
        case .xp:
            let close = kind == .close
            glyph(kind, color: .white, weight: close ? 2.4 : 2.2)
                .frame(width: 21, height: 21)
                .background(
                    RadialGradient(
                        colors: close
                            ? [Color(hex: 0xB2260C), Color(hex: 0xDC4A24), Color(hex: 0xEC7E5D), Color(hex: 0xF6B9A3)]
                            : [Color(hex: 0x0A46D0), Color(hex: 0x2F6AE6), Color(hex: 0x6B98F2), Color(hex: 0xB4CBF7)],
                        center: UnitPoint(x: 0.85, y: 0.85), startRadius: 0, endRadius: 26
                    ),
                    in: RoundedRectangle(cornerRadius: 3, style: .continuous)
                )
                .overlay(RoundedRectangle(cornerRadius: 3, style: .continuous).strokeBorder(Color.white, lineWidth: 1))
        case .vista, .win7:
            let close = kind == .close
            let shape = UnevenRoundedRectangle(bottomLeadingRadius: kind == .minimize ? 4 : 0, bottomTrailingRadius: close ? 4 : 0)
            glyph(kind, color: .white, weight: close ? 2 : 1.6, outline: Color(hex: close ? 0x461008 : 0x182630))
                .frame(width: close ? 44 : 27, height: 19)
                .background(
                    LinearGradient(
                        stops: close
                            ? [.init(color: Color(hex: 0xEEA08D), location: 0), .init(color: Color(hex: 0xD9694F), location: 0.46),
                               .init(color: Color(hex: 0xC2341A), location: 0.5), .init(color: Color(hex: 0xD24B2C), location: 0.76),
                               .init(color: Color(hex: 0xF08A66), location: 1)]
                            : [.init(color: .white.opacity(0.3), location: 0), .init(color: .white.opacity(0.3), location: 0.46),
                               .init(color: .white.opacity(0.06), location: 0.5), .init(color: .white.opacity(0.18), location: 1)],
                        startPoint: .top, endPoint: .bottom
                    ),
                    in: shape
                )
                .overlay(shape.stroke(Color.black.opacity(0.75), lineWidth: 1))
                .overlay(shape.inset(by: 1).stroke(Color.white.opacity(0.3), lineWidth: 1))
                .shadow(color: close ? Color(red: 1, green: 90 / 255, blue: 50 / 255).opacity(0.45) : .clear, radius: 4)
        case .win8, .win81:
            let close = kind == .close
            let ink: Color = edition == .win8 && !close ? .black : .white
            glyph(kind, color: ink, weight: kind == .maximize ? 1 : 2)
                .frame(width: close ? (edition == .win8 ? 45 : 46) : (edition == .win8 ? 26 : 28))
                .frame(maxHeight: .infinity)
                // a shape, not a Color: a Color background would bleed into the status bar
                .background(Rectangle().fill(close ? Color(hex: 0xC75050) : .clear))
        case .win10, .win11:
            glyph(kind, color: edition == .win11 ? Color(hex: 0x1A1A1A) : .black, weight: 1)
                .frame(width: 46)
                .frame(maxHeight: .infinity)
        }
    }

    /// The box's glyph, drawn as the stylesheets' SVGs.
    private func glyph(_ kind: Kind, color: Color, weight: CGFloat, outline: Color? = nil) -> some View {
        let size: CGFloat = edition == .xp ? 11 : edition == .classic ? 8 : 10
        return RetroGlyph(kind: kind == .minimize ? .minimize : kind == .maximize ? .maximize : .close, lineWidth: weight, flatEdition: edition.rawValue.hasPrefix("win"))
            .stroke(color, style: StrokeStyle(lineWidth: weight, lineCap: kind == .close && (edition == .vista || edition == .win7) ? .round : .butt))
            .background(
                outline.map { o in
                    RetroGlyph(kind: kind == .minimize ? .minimize : kind == .maximize ? .maximize : .close, lineWidth: weight, flatEdition: false)
                        .stroke(o, style: StrokeStyle(lineWidth: weight + 1.6, lineCap: .round))
                }
            )
            .frame(width: size, height: size)
    }
}

/// The three caption glyphs as strokes in a unit box.
private struct RetroGlyph: Shape {
    enum Kind { case minimize, maximize, close }
    let kind: Kind
    let lineWidth: CGFloat
    /// 8 to 11: the minimize bar sits mid-height; older eras put it low.
    let flatEdition: Bool

    func path(in rect: CGRect) -> Path {
        var p = Path()
        let w = rect.width, h = rect.height
        switch kind {
        case .minimize:
            let y = flatEdition ? rect.minY + h * 0.6 : rect.maxY - lineWidth / 2
            p.move(to: CGPoint(x: rect.minX, y: y))
            p.addLine(to: CGPoint(x: rect.maxX * 0.75, y: y))
        case .maximize:
            p.addRect(rect.insetBy(dx: 0.5, dy: 0.5))
            // the thick top edge of the older eras
            if !flatEdition {
                p.move(to: CGPoint(x: rect.minX, y: rect.minY + 1))
                p.addLine(to: CGPoint(x: rect.maxX, y: rect.minY + 1))
            }
        case .close:
            p.move(to: CGPoint(x: rect.minX, y: rect.minY))
            p.addLine(to: CGPoint(x: rect.minX + w, y: rect.minY + h))
            p.move(to: CGPoint(x: rect.minX + w, y: rect.minY))
            p.addLine(to: CGPoint(x: rect.minX, y: rect.minY + h))
        }
        return p
    }
}

// MARK: - At the root

/// The window's top: the wallpaper in the status bar, then the title bar,
/// for the whole app (ThemeRoot). Takes no room under any other skin.
struct RetroWindowTop: View {
    let palette: SkinPalette
    @ObservedObject private var openBot = RetroOpenBot.shared

    var body: some View {
        let edition = RetroEdition.of(palette)
        VStack(spacing: 0) {
            if let edition {
                RetroTitleBar(
                    edition: edition,
                    title: openBot.name.map { "Sagax - \($0)" } ?? "Sagax",
                    leadingInset: UIDevice.current.userInterfaceIdiom == .pad ? 70 : 0
                )
                .padding(.horizontal, edition.cornerRadius > 0 ? 4 : 0)
                .background(alignment: .bottom) {
                    // the window frame's top edge under the rounded corners
                    if edition.cornerRadius > 0 { RetroWallpaper(edition: edition) }
                }
            }
        }
        .frame(maxWidth: .infinity)
        .background(alignment: .bottom) {
            if let edition {
                RetroWallpaper(edition: edition).ignoresSafeArea(edges: .top)
            }
        }
    }
}

/// The open bot's name for the title bar ("Sagax - Nova", as the desktop's).
@MainActor
final class RetroOpenBot: ObservableObject {
    static let shared = RetroOpenBot()
    @Published private(set) var name: String?

    func set(_ name: String?) {
        if self.name != name { self.name = name }
    }

    /// The bot's chat left the screen (only when it was the one shown).
    func clear(_ name: String?) {
        if self.name == name { self.name = nil }
    }
}
