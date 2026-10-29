// The default theme of bot content on the phone (2026-10-28), as on the
// desktop (src/lib/widget-kit.ts, src/lib/page-theme.ts): a widget document
// carries the kit (WidgetKit.generated.swift) themed from the skin's colors,
// and a page's preview address carries the skin's tokens (`skin=`) so the
// server draws the page in the person's skin. Only known token names with
// safe values ever reach a style.
import Foundation

public enum ContentTheme {
    /// A token value safe inside a style declaration (`safeTokenValue`):
    /// colors, numbers and font lists; nil for anything else.
    public static func safeTokenValue(_ value: String?) -> String? {
        guard let text = value?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty, text.count <= 300 else { return nil }
        guard text.range(of: #"^[\w\s#%().,'"+\-/]*$"#, options: .regularExpression) != nil else { return nil }
        let lower = text.lowercased()
        for banned in ["url(", "image-set", "image(", "expression", "@import", "\\"] where lower.replacingOccurrences(of: " ", with: "").contains(banned) {
            return nil
        }
        if text.filter({ $0 == "\"" }).count % 2 != 0 || text.filter({ $0 == "'" }).count % 2 != 0 { return nil }
        return text
    }

    /// The placeholder of a token in a generated template.
    public static func placeholder(_ name: String) -> String {
        let bare = name.hasPrefix("--") ? String(name.dropFirst(2)) : name
        return "SAGAXTOKEN_" + bare.replacingOccurrences(of: "-", with: "_") + "_END"
    }

    /// The `:root{...}` rule of a widget: the template of the scheme with
    /// the skin's tokens, the fallback skin's for the rest.
    public static func widgetThemeCSS(dark: Bool, tokens: [String: String]) -> String {
        var css = dark ? WidgetKitGenerated.darkTemplate : WidgetKitGenerated.lightTemplate
        let fallback = dark ? WidgetKitGenerated.darkFallback : WidgetKitGenerated.lightFallback
        for name in WidgetKitGenerated.tokenNames {
            let value = safeTokenValue(tokens[name]) ?? fallback[name] ?? "initial"
            css = css.replacingOccurrences(of: placeholder(name), with: value)
        }
        return ":root{\(css)}"
    }

    /// The `skin=` value of a page preview: base64url of the JSON object of
    /// the known tokens with safe values; nil when there is none.
    public static func skinParam(_ tokens: [String: String]) -> String? {
        var safe: [String: String] = [:]
        for name in WidgetKitGenerated.tokenNames + ["--code-color-scheme"] {
            if let value = safeTokenValue(tokens[name]) { safe[name] = value }
        }
        guard !safe.isEmpty, let data = try? JSONSerialization.data(withJSONObject: safe, options: [.sortedKeys]) else { return nil }
        let value = data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        return value.count <= 4096 ? value : nil
    }

    /// The @font-face rule of Geist from the font file's bytes (a data: URL:
    /// the widget's CSP allows fonts from data: only).
    public static func fontFace(ttf: Data?) -> String {
        guard let ttf, !ttf.isEmpty else { return "" }
        return "@font-face{font-family:'Geist Variable';font-style:normal;font-display:block;font-weight:100 900;src:url(data:font/ttf;base64,\(ttf.base64EncodedString())) format('truetype')}"
    }
}

public extension SkinColor {
    /// `#rrggbb`, or `#rrggbbaa` when not opaque.
    var cssValue: String {
        let rgb = String(format: "#%06x", hex & 0xFFFFFF)
        guard alpha < 1 else { return rgb }
        return rgb + String(format: "%02x", Int((max(0, min(1, alpha)) * 255).rounded()))
    }
}

public extension SkinPalette {
    /// The desktop's app tokens (`WIDGET_THEME_TOKENS`) from this skin: what
    /// a widget is themed with and what a page preview sends as `skin=`.
    var contentTokens: [String: String] {
        var tokens: [String: String] = [
            "--code-color-scheme": isDark ? "dark" : "light",
            "--color-ink": textPrimary.cssValue,
            "--color-ink-secondary": textSecondary.cssValue,
            "--color-ink-tertiary": textTertiary.cssValue,
            "--color-panel": bg.cssValue,
            "--color-card": card.cssValue,
            "--color-menu": card.cssValue,
            "--color-raised": cardRaised.cssValue,
            "--color-raised-hover": cardRaised.cssValue,
            "--color-inset": inset.cssValue,
            "--color-hairline": hairline.cssValue,
            "--color-accent": primaryFill.cssValue,
            "--color-accent-ink": primaryInk.cssValue,
            "--color-accent-text": accentText.cssValue,
            "--color-focus": focus.cssValue,
            "--color-unread": unreadDot.cssValue,
            "--color-success": success.cssValue,
            "--color-warning": warning.cssValue,
            "--color-danger": danger.cssValue,
            "--color-danger-ink": dangerInk.cssValue,
        ]
        switch typeface {
        case .system: tokens["--font-sans"] = "\"Geist Variable\", -apple-system, BlinkMacSystemFont, \"SF Pro Text\", system-ui, sans-serif"
        case .serif: tokens["--font-sans"] = "ui-serif, \"New York\", Georgia, serif"
        case .retro: tokens["--font-sans"] = "Verdana, Tahoma, sans-serif"
        }
        return tokens
    }
}
