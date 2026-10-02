// Design tokens and building blocks for the visual-parity pass.
//
// Every value here comes from the measured references
// (docs/superpowers/specs/assets/ios-visual-parity/measure-*.md), in points.
// The odd sizes (11.5, 12.5, 13.5) are measured, not typos: the reference
// runs below the HIG sizes and Dynamic Type styles would not match it.
//
// Screens are not restyled here. This file only provides the parts the later
// phases assemble: glass circles and capsules, grouped cards and rows,
// section labels and footers, the role chip, the card sheet container and
// the top scroll-edge fade. `ThemeGalleryView` (DEBUG) shows them together.
import SwiftUI

// MARK: - Colour

extension Color {
    /// `Color(hex: 0x141414)`: an opaque sRGB colour from a 24-bit literal.
    init(hex: UInt32, opacity: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: opacity
        )
    }
}

enum Theme {
    // MARK: Surfaces
    static let bg = Color(hex: 0x141414)
    /// The computer view draws on pure black.
    static let bgComputer = Color(hex: 0x000000)
    /// The "Dim" appearance: a lifted dark grey instead of near-black.
    static let bgDim = Color(hex: 0x1C1C1E)
    static let card = Color(hex: 0x202020)
    static let hairline = Color(hex: 0x313131)
    static let tabHairline = Color(hex: 0x262626)
    /// Glass control fill: about 13% white over `bg`.
    static let glassFill = Color(hex: 0x333333)
    static let glassRimLight = Color(hex: 0x7A7A7A)
    static let glassRimDark = Color(hex: 0x060606)
    static let chip = Color(hex: 0x252527)
    static let pill = Color(hex: 0x2B2B2D)
    static let pillBorder = Color(hex: 0x363537)
    /// Behind a card sheet the home is dimmed with black at 50%.
    static let dim = Color.black.opacity(0.5)
    /// A disabled light capsule ("Next", "Create"): about 57% white glass.
    static let disabledCapsule = Color(hex: 0x999999)
    static let disabledCapsuleText = Color(hex: 0x2D2D2D)

    // MARK: Text
    static let textPrimary = Color.white
    static let textSecondary = Color(hex: 0x9C9BA1)
    /// Home previews, headers and pinned labels read a touch darker.
    static let textSecondaryHome = Color(hex: 0x97969D)
    static let textTertiary = Color(hex: 0x575659)
    static let textDisabled = Color(hex: 0x5F5E62)
    static let placeholder = Color(hex: 0x6B6A6C)
    static let chevron = Color(hex: 0x6B6A6D)
    static let iconGrey = Color(hex: 0x9B9BA1)
    static let chipText = Color(hex: 0x9E9EA4)
    static let addedText = Color(hex: 0x818183)

    // MARK: Accents
    static let toggleOn = Color(hex: 0x68CE67)
    static let blue = Color(hex: 0x2D6DE7)
    static let unreadDot = Color(hex: 0x2D6BE3)
    static let caret = Color(hex: 0x4C69EA)
    /// Destructive rows in settings cards.
    static let destructive = Color(hex: 0xF49A96)
    /// Destructive items in glass menus.
    static let destructiveMenu = Color(hex: 0xFF7876)
    static let routineActive = Color(hex: 0x5DA16B)
    static let routinePaused = Color(hex: 0xD65555)
    static let selectionRing = Color(hex: 0x545356)

    // MARK: Chat (measure-chat-profile.md §1)
    /// The assistant bubble is a card: #202020, no tail.
    static let bubbleAssistant = Color(hex: 0x202020)
    /// Your own words: one step lighter than the assistant card, same family.
    static let bubbleUser = Color(hex: 0x2E2E30)
    /// "Today 4:53 PM" between stretches of conversation.
    static let chatTimestamp = Color(hex: 0x555557)
    /// The 5 pt list dot inside a bubble.
    static let bulletDot = Color(hex: 0x5F5E61)
    /// The composer's placeholder and its mic glyph.
    static let composerPlaceholder = Color(hex: 0x6B6B6E)
    static let composerMic = Color(hex: 0xA3A2AA)

