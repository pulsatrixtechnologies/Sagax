// A ```mermaid fence (`ChatMarkdown.tsx` MermaidDiagram). The phone draws
// the diagram with the same mermaid library as the desktop, bundled in the
// app (mermaid.min.js, copied from node_modules at build time), in a web
// view that loads nothing from the network. Sizing follows the desktop
// (CompanionCore MermaidDiagrams): fit to the column, never upscaled, at
// most 60 % of the window's height; a tap opens the full screen view with
// pan and pinch zoom. The diagram follows the light or dark skin. While the
// message is still being written, or when the diagram cannot be drawn, the
// block shows its source with Copy, as the desktop does.
import SwiftUI
import UIKit
import WebKit
import CompanionCore

struct MermaidBlockView: View {
    @Environment(\.themePalette) var themePalette
    let code: String
    var pending = false
    var identifier: String?

    @StateObject private var feedback = RichCopyFeedback()
    @State private var result: KeyedMermaidRender?
    @State private var columnWidth: CGFloat = 0
    @State private var fullscreen = false
    @State private var showSource = false

    private static let fontSize = 14
    private var dark: Bool { Theme.palette.isDark }
    private var cacheKey: String { MermaidRenderCache.key(code: code, dark: dark, fontSize: Self.fontSize) }

    var body: some View {
        RichBlockFrame(icon: "point.3.connected.trianglepath.dotted", title: String(localized: "Mermaid diagram"), identifier: identifier) {
            if case .drawn = current {
                RichToolButton(
                    icon: "chevron.left.forwardslash.chevron.right",
                    label: showSource ? "Hide source" : "View source",
                    pressed: showSource,
                    identifier: identifier.map { "\($0)-source-toggle" }
                ) { showSource.toggle() }
                RichToolButton(icon: "arrow.up.left.and.arrow.down.right", label: "Full screen", identifier: identifier.map { "\($0)-fullscreen" }) {
                    fullscreen = true
                }
            }
            RichToolButton(
                icon: feedback.copied == nil ? "doc.on.doc" : "checkmark",
                label: feedback.copied == nil ? "Copy diagram source" : "Diagram source copied",
                identifier: identifier.map { "\($0)-copy" }
            ) {
                feedback.copy("source", code)
            }
            .modifier(RichLastCopied(text: feedback.lastText))
        } content: {
            VStack(alignment: .leading, spacing: 6) {
                switch current {
                case .none:
                    if pending || !MermaidEngine.available {
                        source
                    } else {
                        drawing
                    }
                case let .drawn(svg, natural):
                    diagram(svg: svg, natural: natural)
                    if showSource { source }
                case .failed:
                    Text("This diagram could not be drawn. Here is its source.")
                        .font(.system(size: 11.5))
                        .foregroundStyle(Theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                    source
                }
            }
            .padding(10)
            .background {
                GeometryReader { proxy in
                    Color.clear
                        .onAppear { columnWidth = proxy.size.width - 20 }
                        .onChange(of: proxy.size.width) { columnWidth = $0 - 20 }
                }
            }
        }
        .fullScreenCover(isPresented: $fullscreen) {
            if case let .drawn(svg, _) = current {
                MermaidFullScreen(svg: svg, dark: dark) { fullscreen = false }
            }
        }
    }

    /// The cached drawing for this source and skin, else this view's own.
    private var current: MermaidRender? {
        if let result, result.key == cacheKey { return result.render }
        return MermaidRenderCache.shared.value(for: cacheKey)
    }

    private var source: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            Text(verbatim: code)
                .font(Theme.Font.code)
                .lineSpacing(Theme.bodyLineSpacing)
                .foregroundStyle(Theme.textPrimary)
                .textSelection(.enabled)
        }
    }

    /// The hidden page that runs mermaid once, then hands the SVG back.
    private var drawing: some View {
        HStack(spacing: 8) {
            ProgressView().controlSize(.small)
            Text("Drawing the diagram…")
                .font(.system(size: 11.5))
                .foregroundStyle(Theme.textSecondary)
        }
        .frame(maxWidth: .infinity, minHeight: 60)
        .background(alignment: .topLeading) {
            MermaidRenderer(code: code, dark: dark, fontSize: Self.fontSize) { outcome in
                let key = cacheKey
                let render: MermaidRender
                switch outcome {
                case let .success(svg):
                    if let natural = MermaidDiagrams.svgSize(svg) {
                        render = .drawn(svg: svg, natural: natural)
                    } else {
                        render = .failed
                    }
                case .failure:
                    render = .failed
                }
                MermaidRenderCache.shared.store(render, for: key)
                result = KeyedMermaidRender(key: key, render: render)
            }
            .id(cacheKey)
            .frame(width: 1, height: 1)
            .opacity(0.01)
            .accessibilityHidden(true)
        }
    }

    private func diagram(svg: String, natural: MermaidDiagrams.Size) -> some View {
        let maxHeight = MermaidDiagrams.inlineMaxHeight(viewportHeight: Double(UIScreen.main.bounds.height))
        let fitted = MermaidDiagrams.inlineSize(natural: natural, containerWidth: Double(columnWidth), maxHeight: maxHeight)
        return MermaidSVGView(svg: svg, dark: dark, zoomable: false)
            .frame(width: max(1, fitted.width), height: max(1, fitted.height))
            .frame(maxWidth: .infinity)
            .overlay {
                Color.clear
                    .contentShape(Rectangle())
                    .onTapGesture { fullscreen = true }
            }
            .accessibilityElement()
            .accessibilityLabel(Text("Mermaid diagram"))
            .accessibilityHint(Text("Opens the diagram full screen"))
            .accessibilityAddTraits(.isButton)
            .accessibilityAction { fullscreen = true }
            .accessibilityIdentifier(identifier.map { "\($0)-diagram" } ?? "mermaid-diagram")
    }
}

