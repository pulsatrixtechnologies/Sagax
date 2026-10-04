// iPad I5: the pieces the desktop's Settings and Plugins modals are made of
// (src/components/SettingsPrimitives.tsx, SettingsModal.tsx, ApiKeys.tsx,
// PluginsPanel.tsx), at the renderer's metrics read from the DOM dumps
// (ios/parity/desktop/refs/desktop-*-59..79-*.json): the modal frame and
// scrim, the collapsible card, the setting row, the switch, the select, the
// key field and the buttons. Text sits in CSS line boxes (`desktopLine`):
// the face's own line plus half the leading above and below, as Chrome
// centres it.
import SwiftUI
import UIKit
import CompanionCore

// MARK: - Icons

enum DesktopSettingsIcon: String, CaseIterable {
    case user, building2, palette, flaskConical, keyRound, zap, terminal, tabletSmartphone, monitor, coins, mail, archive, users, scrollText, search, x, chevronDown, chevronUp, circleQuestionMark, refreshCw, check, externalLink, download, upload, arrowUpRight, loaderCircle, shield, rotateCcw, triangleAlert, clipboardPaste, plus, circlePower, pencil, trash2, globe, plugZap, plug, circle, circleCheck

    /// Path data in the 24 pt viewBox (lucide-react 0.539, ISC).
    var paths: [String] {
        switch self {
        case .user: ["M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2","M8 7A4 4 0 1 0 16 7A4 4 0 1 0 8 7Z"]
        case .building2: ["M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z","M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2","M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2","M10 6h4","M10 10h4","M10 14h4","M10 18h4"]
        case .palette: ["M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z","M13 6.5A.5 .5 0 1 0 14 6.5A.5 .5 0 1 0 13 6.5Z","M17 10.5A.5 .5 0 1 0 18 10.5A.5 .5 0 1 0 17 10.5Z","M6 12.5A.5 .5 0 1 0 7 12.5A.5 .5 0 1 0 6 12.5Z","M8 7.5A.5 .5 0 1 0 9 7.5A.5 .5 0 1 0 8 7.5Z"]
        case .flaskConical: ["M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2","M6.453 15h11.094","M8.5 2h7"]
        case .keyRound: ["M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z","M16 7.5A.5 .5 0 1 0 17 7.5A.5 .5 0 1 0 16 7.5Z"]
        case .zap: ["M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"]
        case .terminal: ["M12 19h8","m4 17 6-6-6-6"]
        case .tabletSmartphone: ["M5 8H11A2 2 0 0 1 13 10V20A2 2 0 0 1 11 22H5A2 2 0 0 1 3 20V10A2 2 0 0 1 5 8Z","M5 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2h-2.4","M8 18h.01"]
        case .monitor: ["M4 3H20A2 2 0 0 1 22 5V15A2 2 0 0 1 20 17H4A2 2 0 0 1 2 15V5A2 2 0 0 1 4 3Z","M8 21L16 21","M12 17L12 21"]
        case .coins: ["M2 8A6 6 0 1 0 14 8A6 6 0 1 0 2 8Z","M18.09 10.37A6 6 0 1 1 10.34 18","M7 6h1v4","m16.71 13.88.7.71-2.82 2.82"]
        case .mail: ["m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7","M4 4H20A2 2 0 0 1 22 6V18A2 2 0 0 1 20 20H4A2 2 0 0 1 2 18V6A2 2 0 0 1 4 4Z"]
        case .archive: ["M3 3H21A1 1 0 0 1 22 4V7A1 1 0 0 1 21 8H3A1 1 0 0 1 2 7V4A1 1 0 0 1 3 3Z","M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8","M10 12h4"]
        case .users: ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2","M16 3.128a4 4 0 0 1 0 7.744","M22 21v-2a4 4 0 0 0-3-3.87","M5 7A4 4 0 1 0 13 7A4 4 0 1 0 5 7Z"]
        case .scrollText: ["M15 12h-5","M15 8h-5","M19 17V5a2 2 0 0 0-2-2H4","M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"]
        case .search: ["m21 21-4.34-4.34","M3 11A8 8 0 1 0 19 11A8 8 0 1 0 3 11Z"]
        case .x: ["M18 6 6 18","m6 6 12 12"]
        case .chevronDown: ["m6 9 6 6 6-6"]
        case .chevronUp: ["m18 15-6-6-6 6"]
        case .circleQuestionMark: ["M2 12A10 10 0 1 0 22 12A10 10 0 1 0 2 12Z","M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3","M12 17h.01"]
        case .refreshCw: ["M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8","M21 3v5h-5","M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16","M8 16H3v5"]
        case .check: ["M20 6 9 17l-5-5"]
        case .externalLink: ["M15 3h6v6","M10 14 21 3","M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"]
        case .download: ["M12 15V3","M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4","m7 10 5 5 5-5"]
        case .upload: ["M12 3v12","m17 8-5-5-5 5","M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"]
        case .arrowUpRight: ["M7 7h10v10","M7 17 17 7"]
        case .loaderCircle: ["M21 12a9 9 0 1 1-6.219-8.56"]
        case .shield: ["M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"]
        case .rotateCcw: ["M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8","M3 3v5h5"]
        case .triangleAlert: ["m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3","M12 9v4","M12 17h.01"]
        case .clipboardPaste: ["M11 14h10","M16 4h2a2 2 0 0 1 2 2v1.344","m17 18 4-4-4-4","M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 1.793-1.113","M9 2H15A1 1 0 0 1 16 3V5A1 1 0 0 1 15 6H9A1 1 0 0 1 8 5V3A1 1 0 0 1 9 2Z"]
        case .plus: ["M5 12h14","M12 5v14"]
        case .circlePower: ["M12 7v4","M7.998 9.003a5 5 0 1 0 8-.005","M2 12A10 10 0 1 0 22 12A10 10 0 1 0 2 12Z"]
        case .pencil: ["M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z","m15 5 4 4"]
        case .trash2: ["M10 11v6","M14 11v6","M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6","M3 6h18","M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"]
        case .globe: ["M2 12A10 10 0 1 0 22 12A10 10 0 1 0 2 12Z","M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20","M2 12h20"]
        case .plugZap: ["M6.3 20.3a2.4 2.4 0 0 0 3.4 0L12 18l-6-6-2.3 2.3a2.4 2.4 0 0 0 0 3.4Z","m2 22 3-3","M7.5 13.5 10 11","M10.5 16.5 13 14","m18 3-4 4h6l-4 4"]
        case .plug: ["M12 22v-5","M9 8V2","M15 8V2","M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"]
        case .circle: ["M2 12A10 10 0 1 0 22 12A10 10 0 1 0 2 12Z"]
        case .circleCheck: ["M2 12A10 10 0 1 0 22 12A10 10 0 1 0 2 12Z","m9 12 2 2 4-4"]
        }
    }
}