    // MARK: Type (SF Pro at the measured sizes; no Dynamic Type)
    enum Font {
        /// Chat bubble, profile rows, composer: 14 regular, 18.1 line pitch.
        static let body = SwiftUI.Font.system(size: 14)
        static let bodyMedium = SwiftUI.Font.system(size: 14, weight: .medium)
        /// Settings rows.
        static let rowTitle = SwiftUI.Font.system(size: 13.5)
        static let headerTitle = SwiftUI.Font.system(size: 13.5, weight: .medium)
        static let buttonLabel = SwiftUI.Font.system(size: 13.5, weight: .semibold)
        /// Settings subtitles, section labels and footers.
        static let label = SwiftUI.Font.system(size: 11)
        static let labelMedium = SwiftUI.Font.system(size: 11, weight: .medium)
        /// Profile section labels, footers and two-line subtitles.
        static let profileLabel = SwiftUI.Font.system(size: 12)
        static let roleChip = SwiftUI.Font.system(size: 12, weight: .medium)
        static let time = SwiftUI.Font.system(size: 11.5)
        static let preview = SwiftUI.Font.system(size: 12.5)
        static let tab = SwiftUI.Font.system(size: 13)
        static let profileName = SwiftUI.Font.system(size: 18, weight: .semibold)
        static let code = SwiftUI.Font.system(size: 12, design: .monospaced)
        static let timestamp = SwiftUI.Font.system(size: 11)
        static let appName = SwiftUI.Font.system(size: 17)
    }

    /// Body text renders at a 16.7 pt natural line; the reference pitch is 18.1.
    static let bodyLineSpacing: CGFloat = 1.4

    // MARK: Geometry
    enum Metric {
        static let screenEdge: CGFloat = 18
        static let controlGap: CGFloat = 8
        static let glassLarge: CGFloat = 44
        static let glassSheet: CGFloat = 42
        static let glassSmall: CGFloat = 38
        static let cardRadius: CGFloat = 16
        static let bubbleRadius: CGFloat = 20
        static let rowInset: CGFloat = 17.5
        static let rowHeight: CGFloat = 44.5
        static let toggleRowHeight: CGFloat = 53.67
        static let subtitleRowHeight: CGFloat = 61
        static let cardGap: CGFloat = 27
        static let sheetInset: CGFloat = 8
        /// Circle fits are 37/50; continuous corners render about 12% rounder.
        static let sheetTopRadius: CGFloat = 33
        static let sheetBottomRadius: CGFloat = 44
        static let chipHeight: CGFloat = 19
        static let chipRadius: CGFloat = 6.3
        static let menuRadius: CGFloat = 28
        /// The top scroll-edge fade runs over the header height.
        static let scrollEdgeHeight: CGFloat = 80
    }

    /// The chat screen (02), in points.
    enum Chat {
        /// Assistant bubble: x 16 to 349 on a 402 pt screen.
        static let bubbleLeading: CGFloat = 16
        /// The far side keeps 53 pt free: 16 pt margin plus this spacer.
        static let bubbleTrailingGap: CGFloat = 37
        static let bubblePaddingH: CGFloat = 14
        static let bubblePaddingV: CGFloat = 10
        /// Extra space between paragraphs and list items.
        static let paragraphSpacing: CGFloat = 9.21
        /// Bullet: 5 pt dot 5 pt in from the text column, text at +26.
        static let bulletDot: CGFloat = 5
        static let bulletDotInset: CGFloat = 5
        static let bulletIndent: CGFloat = 26
        /// Name capsule: 12 pt leading, 24 pt mascot, 10 pt gap, 15 pt trailing.
        static let capsuleMascot: CGFloat = 24
        /// Composer row: 29.3 pt from the screen edges, 30 pt above the bottom.
        static let composerInset: CGFloat = 29.3
        /// The "+" circle starts at x 29.7.
        static let composerLeading: CGFloat = 29.7
        static let composerBottom: CGFloat = 30
        static let composerGap: CGFloat = 9.6
        /// The white voice / send capsule inside the field.
        static let voiceCapsule = CGSize(width: 36, height: 28)
        /// The fade under the top bar ends here (screen y).
        static let edgeFadeEnd: CGFloat = 130
    }