// MARK: - Engine, cache

/// The bundled mermaid library, read once.
enum MermaidEngine {
    static let script: String? = {
        guard let url = Bundle.main.url(forResource: "mermaid.min", withExtension: "js") else { return nil }
        return try? String(contentsOf: url, encoding: .utf8)
    }()

    static var available: Bool { script != nil }
}

/// A finished drawing (or a failure), so scrolling back does not run
/// mermaid again.
enum MermaidRender {
    case drawn(svg: String, natural: MermaidDiagrams.Size)
    case failed

}

/// This view's drawing and the source and skin it was drawn for.
struct KeyedMermaidRender {
    let key: String
    let render: MermaidRender
}

final class MermaidRenderCache {
    static let shared = MermaidRenderCache()
    private let cache = NSCache<NSString, Box>()

    private final class Box {
        let render: MermaidRender
        init(_ render: MermaidRender) { self.render = render }
    }

    private init() {
        cache.countLimit = 64
    }

    static func key(code: String, dark: Bool, fontSize: Int) -> String {
        "\(dark ? "d" : "l")|\(fontSize)|\(code)"
    }

    func value(for key: String) -> MermaidRender? {
        cache.object(forKey: key as NSString)?.render
    }

    func store(_ render: MermaidRender, for key: String) {
        cache.setObject(Box(render), forKey: key as NSString)
    }
}

// MARK: - Web views