/// One lucide icon of the Settings and Plugins modals.
struct DesktopSettingsIconView: View {
    let icon: DesktopSettingsIcon
    var size: CGFloat = 16
    var strokeWidth: CGFloat = 2

    var body: some View {
        Canvas { context, canvas in
            let scale = canvas.width / 24
            context.scaleBy(x: scale, y: scale)
            let style = StrokeStyle(lineWidth: strokeWidth, lineCap: .round, lineJoin: .round)
            for d in icon.paths {
                context.stroke(Path(SVGPath.cached(d)), with: .foreground, style: style)
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

// MARK: - Text in CSS line boxes

extension View {
    /// The CSS line box of `size`-point text at `line` points: the leading
    /// split above and below, and between wrapped lines.
    func desktopLine(_ size: CGFloat, _ line: CGFloat, _ theme: DesktopTheme, weight: Font.Weight = .regular) -> some View {
        let font = theme.uiFont(size, weight)
        let natural = font.lineHeight
        let leading = line - natural
        // Chrome lays the line out in whole CSS pixels: ascent and descent
        // rounded, the half leading floored. Its baseline sits up to a point
        // higher than the exact half leading puts SwiftUI's.
        let ascent = font.ascender.rounded()
        let content = ascent + (-font.descender).rounded()
        let chromeBaseline = ((line - content) / 2).rounded(.down) + ascent
        let nudge = chromeBaseline - (leading / 2 + font.ascender)
        return self
            .lineSpacing(max(0, leading))
            .padding(.top, leading / 2 + nudge)
            .padding(.bottom, leading / 2 - nudge)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// Text at a desktop size, weight, colour and line height. Plain strings
/// are laid out by UIKit with Chrome's rules (`DesktopLabel`): a fixed line
/// box and no orphan control, so a paragraph wraps where the desktop's does;
/// a `Text` (formatted, concatenated) is drawn by SwiftUI in the same box.
struct DesktopText: View {
    @Environment(\.desktopTheme) private var theme
    private enum Content { case text(Text), string(String) }
    private let content: Content
    var size: CGFloat = 13
    var weight: Font.Weight = .regular
    var line: CGFloat = 18
    var color: KeyPath<DesktopTheme, Color> = \.ink
    var tracking: CGFloat = 0
    var strikethrough = false

    init(_ text: Text, size: CGFloat = 13, weight: Font.Weight = .regular, line: CGFloat = 18,
         color: KeyPath<DesktopTheme, Color> = \.ink, tracking: CGFloat = 0) {
        content = .text(text)
        self.size = size
        self.weight = weight
        self.line = line
        self.color = color
        self.tracking = tracking
    }

    /// A string-catalog key, in the app's language (`AppStrings`).
    init(_ key: StaticString, size: CGFloat = 13, weight: Font.Weight = .regular, line: CGFloat = 18,
         color: KeyPath<DesktopTheme, Color> = \.ink, tracking: CGFloat = 0, strikethrough: Bool = false) {
        self.init(verbatim: AppStrings.localized("\(key)"), size: size, weight: weight, line: line, color: color,
                  tracking: tracking, strikethrough: strikethrough)
    }

    init(verbatim value: String, size: CGFloat = 13, weight: Font.Weight = .regular, line: CGFloat = 18,
         color: KeyPath<DesktopTheme, Color> = \.ink, tracking: CGFloat = 0, strikethrough: Bool = false) {
        content = .string(value)
        self.size = size
        self.weight = weight
        self.line = line
        self.color = color
        self.tracking = tracking
        self.strikethrough = strikethrough
    }

    var body: some View {
        switch content {
        case let .text(text):
            text
                .font(theme.font(size, weight))
                .tracking(tracking)
                .foregroundStyle(theme[keyPath: color])
                .desktopLine(size, line, theme, weight: weight)
        case let .string(value):
            DesktopLabel(
                text: value, font: theme.uiFont(size, weight), line: line,
                color: UIColor(theme[keyPath: color]), tracking: tracking, strikethrough: strikethrough
            )
        }
    }
}

/// A UILabel in a CSS line box: every line `line` points tall, the
/// baseline where Chrome puts it (ascent and descent rounded to whole CSS
/// pixels, the half leading floored), words wrapped without iOS's orphan
/// control. Sizes itself to the proposed width.
/// Draws every line from the top even when fractional line boxes add up a
/// hair past the bounds (UILabel would drop the last line).
final class DesktopUILabel: UILabel {
    override func drawText(in rect: CGRect) {
        let open = CGRect(x: rect.minX, y: rect.minY, width: rect.width, height: .greatestFiniteMagnitude)
        let needed = super.textRect(forBounds: open, limitedToNumberOfLines: numberOfLines).height
        super.drawText(in: CGRect(x: rect.minX, y: rect.minY, width: rect.width, height: max(rect.height, needed)))
    }
}

struct DesktopLabel: UIViewRepresentable {
    let text: String
    let font: UIFont
    let line: CGFloat
    let color: UIColor
    var tracking: CGFloat = 0
    var strikethrough = false

    func makeUIView(context: Context) -> UILabel {
        let label = DesktopUILabel()
        label.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        label.setContentHuggingPriority(.required, for: .vertical)
        label.adjustsFontForContentSizeCategory = false
        return label
    }

    func updateUIView(_ label: UILabel, context: Context) {
        let limit = context.environment.lineLimit
        label.numberOfLines = limit ?? 0
        label.attributedText = attributed(context.environment.textCase, truncates: limit != nil)
        label.lineBreakMode = limit == nil ? .byWordWrapping : .byTruncatingTail
        label.lineBreakStrategy = []
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView label: UILabel, context: Context) -> CGSize? {
        let width = proposal.width ?? .greatestFiniteMagnitude
        let fitted = label.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
        let lines = max(1, (fitted.height / line).rounded())
        // A wrapped paragraph keeps the whole width: laid out again in the
        // width of its longest line (rounded by UIKit), it could wrap anew.
        let used = lines > 1 && proposal.width != nil ? width : min(ceil(fitted.width) + 1, width)
        return CGSize(width: used, height: lines * line)
    }

    private func attributed(_ textCase: Text.Case?, truncates: Bool) -> NSAttributedString {
        let paragraph = NSMutableParagraphStyle()
        paragraph.minimumLineHeight = line
        paragraph.maximumLineHeight = line
        paragraph.lineBreakStrategy = []
        paragraph.lineBreakMode = truncates ? .byTruncatingTail : .byWordWrapping
        // UIKit puts a tall line's extra room above the glyphs (baseline at
        // line - descent); Chrome's baseline is higher: raise to meet it.
        let ascent = font.ascender.rounded()
        let content = ascent + (-font.descender).rounded()
        let chromeBaseline = ((line - content) / 2).rounded(.down) + ascent
        let uikitBaseline = line + font.descender
        var attributes: [NSAttributedString.Key: Any] = [
            .font: font, .foregroundColor: color, .paragraphStyle: paragraph,
            .baselineOffset: uikitBaseline - chromeBaseline,
        ]
        // an explicit kern of 0 would turn the font's own kerning off
        if tracking != 0 { attributes[.kern] = tracking }
        if strikethrough { attributes[.strikethroughStyle] = NSUnderlineStyle.single.rawValue }
        let shown: String
        switch textCase {
        case .uppercase: shown = text.uppercased()
        case .lowercase: shown = text.lowercased()
        default: shown = text
        }
        return NSAttributedString(string: shown, attributes: attributes)
    }
}

// MARK: - Modal frame

/// The modal geometry (`fixed inset-0 flex items-center justify-center
/// bg-black/50 p-3 sm:p-6`): a box `min(width, 100vw-40)` by
/// `min(700, 100dvh-96)` centred in the window.
enum DesktopModalGeometry {
    static func frame(width: CGFloat, in window: CGSize, height: CGFloat = 700) -> CGRect {
        let w = min(width, window.width - 40)
        let h = min(height, window.height - 96)
        return CGRect(x: ((window.width - w) / 2).rounded(), y: ((window.height - h) / 2).rounded(), width: w, height: h)
    }
}

/// The scrim and the centred box; a click on the scrim closes, as on the
/// desktop (`onMouseDown` on the backdrop), and so does Escape.
struct DesktopModalFrame<Content: View>: View {
    @Environment(\.desktopTheme) private var theme
    let width: CGFloat
    var background: KeyPath<DesktopTheme, Color> = \.app
    let close: () -> Void
    @ViewBuilder let content: () -> Content

    var body: some View {
        GeometryReader { geometry in
            let box = DesktopModalGeometry.frame(width: width, in: geometry.size)
            ZStack(alignment: .topLeading) {
                Color.black.opacity(0.5)
                    .contentShape(Rectangle())
                    .onTapGesture(perform: close)
                    .accessibilityHidden(true)
                content()
                    .padding(1)
                    .frame(width: box.width, height: box.height)
                    .background(theme[keyPath: background])
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .strokeBorder(theme.border, lineWidth: 1)
                    )
                    .offset(x: box.minX, y: box.minY)
            }
        }
        .ignoresSafeArea()
        .background(DesktopEscapeKey(action: close))
    }
}

/// Escape on a hardware keyboard.
struct DesktopEscapeKey: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) { Text("Close") }
            .keyboardShortcut(.escape, modifiers: [])
            .opacity(0)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}

/// The round close button of a modal (`size-8 rounded-full text-ink-tertiary`, X 18).
struct DesktopCloseButton: View {
    @Environment(\.desktopTheme) private var theme
    let label: LocalizedStringKey
    let identifier: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            DesktopSettingsIconView(icon: .x, size: 18)
                .foregroundStyle(theme.inkTertiary)
                .frame(width: 32, height: 32)
                .contentShape(Circle())
        }
        .buttonStyle(DesktopHoverFill(radius: 16))
        .accessibilityLabel(Text(label))
        .accessibilityIdentifier(identifier)
    }
}

/// `hover:bg-*` for a plain button.
struct DesktopHoverFill: ButtonStyle {
    @Environment(\.desktopTheme) private var theme
    var radius: CGFloat = 8
    var fill: KeyPath<DesktopTheme, Color> = \.hover
    @State private var hovering = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(
                (hovering || configuration.isPressed) ? theme[keyPath: fill] : .clear,
                in: RoundedRectangle(cornerRadius: radius, style: .continuous)
            )
            .onHover { hovering = $0 }
    }
}