    /// Circle-fit radii from the measurements, converted to `.continuous`.
    static func continuous(_ fitted: CGFloat) -> CGFloat { fitted * 0.88 }
}

// MARK: - Preferences

/// Settings > App > Appearance. Stored per device.
enum AppearanceMode: String, CaseIterable, Identifiable {
    case system, dark
    var id: String { rawValue }
    var label: LocalizedStringKey { self == .system ? "System" : "Dark" }
    /// System follows the device; Dark forces dark. Light is a later pass.
    var colorScheme: ColorScheme? { self == .system ? nil : .dark }
}

/// The dark background flavour: near-black or a lifted grey.
enum AppearanceTone: String, CaseIterable, Identifiable {
    case black, dim
    var id: String { rawValue }
    var label: LocalizedStringKey { self == .black ? "Black" : "Dim" }
    var background: Color { self == .black ? Theme.bg : Theme.bgDim }
}

extension PrefKey {
    static let appearanceMode = "companion.prefs.appearanceMode"
    static let appearanceTone = "companion.prefs.appearanceTone"
    /// On by default; read by `Haptics` before every generator fires.
    static let haptics = "companion.prefs.haptics"
}

// MARK: - Glass

/// The measured glass: a #333333 body, a bright 1 px rim top and bottom and a
/// dark hairline at the sides. On iOS 26 the system Liquid Glass supplies
/// refraction and the rim; the fill under it is tinted so the flat centre
/// reads #333333 over the dark background, as in the references.
struct ThemeGlass<S: InsettableShape>: ViewModifier {
    let shape: S
    var fill: Color = Theme.glassFill
    var interactive: Bool = true

    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content
                .background(fill.opacity(0.92), in: shape)
                .glassEffect(interactive ? .clear.interactive() : .clear, in: shape)
        } else {
            content
                .background(fill, in: shape)
                .overlay(ThemeGlassRim(shape: shape))
        }
    }
}

/// The fallback rim: light at the top and bottom edges, dark at the sides.
struct ThemeGlassRim<S: InsettableShape>: View {
    let shape: S

    var body: some View {
        ZStack {
            shape.strokeBorder(
                LinearGradient(
                    stops: [
                        .init(color: Theme.glassRimLight, location: 0),
                        .init(color: Theme.glassRimLight.opacity(0), location: 0.1),
                        .init(color: Theme.glassRimLight.opacity(0), location: 0.9),
                        .init(color: Theme.glassRimLight, location: 1),
                    ],
                    startPoint: .top, endPoint: .bottom
                ),
                lineWidth: 1
            )
            shape.strokeBorder(
                LinearGradient(
                    stops: [
                        .init(color: Theme.glassRimDark, location: 0),
                        .init(color: Theme.glassRimDark.opacity(0), location: 0.12),
                        .init(color: Theme.glassRimDark.opacity(0), location: 0.88),
                        .init(color: Theme.glassRimDark, location: 1),
                    ],
                    startPoint: .leading, endPoint: .trailing
                ),
                lineWidth: 0.5
            )
        }
        .allowsHitTesting(false)
    }
}

extension View {
    func themeGlass<S: InsettableShape>(_ shape: S, fill: Color = Theme.glassFill, interactive: Bool = true) -> some View {
        modifier(ThemeGlass(shape: shape, fill: fill, interactive: interactive))
    }
}

