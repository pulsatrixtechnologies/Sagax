// The sizing and the offline page of a ```mermaid diagram on the phone,
// ported from the desktop's `src/lib/diagram-view.ts` (inline frame in
// ChatMarkdown.tsx MermaidDiagram) so both clients size a diagram the same
// way: fit to the column width, never upscaled past its natural size, never
// taller than 60 % of the window, and the full screen view for pan and zoom.
//
// The phone draws the diagram with the mermaid library the desktop uses,
// bundled in the app (copied from node_modules at build time, see
// ios/project.yml), in a web view that loads nothing from the network: the
// page has a CSP of `default-src 'none'`, mermaid runs with
// securityLevel "strict", and the view cancels any navigation it did not
// start. The views stay thin; every rule here is unit-tested
// (Tests/CompanionCoreTests/MermaidDiagramsTests.swift).
import Foundation

public enum MermaidDiagrams {
    /// The natural size of a rendered diagram, in points.
    public struct Size: Equatable, Sendable {
        public var width: Double
        public var height: Double
        public init(width: Double, height: Double) {
            self.width = width
            self.height = height
        }
    }

    /// The inline size of a diagram and how much it was shrunk.
    public struct InlineSize: Equatable, Sendable {
        public var width: Double
        public var height: Double
        /// Displayed size over natural size, at most 1.
        public var scale: Double
        /// The text would read smaller than the readable threshold.
        public var cramped: Bool
    }

    /// Inline diagrams never exceed this share of the window's height.
    public static let maxHeightRatio = 0.6
    /// Fallback height cap when the window height is unknown.
    public static let maxHeightFallback = 560.0
    /// Below this scale the inline diagram's text is hard to read.
    public static let readableScale = 0.6
    /// Full screen zoom range.
    public static let zoomMin = 0.1
    public static let zoomMax = 8.0

