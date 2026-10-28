// The page's own preview wrapper, the desktop's framed snapshot. The
// request carries this phone's bearer. Later loads stay on the API origin
// and on the preview or preview-frame path (PagePreview.allows).
import CompanionCore
import SwiftUI
import WebKit

struct PagePreviewSheet: View {
    @EnvironmentObject private var session: Session
    let pageID: String
    let version: Int
    @Environment(\.dismiss) private var dismiss
    @State private var request: URLRequest?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Group {
                if let request {
                    PagePreviewWebView(request: request, apiBase: session.settingsClient?.connection.baseURL)
                } else if let error {
                    Text(verbatim: error)
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .padding(24)
                } else {
                    ProgressView()
                }
            }
            .navigationTitle("Page snapshot")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
        }
        .task { await load() }
    }

    private func load() async {
        guard let client = session.settingsClient else {
            error = "Sagax is not connected."
            return
        }
        do {
            let version = try await client.pageVersionPreview(id: pageID, version: version)
            request = try client.pagePreviewRequest(path: version.previewPath)
        } catch {
            self.error = error.localizedDescription
        }
    }
}

private struct PagePreviewWebView: UIViewRepresentable {
    let request: URLRequest
    let apiBase: URL?

    func makeCoordinator() -> Coordinator { Coordinator(apiBase: apiBase) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = context.coordinator
        view.load(request)
        return view
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate {
        let apiBase: URL?
        init(apiBase: URL?) { self.apiBase = apiBase }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = navigationAction.request.url, let apiBase, PagePreview.allows(url, apiBase: apiBase) else {
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }
    }
}