// MARK: - Cards and rows

/// `Card` (SettingsPrimitives.tsx): a hairline box; collapsible ones have a
/// 42 pt header (title, summary, chevron) and a body under it.
struct DesktopSettingsCard<Content: View>: View {
    @Environment(\.desktopTheme) private var theme
    let title: Text
    var summary: Text? = nil
    var subtitle: Text? = nil
    var identifier: String
    @State private var open: Bool
    @ViewBuilder let content: () -> Content

    init(_ title: Text, summary: Text? = nil, subtitle: Text? = nil, open: Bool = true, identifier: String,
         @ViewBuilder content: @escaping () -> Content) {
        self.title = title
        self.summary = summary
        self.subtitle = subtitle
        self.identifier = identifier
        _open = State(initialValue: open)
        self.content = content
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.easeOut(duration: 0.15)) { open.toggle() }
            } label: {
                HStack(spacing: 12) {
                    DesktopText(title)
                        .layoutPriority(1)
                    Spacer(minLength: 0)
                    if let summary, !open {
                        DesktopText(summary, size: 12.5, color: \.inkSecondary)
                            .lineLimit(1)
                    }
                    DesktopSettingsIconView(icon: open ? .chevronUp : .chevronDown, size: 14)
                        .foregroundStyle(theme.inkSecondary)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .contentShape(Rectangle())
            }
            .buttonStyle(DesktopHoverFill(radius: 14))
            .accessibilityAddTraits(.isHeader)
            .accessibilityValue(open ? Text("Expanded") : Text("Collapsed"))
            .accessibilityIdentifier("settings-card.\(identifier)")
            if open {
                VStack(alignment: .leading, spacing: 0) {
                    if let subtitle {
                        DesktopText(subtitle, color: \.inkSecondary)
                            .padding(.top, -4)
                            .padding(.bottom, 10)
                    }
                    content()
                }
                .padding(.horizontal, 14)
                .padding(.bottom, 12)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(1)
        .desktopHairlineBox()
    }
}