    /// Whether a fence language asks for a diagram.
    public static func isMermaid(_ language: String?) -> Bool {
        (language ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == "mermaid"
    }

    /// The natural size of an SVG string: its viewBox, else its width and
    /// height attributes when they are plain numbers or px. Nil when neither
    /// is usable.
    public static func svgSize(_ svg: String) -> Size? {
        guard let root = firstMatch(#"<svg\b[^>]*>"#, in: svg, group: 0) else { return nil }
        if let viewBox = firstMatch(#"\sviewBox\s*=\s*["']([^"']+)["']"#, in: root, group: 1) {
            let parts = viewBox
                .split(whereSeparator: { $0 == " " || $0 == "," || $0 == "\t" || $0 == "\n" })
                .compactMap { Double($0) }
            if parts.count == 4, parts.allSatisfy(\.isFinite), parts[2] > 0, parts[3] > 0 {
                return Size(width: parts[2], height: parts[3])
            }
        }
        func attribute(_ name: String) -> Double? {
            guard let value = firstMatch(#"\s"# + name + #"\s*=\s*["']([^"']+)["']"#, in: root, group: 1) else { return nil }
            if value.range(of: #"%|em|rem|vw|vh"#, options: [.regularExpression, .caseInsensitive]) != nil { return nil }
            guard let number = firstMatch(#"^\s*([0-9]*\.?[0-9]+)"#, in: value, group: 1) else { return nil }
            return Double(number)
        }
        guard let width = attribute("width"), let height = attribute("height"), width > 0, height > 0 else { return nil }
        return Size(width: width, height: height)
    }

    /// The inline size of a diagram: fit to the column width and under the
    /// height cap, keeping its aspect ratio, never upscaled.
    public static func inlineSize(natural: Size, containerWidth: Double, maxHeight: Double) -> InlineSize {
        let width = max(0, natural.width), height = max(0, natural.height)
        guard width > 0, height > 0 else { return InlineSize(width: 0, height: 0, scale: 1, cramped: false) }
        let byWidth = containerWidth > 0 ? containerWidth / width : 1
        let byHeight = maxHeight > 0 ? maxHeight / height : 1
        let scale = min(1, byWidth, byHeight)
        return InlineSize(
            width: (width * scale).rounded(.down),
            height: (height * scale).rounded(.down),
            scale: scale,
            cramped: scale < readableScale
        )
    }

    /// The height cap for an inline diagram in a window of this height.
    public static func inlineMaxHeight(viewportHeight: Double?) -> Double {
        guard let viewportHeight, viewportHeight > 0 else { return maxHeightFallback }
        return max(200, (viewportHeight * maxHeightRatio).rounded())
    }

    /// The Content-Security-Policy of every diagram page: nothing from the
    /// network, no frames, no forms; inline styles for mermaid's SVG. The
    /// render page also runs its own inline script (mermaid itself comes in
    /// as a user script, which a CSP does not apply to).
    public static func csp(scripts: Bool) -> String {
        let script = scripts ? "'unsafe-inline'" : "'none'"
        return "default-src 'none'; script-src \(script); style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'"
    }

    /// The mermaid configuration the desktop uses (`mermaidConfig` in
    /// ChatMarkdown.tsx), as JSON for the render page.
    public static func configJSON(dark: Bool, fontSize: Int) -> String {
        let fit = #"{"useMaxWidth":true}"#
        let kinds = ["flowchart", "sequence", "gantt", "class", "state", "er", "journey", "pie", "mindmap", "timeline",
                     "gitGraph", "quadrantChart", "requirement", "sankey", "xyChart", "block", "packet", "architecture", "c4"]
        let fits = kinds.map { "\"\($0)\":\(fit)" }.joined(separator: ",")
        let font = #"-apple-system, BlinkMacSystemFont, \"SF UI Text\", system-ui, sans-serif"#
        return "{\"startOnLoad\":false,\"securityLevel\":\"strict\",\"suppressErrorRendering\":true,"
            + "\"theme\":\"\(dark ? "dark" : "default")\",\"fontFamily\":\"\(font)\","
            + "\"themeVariables\":{\"fontSize\":\"\(max(8, min(40, fontSize)))px\"},\(fits)}"
    }

    /// The page that draws a diagram. The source travels as a JSON string,
    /// never as markup, and the result (the SVG and its size, or the error)
    /// goes back through the `ombMermaid` message handler.
    public static func renderPage(code: String, dark: Bool, fontSize: Int) -> String {
        let source = jsonString(code)
        return """
        <!doctype html><html><head><meta charset="utf-8">\
        <meta http-equiv="Content-Security-Policy" content="\(csp(scripts: true))">\
        <meta name="viewport" content="width=device-width,initial-scale=1">\
        <style>html,body{margin:0;padding:0;background:transparent}#d{position:absolute;left:0;top:0;width:1600px}</style>\
        </head><body><div id="d"></div><script>(function(){\
        var post=function(m){window.webkit.messageHandlers.ombMermaid.postMessage(m);};\
        try{if(typeof mermaid==='undefined'){post({error:'engine'});return;}\
        mermaid.initialize(\(configJSON(dark: dark, fontSize: fontSize)));\
        mermaid.render('omb-mermaid-1',\(source),document.getElementById('d')).then(function(out){\
        post({svg:out.svg});},function(e){post({error:String((e&&e.message)||e)});});\
        }catch(e){post({error:String((e&&e.message)||e)});}})();</script></body></html>
        """
    }

    /// The page that shows a drawn diagram: no script at all, the SVG fills
    /// the view and keeps its aspect ratio. `zoomable` is the full screen
    /// view, where the web view's own pinch zoom and scroll do pan and zoom.
    public static func displayPage(svg: String, dark: Bool, zoomable: Bool) -> String {
        let background = dark ? "#0d1117" : "#ffffff"
        let viewport = zoomable
            ? "width=device-width,initial-scale=1,minimum-scale=\(zoomMin),maximum-scale=\(zoomMax),user-scalable=yes"
            : "width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"
        let box = zoomable
            ? "html,body{margin:0;width:100%;height:100%;background:\(background)}body{box-sizing:border-box;padding:16px}svg{display:block;width:100%!important;height:100%!important;max-width:none!important}"
            : "html,body{margin:0;padding:0;width:100%;height:100%;background:transparent;overflow:hidden}svg{display:block;width:100%!important;height:100%!important;max-width:none!important}"
        return """
        <!doctype html><html><head><meta charset="utf-8">\
        <meta http-equiv="Content-Security-Policy" content="\(csp(scripts: false))">\
        <meta name="viewport" content="\(viewport)"><style>\(box)</style></head><body>\(svg)</body></html>
        """
    }

    /// Whether a navigation a diagram page asks for is its own page (the
    /// HTML string the app loaded). Everything else is cancelled.
    public static func allowsNavigation(to url: URL?, isInitialLoad: Bool) -> Bool {
        guard isInitialLoad else { return false }
        guard let url else { return true }
        let text = url.absoluteString
        return text.isEmpty || text == "about:blank"
    }

    // MARK: - Helpers

    static func jsonString(_ text: String) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: [text], options: [.fragmentsAllowed]),
              let array = String(data: data, encoding: .utf8) else { return "\"\"" }
        // ["..."] -> "..."; also keep "</script>" out of the page
        return String(array.dropFirst().dropLast())
            .replacingOccurrences(of: "</", with: "<\\/")
            .replacingOccurrences(of: "\u{2028}", with: "\\u2028")
            .replacingOccurrences(of: "\u{2029}", with: "\\u2029")
    }

    private static func firstMatch(_ pattern: String, in text: String, group: Int) -> String? {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]),
              let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
              let range = Range(match.range(at: group), in: text) else { return nil }
        return String(text[range])
    }
}