/// A round glass button: 44 pt on screens, 42 in sheets, 38 on the computer.
struct GlassCircleButton: View {
    enum Size: CGFloat {
        case large = 44, sheet = 42, small = 38
        /// Glyphs are 17 to 20 pt medium in the references.
        var glyph: CGFloat {
            switch self {
            case .large: 19
            case .sheet: 17
            case .small: 16
            }
        }
    }

    let systemImage: String
    var size: Size = .large
    var fill: Color = Theme.glassFill
    var accessibilityLabel: LocalizedStringKey?
    /// A measured glyph size and optical offset, when a screen's reference
    /// differs from the size default.
    var glyphSize: CGFloat?
    var glyphOffset: CGSize = .zero
    let action: () -> Void

    var body: some View {
        Button {
            Haptics.selection()
            action()
        } label: {
            Image(systemName: systemImage)
                .font(.system(size: glyphSize ?? size.glyph, weight: .medium))
                .foregroundStyle(Theme.textPrimary)
                .offset(glyphOffset)
                .frame(width: size.rawValue, height: size.rawValue)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .themeGlass(Circle(), fill: fill)
        .accessibilityLabel(accessibilityLabel.map { Text($0) } ?? Text(systemImage))
    }
}

/// A glass capsule holding arbitrary content (name pill, search field,
/// "N installed"). Height defaults to the 44 pt control height.
struct GlassCapsule<Content: View>: View {
    var height: CGFloat = Theme.Metric.glassLarge
    var horizontalPadding: CGFloat = 14
    var fill: Color = Theme.glassFill
    @ViewBuilder let content: () -> Content

    var body: some View {
        HStack(spacing: 10, content: content)
            .padding(.horizontal, horizontalPadding)
            .frame(height: height)
            .themeGlass(Capsule(), fill: fill)
    }
}

/// The light capsule action ("Next", "Create"): grey glass while disabled.
struct CapsuleActionButton: View {
    let title: LocalizedStringKey
    var enabled: Bool
    var height: CGFloat = 44
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(Theme.Font.buttonLabel)
                .foregroundStyle(enabled ? Color.black : Theme.disabledCapsuleText)
                .padding(.horizontal, 14)
                .frame(maxWidth: .infinity)
                .frame(height: height)
                .background(enabled ? Color.white : Theme.disabledCapsule, in: Capsule())
                .overlay(Capsule().strokeBorder(Color.white.opacity(0.35), lineWidth: 0.5))
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
    }
}

// MARK: - Cards

/// A grouped card: #202020, radius 16, rows separated by a hairline inset to
/// the text column.
struct CardSection<Content: View>: View {
    var horizontalMargin: CGFloat = 23.17
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(spacing: 0, content: content)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.Metric.cardRadius, style: .continuous))
            .clipShape(RoundedRectangle(cornerRadius: Theme.Metric.cardRadius, style: .continuous))
            .padding(.horizontal, horizontalMargin)
    }
}

/// The 1 pt divider between rows: from the text column to the trailing edge.
struct CardHairline: View {
    var leadingInset: CGFloat = Theme.Metric.rowInset

    var body: some View {
        Rectangle()
            .fill(Theme.hairline)
            .frame(height: 1)
            .padding(.leading, leadingInset)
    }
}

/// One row of a card. The accessory decides the trailing side; the style
/// decides the title colour.
struct CardRow: View {
    enum Accessory {
        case none
        case chevron
        case value(String)
        case valueChevron(String)
        case toggle(Binding<Bool>)
        case check
    }

    enum Style { case normal, destructive, action }

    let title: LocalizedStringKey
    var subtitle: LocalizedStringKey?
    var systemImage: String?
    var accessory: Accessory = .none
    var style: Style = .normal
    var action: (() -> Void)?

    private var titleColor: Color {
        switch style {
        case .normal: Theme.textPrimary
        case .destructive: Theme.destructive
        case .action: Theme.blue
        }
    }