extension View {
    /// `rounded-[14px] border-[0.5px] border-border`.
    func desktopHairlineBox(radius: CGFloat = 14) -> some View {
        modifier(DesktopHairlineBox(radius: radius))
    }
}

struct DesktopHairlineBox: ViewModifier {
    @Environment(\.desktopTheme) private var theme
    let radius: CGFloat

    func body(content: Content) -> some View {
        // `border-[0.5px]` lays out and draws as one CSS pixel in Chrome
        content.overlay(
            RoundedRectangle(cornerRadius: radius, style: .continuous)
                .strokeBorder(theme.border, lineWidth: 1)
        )
    }
}

/// A group of setting rows (`rounded-[14px] border-[0.5px] border-border py-1`).
struct DesktopSettingsGroup<Content: View>: View {
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0, content: content)
            .padding(.vertical, 4)
            .padding(1)
            .frame(maxWidth: .infinity, alignment: .leading)
            .desktopHairlineBox()
    }
}

/// `SettingRow`: title (and its help), subtitle, and the control at the
/// right (`px-3.5 py-2.5`, columns `minmax(0,1fr) auto`, gap 16).
struct DesktopSettingRow<Control: View>: View {
    @Environment(\.desktopTheme) private var theme
    let title: Text
    var subtitle: Text? = nil
    var help: Text? = nil
    @ViewBuilder let control: () -> Control
    @State private var showingHelp = false

    var body: some View {
        HStack(alignment: .center, spacing: 16) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    DesktopText(title)
                    if let help {
                        Button { showingHelp.toggle() } label: {
                            DesktopSettingsIconView(icon: .circleQuestionMark, size: 13)
                                .foregroundStyle(theme.inkSecondary)
                                .frame(width: 20, height: 20)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text("More about this setting"))
                        .popover(isPresented: $showingHelp) {
                            DesktopText(help, size: 12, line: 17, color: \.inkSecondary)
                                .frame(width: 232)
                                .padding(12)
                                .desktopPopoverOnCompact()
                        }
                    }
                }
                // the help button (size-5) makes the title line 20 tall
                .frame(height: help == nil ? 18 : 20)
                if let subtitle {
                    DesktopText(subtitle, color: \.inkSecondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            control()
                .frame(maxWidth: 240, alignment: .trailing)
                .fixedSize()
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
    }
}

// MARK: - Controls

/// `Switch` (h-5 w-11): success fill when on, the 26 by 16 knob.
struct DesktopSwitch: View {
    @Environment(\.desktopTheme) private var theme
    let isOn: Bool
    let label: Text
    var identifier: String = ""
    var disabled = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack(alignment: isOn ? .trailing : .leading) {
                Capsule().fill(isOn ? theme.success : theme.ink.opacity(0.10))
                Capsule().fill(theme.ink)
                    .frame(width: 26, height: 16)
                    .padding(.horizontal, 2)
            }
            .frame(width: 44, height: 20)
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .opacity(disabled ? 0.5 : 1)
        .accessibilityLabel(label)
        .accessibilityValue(isOn ? Text("On") : Text("Off"))
        .accessibilityIdentifier(identifier)
    }
}

