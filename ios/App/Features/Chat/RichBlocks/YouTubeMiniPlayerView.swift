// YouTube mini player in bot markdown (youtube-nocookie + transcript panel).
import Combine
import SwiftUI
import WebKit
import CompanionCore

/// Sends a transcript handoff into this conversation's composer.
struct YouTubeComposerKey: EnvironmentKey {
    static let defaultValue: ((String) -> Void)? = nil
}

extension EnvironmentValues {
    var youtubeSendToBot: ((String) -> Void)? {
        get { self[YouTubeComposerKey.self] }
        set { self[YouTubeComposerKey.self] = newValue }
    }
}

struct YouTubeMiniPlayerView: View {
    @Environment(\.youtubeSendToBot) private var sendToBot
    @EnvironmentObject private var session: Session
    let videoId: String
    var identifier: String?

    @State private var transcriptOpen = false
    @State private var loading = false
    @State private var embedReady = false
    @State private var error: String?
    @State private var cues: [YouTubeTranscriptCue] = []
    @State private var filter = ""
    @State private var activeCueMs: Int?
    @State private var seeker = YouTubePlayerSeeker()

    var body: some View {
        VideoWidgetChrome(
            title: String(localized: "youtube.playerTitle"),
            source: videoId,
            loading: !embedReady,
            drawerOpen: transcriptOpen
        ) {
            YouTubeEmbedWebView(videoId: videoId, seeker: seeker, onReady: { embedReady = true })
                .accessibilityIdentifier(identifier.map { "\($0)-embed" } ?? "youtube-embed")
        } drawer: {
            transcriptDrawer
        }
        .overlay(alignment: .bottomTrailing) {
            HStack(spacing: 8) {
                Button {
                    Task { await loadTranscript() }
                } label: {
                    Label(
                        loading ? String(localized: "youtube.transcriptLoading") : (cues.isEmpty ? String(localized: "youtube.fetchTranscript") : String(localized: "youtube.transcriptPanel")),
                        systemImage: "text.quote"
                    )
                    .font(.system(size: 12, weight: .medium))
                }
                .buttonStyle(.bordered)
                .tint(.white)
                .padding(10)
            }
        }
    }

    @ViewBuilder
    private var transcriptDrawer: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let error {
                Text(error)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.warning)
            } else if cues.isEmpty, !loading {
                Text(String(localized: "youtube.transcriptEmpty"))
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textSecondary)
            } else {
                HStack(spacing: 6) {
                    Image(systemName: "magnifyingglass")
                        .foregroundStyle(Theme.textTertiary)
                    TextField(String(localized: "youtube.searchTranscript"), text: $filter)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
                .padding(10)
                .background(RoundedRectangle(cornerRadius: 12).fill(Theme.cardRaised))
                if !cues.isEmpty, sendToBot != nil {
                    Button(action: handToBot) {
                        Label(String(localized: "youtube.sendToBot"), systemImage: "paperplane.fill")
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.accent)
                }
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 4) {
                        ForEach(filteredCues, id: \.self) { cue in
                            Button {
                                activeCueMs = cue.startMs
                                seeker.seek(toMs: cue.startMs)
                            } label: {
                                HStack(alignment: .top, spacing: 8) {
                                    Text(formatCueTime(cue.startMs))
                                        .font(.system(size: 12, weight: .medium, design: .monospaced))
                                        .foregroundStyle(Theme.accent)
                                        .frame(width: 44, alignment: .leading)
                                    Text(cue.text)
                                        .font(.system(size: 13))
                                        .foregroundStyle(Theme.textPrimary)
                                        .multilineTextAlignment(.leading)
                                }
                                .padding(8)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(
                                    RoundedRectangle(cornerRadius: 10)
                                        .fill(activeCueMs == cue.startMs ? Theme.accent.opacity(0.14) : Color.clear)
                                )
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .frame(maxHeight: 200)
            }
        }
        .padding(12)
    }

    private var filteredCues: [YouTubeTranscriptCue] {
        let q = filter.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return cues }
        return cues.filter { $0.text.lowercased().contains(q) }
    }

    private func formatCueTime(_ ms: Int) -> String {
        let total = ms / 1000
        let m = total / 60
        let s = total % 60
        return String(format: "%d:%02d", m, s)
    }

    @MainActor
    private func loadTranscript() async {
        loading = true
        error = nil
        defer { loading = false }
        do {
            let res = try await session.youtubeTranscript(videoId: videoId)
            cues = res.cues
            transcriptOpen = true
        } catch let err {
            error = (err as? LocalizedError)?.errorDescription ?? String(localized: "youtube.transcriptError")
            transcriptOpen = true
        }
    }

    private func handToBot() {
        guard let sendToBot, !cues.isEmpty else { return }
        let body = cues.map { "[\(formatCueTime($0.startMs))] \($0.text)" }.joined(separator: "\n")
        let format = String(localized: "youtube.handoffPrompt")
        sendToBot(String(format: format, videoId, body))
    }
}

/// Shared seek handle for the embed web view.
final class YouTubePlayerSeeker: ObservableObject {
    weak var webView: WKWebView?

    func seek(toMs: Int) {
        let seconds = Double(toMs) / 1000.0
        webView?.evaluateJavaScript("window.ombSeekTo(\(seconds));", completionHandler: nil)
    }
}

private struct YouTubeEmbedWebView: UIViewRepresentable {
    let videoId: String
    @ObservedObject var seeker: YouTubePlayerSeeker
    var onReady: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onReady: onReady) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        let view = WKWebView(frame: .zero, configuration: config)
        view.isOpaque = true
        view.backgroundColor = .black
        view.scrollView.isScrollEnabled = false
        view.navigationDelegate = context.coordinator
        seeker.webView = view
        view.loadHTMLString(Self.page(videoId: videoId), baseURL: URL(string: "https://localhost"))
        return view
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {
        seeker.webView = uiView
    }

    static func dismantleUIView(_ uiView: WKWebView, coordinator: Coordinator) {
        uiView.stopLoading()
    }

    static func page(videoId: String) -> String {
        """
        <!DOCTYPE html>
        <html><head>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>html,body{margin:0;background:#000;height:100%}#player{position:absolute;inset:0}</style>
        </head><body>
        <div id="player"></div>
        <script src="https://www.youtube.com/iframe_api"></script>
        <script>
        var player;
        function onYouTubeIframeAPIReady() {
          player = new YT.Player('player', {
            videoId: '\(videoId)',
            host: 'https://www.youtube-nocookie.com',
            playerVars: { playsinline: 1, modestbranding: 1, rel: 0, controls: 0 },
            events: { onReady: function(e) { window.webkit?.messageHandlers?.ready?.postMessage('1'); } }
          });
        }
        window.ombSeekTo = function(seconds) {
          if (player && player.seekTo) player.seekTo(seconds, true);
        };
        </script>
        </body></html>
        """
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        let onReady: () -> Void
        init(onReady: @escaping () -> Void) { self.onReady = onReady }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { self.onReady() }
        }
    }
}