    private var iconColor: Color {
        switch style {
        case .normal: Theme.iconGrey
        case .destructive: Theme.destructive
        case .action: Theme.blue
        }
    }

    private var minHeight: CGFloat {
        if subtitle != nil { return Theme.Metric.subtitleRowHeight }
        if case .toggle = accessory { return Theme.Metric.toggleRowHeight }
        return Theme.Metric.rowHeight
    }

    var body: some View {
        let row = HStack(alignment: subtitle == nil ? .center : .top, spacing: 0) {
            if let systemImage {
                Image(systemName: systemImage)
                    .font(.system(size: 15))
                    .foregroundStyle(iconColor)
                    .frame(width: 18)
                    .padding(.trailing, 9.3)
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(Theme.Font.rowTitle)
                    .foregroundStyle(titleColor)
                if let subtitle {
                    Text(subtitle)
                        .font(Theme.Font.label)
                        .foregroundStyle(Theme.textSecondary)
                        .lineSpacing(1)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 12)
            trailing
        }
        .padding(.leading, Theme.Metric.rowInset)
        .padding(.trailing, 17.2)
        .padding(.vertical, subtitle == nil ? 0 : 14)
        .frame(minHeight: minHeight)
        .contentShape(Rectangle())

        if let action {
            Button {
                Haptics.selection()
                action()
            } label: { row }
            .buttonStyle(.plain)
        } else {
            row
        }
    }

    @ViewBuilder private var trailing: some View {
        switch accessory {
        case .none:
            EmptyView()
        case .chevron:
            chevron
        case let .value(text):
            Text(text).font(Theme.Font.rowTitle).foregroundStyle(Theme.textSecondary)
        case let .valueChevron(text):
            HStack(spacing: 15) {
                Text(text).font(Theme.Font.rowTitle).foregroundStyle(Theme.textSecondary)
                chevron
            }
        case let .toggle(binding):
            Toggle("", isOn: binding)
                .labelsHidden()
                .toggleStyle(ParityToggleStyle())
        case .check:
            Image(systemName: "checkmark")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(Theme.textPrimary)
        }
    }

    private var chevron: some View {
        Image(systemName: "chevron.right")
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(Theme.chevron)
            .padding(.trailing, 4)
    }
}

/// The iOS 26 switch as measured: 60x27 track, white pill knob 35x23.
struct ParityToggleStyle: ToggleStyle {
    var width: CGFloat = 60.33
    var height: CGFloat = 26.67

    func makeBody(configuration: Configuration) -> some View {
        let knobWidth = width * 0.586
        let knobHeight = height - 4
        Button {
            Haptics.selection()
            withAnimation(.easeOut(duration: 0.22)) { configuration.isOn.toggle() }
        } label: {
            ZStack(alignment: configuration.isOn ? .trailing : .leading) {
                Capsule().fill(configuration.isOn ? Theme.toggleOn : Color(hex: 0x39393D))
                Capsule()
                    .fill(Color.white)
                    .frame(width: knobWidth, height: knobHeight)
                    .padding(2)
            }
            .frame(width: width, height: height)
        }
        .buttonStyle(.plain)
        .accessibilityValue(configuration.isOn ? Text("On") : Text("Off"))
    }
}

/// "Bot", "Switch Account": grey 11 pt above a card.
struct SectionLabel: View {
    let text: LocalizedStringKey
    var leading: CGFloat = 41.67

    var body: some View {
        Text(text)
            .font(Theme.Font.label)
            .foregroundStyle(Theme.textTertiary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.leading, leading)
            .padding(.bottom, 7)
    }
}

/// The grey explanation under a card.
struct Footer: View {
    let text: LocalizedStringKey
    var leading: CGFloat = 41.67

    var body: some View {
        Text(text)
            .font(Theme.Font.label)
            .foregroundStyle(Theme.textTertiary)
            .lineSpacing(2)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.leading, leading)
            .padding(.trailing, 40)
            .padding(.top, 7)
    }
}