/// A `<select>`: the hairline box at the width of its longest option, the
/// current label and the chevron; the options in a menu.
struct DesktopSelect<Value: Hashable>: View {
    @Environment(\.desktopTheme) private var theme
    let options: [(Value, String)]
    let selection: Value
    /// What the box shows when it differs from the selected option's label.
    var shown: String? = nil
    let label: Text
    var identifier: String = ""
    var disabled = false
    let choose: (Value) -> Void

    var body: some View {
        let current = shown ?? options.first { $0.0 == selection }?.1 ?? ""
        let font = theme.uiFont(13)
        let longest = options.map { ($0.1 as NSString).size(withAttributes: [.font: font]).width }.max() ?? 0
        Menu {
            ForEach(options.indices, id: \.self) { index in
                let option = options[index]
                Button {
                    choose(option.0)
                } label: {
                    if option.0 == selection {
                        Label(option.1, systemImage: "checkmark")
                    } else {
                        Text(verbatim: option.1)
                    }
                }
            }
        } label: {
            HStack(spacing: 0) {
                Text(verbatim: current)
                    .font(theme.font(13))
                    .foregroundStyle(theme.ink)
                    .lineLimit(1)
                Spacer(minLength: 4)
                DesktopSettingsIconView(icon: .chevronDown, size: 12, strokeWidth: 2.5)
                    .foregroundStyle(theme.ink)
            }
            .padding(.leading, 11)
            .padding(.trailing, 9)
            .frame(width: min(240, (longest + 36).rounded(.up)), height: 33)
            .background(theme.ink.opacity(0.03), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.border, lineWidth: 1))
            .contentShape(Rectangle())
        }
        .disabled(disabled)
        .opacity(disabled ? 0.5 : 1)
        .accessibilityLabel(label)
        .accessibilityValue(Text(verbatim: current))
        .accessibilityIdentifier(identifier)
    }
}

/// `ui-button` and its relatives.
struct DesktopButtonStyle: ButtonStyle {
    enum Kind { case control, ghost, accent, outline, hover }
    @Environment(\.desktopTheme) private var theme
    @Environment(\.isEnabled) private var enabled
    var kind: Kind = .control
    var size: CGFloat = 13
    var weight: Font.Weight = .regular
    var height: CGFloat = 31.5
    var horizontal: CGFloat = 12
    var radius: CGFloat = 8

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(theme.font(size, weight))
            .foregroundStyle(foreground)
            .padding(.horizontal, horizontal)
            .frame(height: height)
            .background(background(pressed: configuration.isPressed), in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay {
                if kind == .outline {
                    RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(theme.border, lineWidth: 1)
                }
            }
            .opacity(enabled ? 1 : 0.4)
            .contentShape(Rectangle())
    }

    private var foreground: Color {
        switch kind {
        case .accent: theme.accentInk
        case .ghost: theme.inkSecondary
        default: theme.ink
        }
    }

    private func background(pressed: Bool) -> Color {
        switch kind {
        case .control: pressed ? theme.raised : theme.control
        case .accent: pressed ? theme.accent.opacity(0.85) : theme.accent
        case .hover: theme.hover
        case .ghost, .outline: pressed ? theme.hover : .clear
        }
    }
}

/// A write-only key field (`ApiKeyRow`): status dot, label, the Optional
/// badge, help, and a secure field that saves on submit. The saved key is
/// never read back: the field shows its placeholder or "Saved".
struct DesktopKeyField: View {
    @Environment(\.desktopTheme) private var theme
    let title: Text
    let provider: DesktopAPIKeyProvider
    let configured: Bool
    var help: Text? = nil
    var showsHeader = true
    let save: (String) async -> String?
    @State private var draft = ""
    @State private var saving = false
    @State private var error: String?
    @State private var showingHelp = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if showsHeader {
                HStack(spacing: 8) {
                    Circle().fill(configured ? theme.success : theme.raisedHover).frame(width: 6, height: 6)
                    DesktopText(title, line: 19.5, color: \.inkSecondary)
                    DesktopText(configured ? Text("Saved") : Text("Optional"), size: 10, weight: .medium, line: 15,
                                color: configured ? \.success : \.inkSecondary, tracking: 0.5)
                        .textCase(.uppercase)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(theme.control, in: RoundedRectangle(cornerRadius: 4, style: .continuous))
                    Spacer(minLength: 0)
                    if let help {
                        Button { showingHelp.toggle() } label: {
                            DesktopSettingsIconView(icon: .circleQuestionMark, size: 14)
                                .foregroundStyle(theme.inkSecondary)
                                .frame(width: 24, height: 24)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text("About this key"))
                        .popover(isPresented: $showingHelp) {
                            DesktopText(help, size: 12, line: 17, color: \.inkSecondary)
                                .frame(width: 232)
                                .padding(12)
                                .desktopPopoverOnCompact()
                        }
                    }
                }
                .frame(height: 24)
                .padding(.bottom, 6)
            }
            SecureField(text: $draft, prompt: Text(verbatim: configured ? AppStrings.localized("Saved. Paste a new key to replace it.") : provider.placeholder)
                .foregroundColor(theme.inkSecondary)) {
                title
            }
            .font(theme.font(13))
            .foregroundStyle(theme.ink)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .submitLabel(.done)
            .onSubmit { commit() }
            .disabled(saving)
            .padding(.horizontal, 13)
            .frame(height: 37.5)
            .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline.opacity(0.4), lineWidth: 1))
            .accessibilityIdentifier("settings-key.\(provider.rawValue)")
            if let error {
                DesktopText(verbatim: error, size: 12, line: 17, color: \.danger)
                    .padding(.top, 6)
            }
        }
    }

    private func commit() {
        let key = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !key.isEmpty, !saving else { return }
        saving = true
        Task {
            error = await save(key)
            if error == nil { draft = "" }
            saving = false
        }
    }
}

