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
    @Environment(\.themePalette) var themePalette
    @Environment(\.youtubeSendToBot) private var sendToBot
    @EnvironmentObject private var session: Session
    let videoId: String
    var identifier: String?

    @State private var transcriptOpen = false
    @State private var loading = false
    @State private var error: String?
    @State private var cues: [YouTubeTranscriptCue] = []
    @State private var filter = ""
    @State private var seeker = YouTubePlayerSeeker()

    var body: some View {
        RichBlockFrame(icon: "play.rectangle.fill", title: String(localized: "youtube.playerTitle"), identifier: identifier) {
            VStack(alignment: .leading, spacing: 0) {
                YouTubeEmbedWebView(videoId: videoId, seeker: seeker)
                    .aspectRatio(16 / 9, contentMode: .fit)
                    .accessibilityIdentifier(identifier.map { "\($0)-embed" } ?? "youtube-embed")
                HStack(spacing: 8) {
                    Button {
                        Task { await loadTranscript() }
                    } label: {
                        Text(loading ? String(localized: "youtube.transcriptLoading") : String(localized: "youtube.fetchTranscript"))
                            .font(.system(size: 13, weight: .medium))
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.accent)
                    .disabled(loading)

                    if !cues.isEmpty, sendToBot != nil {
                        Button {
                            handToBot()
                        } label: {
                            Label(String(localized: "youtube.sendToBot"), systemImage: "paperplane.fill")
                                .font(.system(size: 13))
                        }
                        .buttonStyle(.bordered)
                    }

                    if !cues.isEmpty {
                        Spacer(minLength: 4)
                        Button {
                            withAnimation(.easeInOut(duration: 0.15)) { transcriptOpen.toggle() }
                        } label: {
                            Label(String(localized: "youtube.transcriptPanel"), systemImage: transcriptOpen ? "chevron.up" : "chevron.down")
                                .font(.system(size: 13))
                                .foregroundStyle(Theme.textSecondary)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 8)

                if transcriptOpen {
                    Divider().overlay(Theme.hairline.opacity(0.3))
                    transcriptBody
                        .padding(10)
                }
            }
        }
    }

    @ViewBuilder
    private var transcriptBody: some View {
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
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.textTertiary)
                TextField(String(localized: "youtube.searchTranscript"), text: $filter)
                    .font(.system(size: 13))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .background(RoundedRectangle(cornerRadius: 8).fill(Theme.cardRaised))
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 4) {
                    ForEach(filteredCues, id: \.self) { cue in
                        Button {
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
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .padding(.vertical, 2)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .frame(maxHeight: 180)
        }
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

    func makeCoordinator() -> Coordinator { Coordinator() }

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
            playerVars: { playsinline: 1, modestbranding: 1, rel: 0 },
            events: { onReady: function(e) { e.target.playVideo(); } }
          });
        }
        window.ombSeekTo = function(seconds) {
          if (player && player.seekTo) player.seekTo(seconds, true);
        };
        </script>
        </body></html>
        """
    }

    final class Coordinator: NSObject, WKNavigationDelegate {}
}