/// The role beside a name: 19 pt high, radius 6.3, not a capsule.
struct RoleChip: View {
    let text: String

    var body: some View {
        Text(text)
            .font(Theme.Font.roleChip)
            .foregroundStyle(Theme.chipText)
            .lineLimit(1)
            .padding(.horizontal, 6.7)
            .frame(height: Theme.Metric.chipHeight)
            .background(Theme.chip, in: RoundedRectangle(cornerRadius: Theme.Metric.chipRadius, style: .continuous))
    }
}

// MARK: - Card sheet

/// The floating card sheet (Settings, Create bot): inset 8 pt from the
/// screen, about 37 pt top and 50 pt bottom corners, over the home dimmed by
/// black at 50%. The home is not scaled or blurred.
struct CardSheetContainer<Content: View>: View {
    var topOffset: CGFloat = 123.67
    var background: Color = Theme.bg
    let onDismiss: () -> Void
    @ViewBuilder let content: () -> Content

    var body: some View {
        ZStack(alignment: .top) {
            Theme.dim
                .ignoresSafeArea()
                .onTapGesture(perform: onDismiss)
            content()
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                .background(background)
                .clipShape(CardSheetShape(
                    topRadius: Theme.Metric.sheetTopRadius,
                    bottomRadius: Theme.Metric.sheetBottomRadius
                ))
                .padding(.horizontal, Theme.Metric.sheetInset)
                .padding(.top, topOffset)
                .padding(.bottom, Theme.Metric.sheetInset)
                .ignoresSafeArea()
        }
    }
}

/// Different radii at the top and bottom, continuous at every corner.
struct CardSheetShape: Shape {
    var topRadius: CGFloat
    var bottomRadius: CGFloat

    func path(in rect: CGRect) -> Path {
        if #available(iOS 17.0, *) {
            return UnevenRoundedRectangle(
                topLeadingRadius: topRadius,
                bottomLeadingRadius: bottomRadius,
                bottomTrailingRadius: bottomRadius,
                topTrailingRadius: topRadius,
                style: .continuous
            ).path(in: rect)
        }
        return RoundedRectangle(cornerRadius: topRadius, style: .continuous).path(in: rect)
    }
}

// MARK: - Scroll edge

/// Content scrolled under a header fades into the background over about the
/// header height. On iOS 26 the system soft edge effect is used as well.
struct TopScrollEdgeFade: ViewModifier {
    var height: CGFloat = Theme.Metric.scrollEdgeHeight
    var background: Color = Theme.bg

    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content
                .scrollEdgeEffectStyle(.soft, for: .top)
                .overlay(alignment: .top) { fade }
        } else {
            content.overlay(alignment: .top) { fade }
        }
    }

    private var fade: some View {
        LinearGradient(
            stops: [
                .init(color: background, location: 0),
                .init(color: background.opacity(0.82), location: 0.23),
                .init(color: background.opacity(0.64), location: 0.58),
                .init(color: background.opacity(0.18), location: 0.96),
                .init(color: background.opacity(0), location: 1),
            ],
            startPoint: .top, endPoint: .bottom
        )
        .frame(height: height)
        .ignoresSafeArea(edges: .top)
        .allowsHitTesting(false)
    }
}

extension View {
    func topScrollEdgeFade(height: CGFloat = Theme.Metric.scrollEdgeHeight, background: Color = Theme.bg) -> some View {
        modifier(TopScrollEdgeFade(height: height, background: background))
    }
}

// MARK: - Gallery