/// An uppercase pill (`rounded bg-control px-1.5 py-0.5 text-[10px] uppercase`).
struct DesktopBadge: View {
    @Environment(\.desktopTheme) private var theme
    let text: Text
    var color: KeyPath<DesktopTheme, Color> = \.inkSecondary

    var body: some View {
        DesktopText(text, size: 10, weight: .medium, line: 15, color: color, tracking: 0.5)
            .textCase(.uppercase)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(theme.control, in: RoundedRectangle(cornerRadius: 4, style: .continuous))
    }
}

extension View {
    /// Keeps a help popover a popover in a compact window (iOS 16.4+).
    @ViewBuilder
    func desktopPopoverOnCompact() -> some View {
        if #available(iOS 16.4, *) {
            presentationCompactAdaptation(.popover)
        } else {
            self
        }
    }
}

// MARK: - Provider marks (ProviderIcons.tsx)

/// The model providers' official marks, as the desktop draws them. Paths
/// from src/components/ProviderIcons.tsx and CursorMark.tsx (their sources
/// and licences are noted there); a mark drawn in ink follows the skin.
enum DesktopProviderMark: String {
    case claude, codex, grok, cursor, pi, qwen, kimi, opencode, mistral, openrouter

    /// By driver kind, or by the instance's icon preset (`icon.preset`).
    init?(driverKind: String, preset: String?) {
        switch preset ?? "" {
        case "openai": self = .codex; return
        case "anthropic": self = .claude; return
        case "xai": self = .grok; return
        case "qwen": self = .qwen; return
        case "moonshot": self = .kimi; return
        case "mistral": self = .mistral; return
        case "openrouter": self = .openrouter; return
        default: break
        }
        switch driverKind {
        case "claudeAgent": self = .claude
        case "codex": self = .codex
        case "grok", "grokAgent": self = .grok
        case "cursorAgent": self = .cursor
        case "piAgent": self = .pi
        case "qwenAgent": self = .qwen
        case "kimiAgent": self = .kimi
        case "opencodeGo": self = .opencode
        case "mistral": self = .mistral
        default: return nil
        }
    }

