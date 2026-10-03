// A bot-written interactive widget (```widget fence, `WidgetFrame.tsx`):
// HTML, CSS and JS run in an iframe sandboxed to "allow-scripts" only, inside
// a web view with no persistent storage. The widget document opens with a
// CSP that forbids every network request; the only channel back is a height
// number the phone clamps. A widget that navigates its frame away is reset,
// and stopped after the second time.
import SwiftUI
import WebKit
import CompanionCore

struct WidgetFrameView: View {
    @Environment(\.themePalette) var themePalette
    let code: String
    var pending = false
    var identifier: String?

    @State private var showSource = false
    @State private var generation = 0
    @State private var escapes = 0
    @State private var height: CGFloat = 180
    @State private var fullscreen = false

    private var blocked: Bool { escapes >= 2 }

    var body: some View {
        RichBlockFrame(icon: "macwindow", title: String(localized: "Interactive widget"), identifier: identifier) {
            RichToolButton(
                icon: "chevron.left.forwardslash.chevron.right",
                label: showSource ? "Hide source" : "View source",
                pressed: showSource,
                identifier: identifier.map { "\($0)-source-toggle" }
            ) { showSource.toggle() }
            RichToolButton(icon: "arrow.counterclockwise", label: "Restart widget", identifier: identifier.map { "\($0)-restart" }) {
                escapes = 0
                generation += 1
            }
            .disabled(pending)
            RichToolButton(icon: "arrow.up.left.and.arrow.down.right", label: "Full screen", identifier: identifier.map { "\($0)-fullscreen" }) {
                fullscreen = true
            }
            .disabled(pending || blocked)
        } content: {
            if pending {
                Text("The widget is still being written. It runs once the message is complete.")
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textSecondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 22)
                    .padding(.horizontal, 10)
            } else if !blocked {
                SandboxedWidget(source: code, dark: Theme.palette.isDark, height: $height) {
                    escapes += 1
                    generation += 1
                }
                .id("\(generation):\(Theme.palette.isDark)")
                .frame(height: height)
                .accessibilityIdentifier(identifier.map { "\($0)-frame" } ?? "widget-frame")
            }
            if escapes > 0 {
                Text(blocked ? "The widget kept leaving its sandbox and was stopped." : "The widget tried to leave its sandbox and was reset.")
                    .font(.system(size: 11.5))
                    .foregroundStyle(Theme.warning)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
            }
            if showSource || pending {
                ScrollView(.horizontal, showsIndicators: false) {
                    Text(verbatim: code)
                        .font(Theme.Font.code)
                        .foregroundStyle(Theme.textPrimary)
                        .textSelection(.enabled)
                        .padding(10)
                }
                .frame(maxHeight: 320)
            }
        }
        .fullScreenCover(isPresented: $fullscreen) {
            NavigationStack {
                SandboxedWidget(source: code, dark: Theme.palette.isDark, height: .constant(0)) {}
                    .ignoresSafeArea(edges: .bottom)
                    .navigationTitle(Text("Interactive widget"))
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Close") { fullscreen = false }
                        }
                    }
            }
        }
    }
}

/// The web view: our page holds the sandboxed iframe and forwards only the
/// widget's height to the app.
private struct SandboxedWidget: UIViewRepresentable {
    let source: String
    let dark: Bool
    @Binding var height: CGFloat
    let onEscaped: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.userContentController.add(context.coordinator, name: "ombWidgetSize")
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.mediaTypesRequiringUserActionForPlayback = .all
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.isOpaque = false
        view.backgroundColor = .clear
        view.scrollView.isScrollEnabled = false
        view.scrollView.bounces = false
        view.navigationDelegate = context.coordinator
        view.loadHTMLString(Self.host(source, dark: dark), baseURL: nil)
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        context.coordinator.parent = self
    }

    static func dismantleUIView(_ view: WKWebView, coordinator: Coordinator) {
        view.configuration.userContentController.removeScriptMessageHandler(forName: "ombWidgetSize")
    }

    /// The host page: a CSP of its own (no network, no frames but ours),
    /// the widget in a srcdoc iframe sandboxed to scripts only, and a
    /// listener that forwards the iframe's size message and nothing else.
    static func host(_ source: String, dark: Bool) -> String {
        let document = RichBlocks.widgetDocument(source, dark: dark)
        let escaped = document
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "\"", with: "&quot;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
        let csp = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-src about: data:; child-src about: data:"
        return """
        <!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="\(csp)">\
        <meta name="viewport" content="width=device-width,initial-scale=1">\
        <style>html,body{margin:0;padding:0;background:transparent}iframe{display:block;width:100%;height:100vh;border:0}</style></head><body>\
        <iframe sandbox="\(RichBlocks.widgetSandbox)" referrerpolicy="no-referrer" allow="" srcdoc="\(escaped)"></iframe>\
        <script>(function(){var frame=document.querySelector('iframe');addEventListener('message',function(event){\
        if(event.source!==frame.contentWindow)return;var data=event.data;if(!data||data.type!=="\(RichBlocks.widgetMessage)")return;\
        if(typeof data.height!=='number')return;window.webkit.messageHandlers.ombWidgetSize.postMessage(data.height);});})();</script>\
        </body></html>
        """
    }

    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        var parent: SandboxedWidget
        private var loadedHost = false

        init(_ parent: SandboxedWidget) {
            self.parent = parent
        }

        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let next = RichBlocks.clampWidgetHeight(message.body as? Double ?? (message.body as? NSNumber)?.doubleValue) else { return }
            DispatchQueue.main.async { self.parent.height = CGFloat(next) }
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor action: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            let url = action.request.url?.absoluteString ?? ""
            // our host page, then the iframe's srcdoc; anything else is the
            // widget leaving its frame
            if !loadedHost && action.targetFrame?.isMainFrame == true {
                loadedHost = true
                decisionHandler(.allow)
                return
            }
            if action.targetFrame?.isMainFrame == false && (url == "about:srcdoc" || url.isEmpty) {
                decisionHandler(.allow)
                return
            }
            decisionHandler(.cancel)
            DispatchQueue.main.async { self.parent.onEscaped() }
        }
    }
}