#if DEBUG
/// Every building block on one screen, for review and for the parity harness
/// (`-parityScreen theme-gallery`).
struct ThemeGalleryView: View {
    @State private var toggleA = true
    @State private var toggleB = false
    @State private var showingSheet = false
    @AppStorage(PrefKey.haptics) private var haptics = true
    @AppStorage(PrefKey.appearanceMode) private var appearance = AppearanceMode.system.rawValue
    @AppStorage(PrefKey.appearanceTone) private var tone = AppearanceTone.black.rawValue

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    HStack(spacing: Theme.Metric.controlGap) {
                        GlassCircleButton(systemImage: "chevron.left") {}
                        Spacer()
                        GlassCircleButton(systemImage: "magnifyingglass") {}
                        GlassCircleButton(systemImage: "plus") {}
                    }
                    .padding(.horizontal, Theme.Metric.screenEdge)

                    HStack(spacing: 12) {
                        GlassCircleButton(systemImage: "xmark", size: .sheet) {}
                        GlassCircleButton(systemImage: "keyboard", size: .small) {}
                        GlassCapsule {
                            Circle().fill(Color.purple).frame(width: 24, height: 24)
                            Text(verbatim: "Ara").font(Theme.Font.bodyMedium).foregroundStyle(.white)
                        }
                    }
                    .padding(.horizontal, Theme.Metric.screenEdge)
                    .padding(.top, 16)

                    HStack(spacing: 8) {
                        Text(verbatim: "Aurora").font(Theme.Font.bodyMedium).foregroundStyle(.white)
                        RoleChip(text: "Finance Manager")
                        Spacer()
                        Text(verbatim: "3:41 PM").font(Theme.Font.time).foregroundStyle(Theme.textTertiary)
                    }
                    .padding(.horizontal, 23)
                    .padding(.vertical, 20)

                    CardSection {
                        CardRow(title: "Usage", accessory: .valueChevron("35%")) {}
                        CardHairline()
                        CardRow(title: "Plugins", subtitle: "Tools and skills for Sagax", accessory: .chevron) {}
                    }
                    .padding(.bottom, Theme.Metric.cardGap)

                    SectionLabel(text: "Bot")
                    CardSection {
                        CardRow(
                            title: "Auto-review",
                            subtitle: "Require approval for risky shell, MCP, and computer actions.",
                            accessory: .toggle($toggleA)
                        )
                        CardHairline()
                        CardRow(title: "Notifications", accessory: .toggle($toggleB))
                        CardHairline()
                        CardRow(title: "Haptics", accessory: .toggle($haptics))
                        CardHairline()
                        CardRow(title: "Time Zone", accessory: .value("America/Toronto"))
                    }
                    Footer(text: "The one computer your Bots share.")
                        .padding(.bottom, Theme.Metric.cardGap)

                    CardSection {
                        CardRow(title: "Update Computer", subtitle: "Rebuilds from the latest image and keeps /workspace.", style: .action) {}
                        CardHairline()
                        CardRow(title: "Delete Account", systemImage: "trash", style: .destructive) {}
                    }
                    .padding(.bottom, Theme.Metric.cardGap)

                    CardSection {
                        CardRow(title: "Appearance", accessory: .valueChevron("\(appearance == "dark" ? "Dark" : "System") · \(tone == "dim" ? "Dim" : "Black")")) {
                            appearance = appearance == AppearanceMode.dark.rawValue ? AppearanceMode.system.rawValue : AppearanceMode.dark.rawValue
                        }
                        CardHairline()
                        CardRow(title: "Show card sheet", accessory: .chevron) { showingSheet = true }
                    }

                    HStack(spacing: 12) {
                        CapsuleActionButton(title: "Next", enabled: false) {}
                        CapsuleActionButton(title: "Create", enabled: true) {}
                    }
                    .padding(.horizontal, 36)
                    .padding(.vertical, 24)
                }
                .padding(.top, 24)
            }
            .topScrollEdgeFade()

            if showingSheet {
                CardSheetContainer(onDismiss: { showingSheet = false }) {
                    VStack(alignment: .leading) {
                        GlassCircleButton(systemImage: "xmark", size: .sheet) { showingSheet = false }
                            .padding(17.33)
                        Spacer()
                    }
                }
            }
        }
        .preferredColorScheme(.dark)
    }
}
#endif