/// Runs mermaid on one source in a page with no network, then reports the
/// SVG or the error. Gives up after 15 seconds.
private struct MermaidRenderer: UIViewRepresentable {
    let code: String
    let dark: Bool
    let fontSize: Int
    let done: (Result<String, MermaidRenderError>) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(done: done) }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.mediaTypesRequiringUserActionForPlayback = .all
        if let script = MermaidEngine.script {
            configuration.userContentController.addUserScript(
                WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true)
            )
        }
        configuration.userContentController.add(context.coordinator, name: "ombMermaid")
        let view = WKWebView(frame: CGRect(x: 0, y: 0, width: 1, height: 1), configuration: configuration)
        view.isOpaque = false
        view.backgroundColor = .clear
        view.isUserInteractionEnabled = false
        view.navigationDelegate = context.coordinator
        context.coordinator.start()
        view.loadHTMLString(MermaidDiagrams.renderPage(code: code, dark: dark, fontSize: fontSize), baseURL: nil)
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {}

    static func dismantleUIView(_ view: WKWebView, coordinator: Coordinator) {
        coordinator.cancel()
        view.configuration.userContentController.removeScriptMessageHandler(forName: "ombMermaid")
    }

    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        private let done: (Result<String, MermaidRenderError>) -> Void
        private var loaded = false
        private var finished = false
        private var timeout: DispatchWorkItem?

        init(done: @escaping (Result<String, MermaidRenderError>) -> Void) {
            self.done = done
        }

        func start() {
            let item = DispatchWorkItem { [weak self] in self?.finish(.failure(.timeout)) }
            timeout = item
            DispatchQueue.main.asyncAfter(deadline: .now() + 15, execute: item)
        }

        func cancel() {
            timeout?.cancel()
            finished = true
        }

        private func finish(_ outcome: Result<String, MermaidRenderError>) {
            guard !finished else { return }
            finished = true
            timeout?.cancel()
            done(outcome)
        }

        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let body = message.body as? [String: Any] else { return }
            DispatchQueue.main.async {
                if let svg = body["svg"] as? String, !svg.isEmpty {
                    self.finish(.success(svg))
                } else {
                    self.finish(.failure(.mermaid((body["error"] as? String) ?? "")))
                }
            }
        }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            let allow = MermaidDiagrams.allowsNavigation(to: action.request.url, isInitialLoad: !loaded && action.targetFrame?.isMainFrame == true)
            if allow { loaded = true }
            decisionHandler(allow ? .allow : .cancel)
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            finish(.failure(.crashed))
        }
    }
}

enum MermaidRenderError: Error {
    case timeout, crashed
    case mermaid(String)
}

/// A drawn diagram: the SVG alone, scripts off, no navigation.
private struct MermaidSVGView: UIViewRepresentable {
    let svg: String
    let dark: Bool
    let zoomable: Bool

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = false
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        // a real size from the start: a web view made at zero size in a
        // full screen cover may not paint until something else redraws it
        let view = WindowLoadingWebView(frame: zoomable ? UIScreen.main.bounds : CGRect(x: 0, y: 0, width: 1, height: 1), configuration: configuration)
        view.isOpaque = false
        view.backgroundColor = .clear
        view.navigationDelegate = context.coordinator
        view.isUserInteractionEnabled = zoomable
        view.scrollView.isScrollEnabled = zoomable
        view.scrollView.bounces = zoomable
        view.scrollView.bouncesZoom = zoomable
        view.scrollView.contentInsetAdjustmentBehavior = .never
        if !zoomable {
            view.scrollView.pinchGestureRecognizer?.isEnabled = false
        }
        view.page = MermaidDiagrams.displayPage(svg: svg, dark: dark, zoomable: zoomable)
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate {
        private var loaded = false


        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            let allow = MermaidDiagrams.allowsNavigation(to: action.request.url, isInitialLoad: !loaded && action.targetFrame?.isMainFrame == true)
            if allow { loaded = true }
            decisionHandler(allow ? .allow : .cancel)
        }
    }
}

/// Loads its page once it is in a window and the window has finished
/// presenting it: a web view loaded while a full screen cover slides in
/// may not paint until something else redraws the screen.
private final class WindowLoadingWebView: WKWebView {
    var page: String?
    private var started = false

    override func didMoveToWindow() {
        super.didMoveToWindow()
        guard window != nil, !started, let page else { return }
        started = true
        DispatchQueue.main.async { [weak self] in
            self?.loadHTMLString(page, baseURL: nil)
        }
    }
}

/// The full screen view: pinch to zoom, drag to pan, Close.
private struct MermaidFullScreen: View {
    let svg: String
    let dark: Bool
    let close: () -> Void

    var body: some View {
        NavigationStack {
            MermaidSVGView(svg: svg, dark: dark, zoomable: true)
                .ignoresSafeArea(edges: .bottom)
                .background(dark ? Color(red: 13 / 255, green: 17 / 255, blue: 23 / 255) : Color.white)
                .navigationTitle(Text("Mermaid diagram"))
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Close", action: close)
                            .accessibilityIdentifier("mermaid-fullscreen-close")
                    }
                }
                .accessibilityIdentifier("mermaid-fullscreen")
        }
        .preferredColorScheme(dark ? .dark : .light)
    }
}