    var art: DesktopProviderArt {
        switch self {
        case .claude: DesktopProviderArt(viewBox: CGSize(width: 256, height: 257), paths: [
            ("m50.228 170.321 50.357-28.257.843-2.463-.843-1.361h-2.462l-8.426-.518-28.775-.778-24.952-1.037-24.175-1.296-6.092-1.297L0 125.796l.583-3.759 5.12-3.434 7.324.648 16.202 1.101 24.304 1.685 17.629 1.037 26.118 2.722h4.148l.583-1.685-1.426-1.037-1.101-1.037-25.147-17.045-27.22-18.017-14.258-10.37-7.713-5.25-3.888-4.925-1.685-10.758 7-7.713 9.397.649 2.398.648 9.527 7.323 20.35 15.75L94.817 91.9l3.889 3.24 1.555-1.102.195-.777-1.75-2.917-14.453-26.118-15.425-26.572-6.87-11.018-1.814-6.61c-.648-2.723-1.102-4.991-1.102-7.778l7.972-10.823L71.42 0 82.05 1.426l4.472 3.888 6.61 15.101 10.694 23.786 16.591 32.34 4.861 9.592 2.592 8.879.973 2.722h1.685v-1.556l1.36-18.211 2.528-22.36 2.463-28.776.843-8.1 4.018-9.722 7.971-5.25 6.222 2.981 5.12 7.324-.713 4.73-3.046 19.768-5.962 30.98-3.889 20.739h2.268l2.593-2.593 10.499-13.934 17.628-22.036 7.778-8.749 9.073-9.657 5.833-4.601h11.018l8.1 12.055-3.628 12.443-11.342 14.388-9.398 12.184-13.48 18.147-8.426 14.518.778 1.166 2.01-.194 30.46-6.481 16.462-2.982 19.637-3.37 8.88 4.148.971 4.213-3.5 8.62-20.998 5.184-24.628 4.926-36.682 8.685-.454.324.519.648 16.526 1.555 7.065.389h17.304l32.21 2.398 8.426 5.574 5.055 6.805-.843 5.184-12.962 6.611-17.498-4.148-40.83-9.721-14-3.5h-1.944v1.167l11.666 11.406 21.387 19.314 26.767 24.887 1.36 6.157-3.434 4.86-3.63-.518-23.526-17.693-9.073-7.972-20.545-17.304h-1.36v1.814l4.73 6.935 25.017 37.59 1.296 11.536-1.814 3.76-6.481 2.268-7.13-1.297-14.647-20.544-15.1-23.138-12.185-20.739-1.49.843-7.194 77.448-3.37 3.953-7.778 2.981-6.48-4.925-3.436-7.972 3.435-15.749 4.148-20.544 3.37-16.333 3.046-20.285 1.815-6.74-.13-.454-1.49.194-15.295 20.999-23.267 31.433-18.406 19.702-4.407 1.75-7.648-3.954.713-7.064 4.277-6.286 25.47-32.405 15.36-20.092 9.917-11.6-.065-1.686h-.583L44.07 198.125l-12.055 1.555-5.185-4.86.648-7.972 2.463-2.593 20.35-13.999-.064.065Z", "#d97757", false),
        ])
        case .codex: DesktopProviderArt(viewBox: CGSize(width: 256, height: 260), paths: [
            ("M239.184 106.203a64.716 64.716 0 0 0-5.576-53.103C219.452 28.459 191 15.784 163.213 21.74A65.586 65.586 0 0 0 52.096 45.22a64.716 64.716 0 0 0-43.23 31.36c-14.31 24.602-11.061 55.634 8.033 76.74a64.665 64.665 0 0 0 5.525 53.102c14.174 24.65 42.644 37.324 70.446 31.36a64.72 64.72 0 0 0 48.754 21.744c28.481.025 53.714-18.361 62.414-45.481a64.767 64.767 0 0 0 43.229-31.36c14.137-24.558 10.875-55.423-8.083-76.483Zm-97.56 136.338a48.397 48.397 0 0 1-31.105-11.255l1.535-.87 51.67-29.825a8.595 8.595 0 0 0 4.247-7.367v-72.85l21.845 12.636c.218.111.37.32.409.563v60.367c-.056 26.818-21.783 48.545-48.601 48.601Zm-104.466-44.61a48.345 48.345 0 0 1-5.781-32.589l1.534.921 51.722 29.826a8.339 8.339 0 0 0 8.441 0l63.181-36.425v25.221a.87.87 0 0 1-.358.665l-52.335 30.184c-23.257 13.398-52.97 5.431-66.404-17.803ZM23.549 85.38a48.499 48.499 0 0 1 25.58-21.333v61.39a8.288 8.288 0 0 0 4.195 7.316l62.874 36.272-21.845 12.636a.819.819 0 0 1-.767 0L41.353 151.53c-23.211-13.454-31.171-43.144-17.804-66.405v.256Zm179.466 41.695-63.08-36.63L161.73 77.86a.819.819 0 0 1 .768 0l52.233 30.184a48.6 48.6 0 0 1-7.316 87.635v-61.391a8.544 8.544 0 0 0-4.4-7.213Zm21.742-32.69-1.535-.922-51.619-30.081a8.39 8.39 0 0 0-8.492 0L99.98 99.808V74.587a.716.716 0 0 1 .307-.665l52.233-30.133a48.652 48.652 0 0 1 72.236 50.391v.205ZM88.061 139.097l-21.845-12.585a.87.87 0 0 1-.41-.614V65.685a48.652 48.652 0 0 1 79.757-37.346l-1.535.87-51.67 29.825a8.595 8.595 0 0 0-4.246 7.367l-.051 72.697Zm11.868-25.58 28.138-16.217 28.188 16.218v32.434l-28.086 16.218-28.188-16.218-.052-32.434Z", nil, false),
        ])
        case .grok: DesktopProviderArt(viewBox: CGSize(width: 24, height: 24), paths: [
            ("M9.26905 15.284L17.2479 9.36086C17.6391 9.07047 18.1981 9.18374 18.3845 9.63478C19.3655 12.0135 18.9272 14.8721 16.9755 16.8349C15.0238 18.7976 12.3082 19.228 9.8261 18.2477L7.1146 19.5102C11.0037 22.1834 15.7263 21.5223 18.6774 18.5525C21.0182 16.1985 21.7432 12.9897 21.0653 10.0961L21.0714 10.1023C20.0884 5.85143 21.3131 4.15233 23.8218 0.677913C23.8812 0.595532 23.9406 0.513151 24 0.428711L20.6987 3.74866V3.73836L9.267 15.2861", nil, false),
            ("M7.62249 16.7237C4.83113 14.0422 5.3124 9.89222 7.69417 7.49905C9.45541 5.72786 12.341 5.00497 14.86 6.06768L17.5653 4.81138C17.0779 4.45714 16.4533 4.07613 15.7365 3.80839C12.4966 2.46764 8.6178 3.13492 5.98413 5.78141C3.45081 8.32904 2.65415 12.2463 4.02219 15.5889C5.04412 18.0871 3.36889 19.8541 1.68137 21.6377C1.08337 22.2699 0.483318 22.9022 0 23.5716L7.62045 16.7257", nil, false),
        ])
        case .cursor: DesktopProviderArt(viewBox: CGSize(width: 24, height: 24), paths: [
            ("M4 2.2 20.6 12 12.7 13.9 10.4 21.8z", nil, false),
        ])
        case .pi: DesktopProviderArt(viewBox: CGSize(width: 800, height: 800), paths: [
            ("M165.29 165.29 H517.36 V400 H400 V517.36 H282.65 V634.72 H165.29 Z M282.65 282.65 V400 H400 V282.65 Z", nil, true),
            ("M517.36 400 H634.72 V634.72 H517.36 Z", nil, false),
        ])
        case .qwen: DesktopProviderArt(viewBox: CGSize(width: 24, height: 24), paths: [
            ("M12.604 1.34c.393.69.784 1.382 1.174 2.075a.18.18 0 00.157.091h5.552c.174 0 .322.11.446.327l1.454 2.57c.19.337.24.478.024.837-.26.43-.513.864-.76 1.3l-.367.658c-.106.196-.223.28-.04.512l2.652 4.637c.172.301.111.494-.043.77-.437.785-.882 1.564-1.335 2.34-.159.272-.352.375-.68.37-.777-.016-1.552-.01-2.327.016a.099.099 0 00-.081.05 575.097 575.097 0 01-2.705 4.74c-.169.293-.38.363-.725.364-.997.003-2.002.004-3.017.002a.537.537 0 01-.465-.271l-1.335-2.323a.09.09 0 00-.083-.049H4.982c-.285.03-.553-.001-.805-.092l-1.603-2.77a.543.543 0 01-.002-.54l1.207-2.12a.198.198 0 000-.197 550.951 550.951 0 01-1.875-3.272l-.79-1.395c-.16-.31-.173-.496.095-.965.465-.813.927-1.625 1.387-2.436.132-.234.304-.334.584-.335a338.3 338.3 0 012.589-.001.124.124 0 00.107-.063l2.806-4.895a.488.488 0 01.422-.246c.524-.001 1.053 0 1.583-.006L11.704 1c.341-.003.724.032.9.34zm-3.432.403a.06.06 0 00-.052.03L6.254 6.788a.157.157 0 01-.135.078H3.253c-.056 0-.07.025-.041.074l5.81 10.156c.025.042.013.062-.034.063l-2.795.015a.218.218 0 00-.2.116l-1.32 2.31c-.044.078-.021.118.068.118l5.716.008c.046 0 .08.02.104.061l1.403 2.454c.046.081.092.082.139 0l5.006-8.76.783-1.382a.055.055 0 01.096 0l1.424 2.53a.122.122 0 00.107.062l2.763-.02a.04.04 0 00.035-.02.041.041 0 000-.04l-2.9-5.086a.108.108 0 010-.113l.293-.507 1.12-1.977c.024-.041.012-.062-.035-.062H9.2c-.059 0-.073-.026-.043-.077l1.434-2.505a.107.107 0 000-.114L9.225 1.774a.06.06 0 00-.053-.031zm6.29 8.02c.046 0 .058.02.034.06l-.832 1.465-2.613 4.585a.056.056 0 01-.05.029.058.058 0 01-.05-.029L8.498 9.841c-.02-.034-.01-.052.028-.054l.216-.012 6.722-.012z", nil, false),
        ])
        case .kimi: DesktopProviderArt(viewBox: CGSize(width: 24, height: 24), paths: [
            ("M21.846 0a1.923 1.923 0 110 3.846H20.15a.226.226 0 01-.227-.226V1.923C19.923.861 20.784 0 21.846 0z", "#1783FF", false),
            ("M11.065 11.199l7.257-7.2c.137-.136.06-.41-.116-.41H14.3a.164.164 0 00-.117.051l-7.82 7.756c-.122.12-.302.013-.302-.179V3.82c0-.127-.083-.23-.185-.23H3.186c-.103 0-.186.103-.186.23V19.77c0 .128.083.23.186.23h2.69c.103 0 .186-.102.186-.23v-3.25c0-.069.025-.135.069-.178l2.424-2.406a.158.158 0 01.205-.023l6.484 4.772a7.677 7.677 0 003.453 1.283c.108.012.2-.095.2-.23v-3.06c0-.117-.07-.212-.164-.227a5.028 5.028 0 01-2.027-.807l-5.613-4.064c-.117-.078-.132-.279-.028-.381z", nil, false),
        ])
        case .opencode: DesktopProviderArt(viewBox: CGSize(width: 24, height: 24), paths: [
            ("M16 6H8v12h8V6zm4 16H4V2h16v20z", nil, true),
        ])
        case .mistral: DesktopProviderArt(viewBox: CGSize(width: 24, height: 24), paths: [
            ("M17.143 3.429v3.428h-3.429v3.429h-3.428V6.857H6.857V3.43H3.43v13.714H0v3.428h10.286v-3.428H6.857v-3.429h3.429v3.429h3.429v-3.429h3.428v3.429h-3.428v3.428H24v-3.428h-3.43V3.429z", "#FA520F", false),
        ])
        case .openrouter: DesktopProviderArt(viewBox: CGSize(width: 24, height: 24), paths: [
            ("M16.778 1.844v1.919q-.569-.026-1.138-.032-.708-.008-1.415.037c-1.93.126-4.023.728-6.149 2.237-2.911 2.066-2.731 1.95-4.14 2.75-.792.447-2.497.904-3.936 1.131v4.229c1.31.184 2.908.627 3.795 1.132 1.41.798 1.228.683 4.14 2.75 2.126 1.509 4.22 2.11 6.148 2.236.88.058 1.716.041 2.555.005v1.918L24 15.038l-7.222-4.17v2.176c-.86.038-1.611.065-2.278.021-1.364-.09-2.417-.357-3.979-1.465-2.244-1.593-2.866-2.027-3.68-2.508.889-.518 1.449-.906 3.822-2.59 1.56-1.109 2.614-1.377 3.978-1.466.667-.044 1.418-.017 2.278.02v2.176L24 6.014Z", "#94A3B8", false),
        ])

        }
    }
}

/// One mark: its viewBox and paths (data, fill or nil for ink, even-odd).
struct DesktopProviderArt {
    let viewBox: CGSize
    let paths: [(String, String?, Bool)]
}

struct DesktopProviderMarkView: View {
    @Environment(\.desktopTheme) private var theme
    let mark: DesktopProviderMark
    var size: CGFloat = 28

    var body: some View {
        let art = mark.art
        Canvas { context, canvas in
            let scale = min(canvas.width / art.viewBox.width, canvas.height / art.viewBox.height)
            context.translateBy(x: (canvas.width - art.viewBox.width * scale) / 2, y: (canvas.height - art.viewBox.height * scale) / 2)
            context.scaleBy(x: scale, y: scale)
            for (d, fill, evenOdd) in art.paths {
                let color = fill.flatMap { SkinColor(css: $0)?.color } ?? theme.ink
                context.fill(Path(SVGPath.cached(d)), with: .color(color), style: FillStyle(eoFill: evenOdd))
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}
