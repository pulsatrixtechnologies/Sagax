// The pieces every onboarding screen shares, in the parity design language
// (Theme.swift), in the active skin: the #141414 page on Black, a glass circle in the top corner,
// a 13.5 pt medium title, grouped #202020 cards and the light capsule.
import SwiftUI

/// A full onboarding page: a glass button and a title on top, scrolling
/// content, and an optional pinned footer (the capsule action).
struct OnboardingPage<Content: View, Footer: View>: View {
    @Environment(\.themePalette) var themePalette
    var title: LocalizedStringKey?
    var leading: Leading?
    var trailing: Trailing?
    @ViewBuilder let content: () -> Content
    @ViewBuilder let footer: () -> Footer

    struct Leading {
        var systemImage: String
        var label: LocalizedStringKey
        var identifier: String
        var action: () -> Void
    }

    struct Trailing {
        var systemImage: String
        var label: LocalizedStringKey
        var identifier: String
        var action: () -> Void
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 14) {
                if let leading {
                    GlassCircleButton(systemImage: leading.systemImage, size: .sheet, accessibilityLabel: leading.label, action: leading.action)
                        .accessibilityIdentifier(leading.identifier)
                }
                if let title {
                    Text(title)
                        .font(Theme.Font.headerTitle)
                        .foregroundStyle(Theme.textPrimary)
                        .accessibilityAddTraits(.isHeader)
                }
                Spacer(minLength: 0)
                if let trailing {
                    GlassCircleButton(systemImage: trailing.systemImage, size: .sheet, accessibilityLabel: trailing.label, action: trailing.action)
                        .accessibilityIdentifier(trailing.identifier)
                }
            }
            .frame(height: 52)
            .padding(.horizontal, Theme.Metric.screenEdge)

            ScrollView {
                VStack(spacing: 0, content: content)
                    .frame(maxWidth: 560)
                    .frame(maxWidth: .infinity)
                    .padding(.bottom, 24)
            }
            .scrollDismissesKeyboard(.interactively)
            .topScrollEdgeFade(height: 24)

            footer()
                .frame(maxWidth: 560)
                .padding(.horizontal, 23.17)
                .padding(.top, 10)
                .padding(.bottom, 12)
        }
        .background(Theme.bg.ignoresSafeArea())
        .preferredColorScheme(Theme.palette.isDark ? .dark : .light)
    }
}

extension OnboardingPage where Footer == EmptyView {
    init(title: LocalizedStringKey? = nil, leading: Leading? = nil, trailing: Trailing? = nil, @ViewBuilder content: @escaping () -> Content) {
        self.init(title: title, leading: leading, trailing: trailing, content: content, footer: { EmptyView() })
    }
}

/// The big Sagax owl with a title and a line under it.
struct OnboardingHero: View {
    @Environment(\.themePalette) var themePalette
    let title: LocalizedStringKey
    let subtitle: LocalizedStringKey
    var color = "blue"
    var mascotSize: CGFloat = 104

    var body: some View {
        VStack(spacing: 14) {
            BrandMascotView(owlColor: color, size: mascotSize)
                .padding(.top, 18)
                .padding(.bottom, 6)
                .accessibilityHidden(true)
            Text(title)
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(Theme.textPrimary)
                .multilineTextAlignment(.center)
            Text(subtitle)
                .font(Theme.Font.body)
                .foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.center)
                .lineSpacing(Theme.bodyLineSpacing)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 36)
        }
        .frame(maxWidth: .infinity)
        .padding(.bottom, Theme.Metric.cardGap)
    }
}

/// A failure the person can act on, always on screen above the content
/// that caused it (never below the fold).
struct OnboardingErrorBanner: View {
    @Environment(\.themePalette) var themePalette
    let message: String

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 14))
                .foregroundStyle(Theme.destructive)
                .padding(.top, 1)
            Text(message)
                .font(Theme.Font.rowTitle)
                .foregroundStyle(Theme.textPrimary)
                .lineSpacing(2)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, Theme.Metric.rowInset)
        .padding(.vertical, 13)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.Metric.cardRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.Metric.cardRadius, style: .continuous)
                .strokeBorder(Theme.destructive.opacity(0.45), lineWidth: 1)
        )
        .padding(.horizontal, 23.17)
        .padding(.bottom, 16)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("connect-error")
    }
}

/// A text field inside a card row, in the parity type.
struct OnboardingField: View {
    @Environment(\.themePalette) var themePalette
    let placeholder: LocalizedStringKey
    @Binding var text: String
    var keyboard: UIKeyboardType = .URL
    var content: UITextContentType? = .URL
    var identifier: String

    var body: some View {
        TextField(text: $text) {
            Text(placeholder).foregroundStyle(Theme.placeholder)
        }
        .font(Theme.Font.rowTitle)
        .foregroundStyle(Theme.textPrimary)
        .tint(Theme.caret)
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .keyboardType(keyboard)
        .textContentType(content)
        .padding(.horizontal, Theme.Metric.rowInset)
        .frame(height: Theme.Metric.rowHeight)
        .accessibilityIdentifier(identifier)
    }
}

/// The light capsule with a spinner while something runs.
struct OnboardingCapsule: View {
    @Environment(\.themePalette) var themePalette
    let title: LocalizedStringKey
    var busyTitle: LocalizedStringKey?
    var busy = false
    var enabled = true
    var identifier: String
    let action: () -> Void

    var body: some View {
        Button {
            Haptics.selection()
            action()
        } label: {
            HStack(spacing: 8) {
                if busy { ProgressView().tint(Theme.primaryInk).controlSize(.small) }
                Text(busy ? (busyTitle ?? title) : title)
                    .font(Theme.Font.buttonLabel)
            }
            .foregroundStyle(enabled && !busy ? Theme.primaryInk : Theme.disabledCapsuleText)
            .frame(maxWidth: .infinity)
            .frame(height: 44)
            .background(enabled && !busy ? Theme.primaryFill : Theme.disabledCapsule, in: Capsule())
            .overlay(Capsule().strokeBorder(Theme.palette.isDark ? Color.white.opacity(0.35) : Theme.hairline, lineWidth: 0.5))
        }
        .buttonStyle(.plain)
        .disabled(!enabled || busy)
        .accessibilityIdentifier(identifier)
    }
}
