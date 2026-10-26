// The one material the chrome is made of.
//
// Every floating control — the header tiles, the Updates pill, the round
// buttons, the sheets, the chat's back pill and composer — is the same glass,
// so the app reads as one object rather than a collection of buttons. On
// iOS 26 it is the system's Liquid Glass, which refracts what scrolls
// beneath it; before that, a thin material with a hairline does the same
// job in the same shape, just without the light.
import SwiftUI

/// Something floating over content: a tile, a pill, a sheet.
struct GlassSurface<S: InsettableShape>: ViewModifier {
    @Environment(\.themePalette) var themePalette
    let shape: S
    var interactive: Bool = true
    var tint: Color? = nil

    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            let base: Glass = interactive ? .regular.interactive() : .regular
            content.glassEffect(tint.map { base.tint($0) } ?? base, in: shape)
        } else {
            content
                .background(.ultraThinMaterial, in: shape)
                .background(tint?.opacity(0.18) ?? .clear, in: shape)
                .overlay(shape.strokeBorder(Theme.textPrimary.opacity(0.10), lineWidth: 0.5))
        }
    }
}

extension View {
    /// A capsule of glass — pills and round buttons.
    func glassCapsule(interactive: Bool = true, tint: Color? = nil) -> some View {
        modifier(GlassSurface(shape: Capsule(), interactive: interactive, tint: tint))
    }

    /// A rounded sheet of glass.
    func glassSheet(cornerRadius: CGFloat = 28, tint: Color? = nil) -> some View {
        modifier(GlassSurface(
            shape: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous),
            interactive: false,
            tint: tint
        ))
    }
}

/// Neighbouring glass merges when it touches, the way it does in the
/// system's own bars. A no-op before iOS 26.
struct GlassGroup<Content: View>: View {
    @Environment(\.themePalette) var themePalette
    var spacing: CGFloat = 8
    @ViewBuilder let content: () -> Content

    var body: some View {
        if #available(iOS 26.0, *) {
            GlassEffectContainer(spacing: spacing, content: content)
        } else {
            content()
        }
    }
}

/// A round glass button with one glyph — the shape of every action in the
/// chrome that is not a pill.
struct GlassButton: View {
    @Environment(\.themePalette) var themePalette
    let systemImage: String
    var size: CGFloat = 44
    var weight: Font.Weight = .medium
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: size * 0.42, weight: weight))
                .foregroundStyle(Theme.textPrimary)
                .frame(width: size, height: size)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .glassCapsule()
    }
}

// MARK: - Bottom bar scrim

/// Soft blur and dimming behind the floating bottom bar, so bots scrolling
/// under it stay out of the way of its controls. It starts a little above the
/// bar and strengthens toward the bottom edge, like an iOS material. The bar
/// itself is untouched. With Reduce Transparency on, it is an opaque fade to
/// the page background instead.
private struct BottomBarScrim: ViewModifier {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorScheme) private var colorScheme

    /// How far the fade reaches above the bar.
    private static let reach: CGFloat = 44

    func body(content: Content) -> some View {
        content.background(alignment: .bottom) {
            scrim
                .padding(.top, -Self.reach)
                .ignoresSafeArea(edges: .bottom)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
    }

    @ViewBuilder
    private var scrim: some View {
        let fade = LinearGradient(
            stops: [.init(color: .clear, location: 0), .init(color: .black, location: 0.55)],
            startPoint: .top, endPoint: .bottom
        )
        if reduceTransparency {
            Theme.bg.mask(fade)
        } else {
            ZStack {
                Rectangle().fill(.ultraThinMaterial)
                // darker in dark mode, a light veil in light mode
                (colorScheme == .dark ? Color.black.opacity(0.45) : Color.white.opacity(0.35))
            }
            .mask(fade)
        }
    }
}

extension View {
    /// Blur and dim whatever scrolls under a floating bottom bar.
    func bottomBarScrim() -> some View { modifier(BottomBarScrim()) }
}
