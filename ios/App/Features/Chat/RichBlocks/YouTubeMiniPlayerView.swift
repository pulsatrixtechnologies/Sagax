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

    @State private var metaTitle: String?
    @State private var channel: String?

    var body: some View {
        VideoWidgetChrome(
            title: metaTitle ?? String(localized: "youtube.playerTitle"),
            source: videoId,
            loading: !embedReady,
            drawerOpen: transcriptOpen,
            overlaysStage: false,
            footer: AnyView(footer)
        ) {
            YouTubeEmbedWebView(videoId: videoId, seeker: seeker, onReady: { embedReady = true })
                .accessibilityIdentifier(identifier.map { "\($0)-embed" } ?? "youtube-embed")
        } drawer: {
            transcriptDrawer
        }
        .task(id: videoId) { await loadMetadata() }
    }

    /// Under the player, never over it: YouTube's own title row, play button,
    /// scrub bar and fullscreen button stay visible and tappable.
    private var footer: some View {
        HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(metaTitle ?? String(localized: "youtube.playerTitle"))
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(2)
                Text([channel, "YouTube"].compactMap { $0 }.joined(separator: " · "))
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Button {
                if cues.isEmpty {
                    Task { await loadTranscript() }
                } else {
                    withAnimation(.easeInOut(duration: 0.2)) { transcriptOpen.toggle() }
                }
            } label: {
                HStack(spacing: 6) {
                    if loading {
                        ProgressView().controlSize(.mini)
                    } else {
                        Image(systemName: "text.quote")
                    }
                    Text(loading ? String(localized: "youtube.transcriptLoading") : (cues.isEmpty ? String(localized: "youtube.fetchTranscript") : String(localized: "youtube.transcriptPanel")))
                        .lineLimit(1)
                }
                .font(.system(size: 12, weight: .medium))
            }
            .buttonStyle(.bordered)
            .tint(Theme.accent)
            .fixedSize()
            .layoutPriority(1)
            .disabled(loading)
            .accessibilityIdentifier(identifier.map { "\($0)-transcript" } ?? "youtube-transcript")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
    }

    @ViewBuilder
    private var transcriptDrawer: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let error {
                Text(error)
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.warning)
                    .accessibilityIdentifier(identifier.map { "\($0)-transcript-error" } ?? "youtube-transcript-error")
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
            if res.cues.isEmpty { error = String(localized: "youtube.noCaptions") }
        } catch let err {
            error = Self.message(for: err)
        }
        withAnimation(.easeInOut(duration: 0.2)) { transcriptOpen = true }
    }

    /// The server answers with a code (`no_captions`, `unavailable`,
    /// `blocked`); the words are this app's, in the person's language.
    static func message(for err: Error) -> String {
        // `APIError.status`'s message is the body's `error` field: the code.
        // Matched on the code, never the status alone, since the companion
        // answers 502 and 404 of its own.
        if case let APIError.status(_, code) = err {
            switch code {
            case "no_captions": return String(localized: "youtube.noCaptions")
            case "unavailable": return String(localized: "youtube.videoUnavailable")
            case "blocked": return String(localized: "youtube.transcriptBlocked")
            default: return String(localized: "youtube.transcriptError")
            }
        }
        return (err as? LocalizedError)?.errorDescription ?? String(localized: "youtube.transcriptError")
    }

    /// Title and channel from YouTube's public oEmbed (no key, no cookie).
    private func loadMetadata() async {
        metaTitle = nil
        channel = nil
        guard let watch = "https://www.youtube.com/watch?v=\(videoId)".addingPercentEncoding(withAllowedCharacters: .alphanumerics),
              let url = URL(string: "https://www.youtube.com/oembed?format=json&url=\(watch)")
        else { return }
        struct OEmbed: Decodable { var title: String?; var author_name: String? }
        guard let (data, response) = try? await URLSession.shared.data(from: url),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let meta = try? JSONDecoder().decode(OEmbed.self, from: data)
        else { return }
        metaTitle = meta.title
        channel = meta.author_name
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

struct YouTubeEmbedWebView: UIViewRepresentable {
    let videoId: String
    @ObservedObject var seeker: YouTubePlayerSeeker
    var onReady: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onReady: onReady) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.allowsPictureInPictureMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        // YouTube's fullscreen button: element fullscreen, else the
        // native video fullscreen.
        config.preferences.isElementFullscreenEnabled = true
        config.userContentController.add(WeakScriptHandler(context.coordinator), name: "ready")
        let view = WKWebView(frame: .zero, configuration: config)
        view.isOpaque = true
        view.backgroundColor = .black
        view.scrollView.backgroundColor = .black
        view.scrollView.isScrollEnabled = false
        view.scrollView.bounces = false
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.navigationDelegate = context.coordinator
        seeker.webView = view
        view.loadHTMLString(Self.page(videoId: videoId), baseURL: Self.origin)
        return view
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {
        seeker.webView = uiView
    }

    static func dismantleUIView(_ uiView: WKWebView, coordinator: Coordinator) {
        uiView.stopLoading()
        uiView.configuration.userContentController.removeScriptMessageHandler(forName: "ready")
    }

    /// The page's origin, sent to YouTube as the embedding site (its embeds
    /// refuse a page with no referrer, error 153).
    static let origin = URL(string: "https://localhost")!

    /// The IFrame API sizes its iframe 640x390 unless told otherwise; in a
    /// phone-width web view that showed only its top-left quarter (the play
    /// button and the control bar fell outside). Width and height 100% and
    /// the CSS below make it fill the 16:9 stage at any width or rotation.
    static func page(videoId: String) -> String {
        """
        <!DOCTYPE html>
        <html><head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
        <style>
        html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#000}
        #player,iframe{position:absolute;top:0;left:0;width:100%!important;height:100%!important;border:0}
        </style>
        </head><body>
        <div id="player"></div>
        <script src="https://www.youtube.com/iframe_api"></script>
        <script>
        var player;
        function onYouTubeIframeAPIReady() {
          player = new YT.Player('player', {
            width: '100%',
            height: '100%',
            videoId: '\(videoId)',
            host: 'https://www.youtube-nocookie.com',
            playerVars: { playsinline: 1, controls: 1, fs: 1, rel: 0, origin: '\(origin.absoluteString)' },
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

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        let onReady: () -> Void
        private var readied = false
        init(onReady: @escaping () -> Void) { self.onReady = onReady }

        private func ready() {
            guard !readied else { return }
            readied = true
            onReady()
        }

        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            DispatchQueue.main.async { self.ready() }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            // A player that never reports ready (blocked script) still shows
            // what YouTube drew rather than a spinner forever.
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) { self.ready() }
        }
    }
}

/// `WKUserContentController` keeps its handlers strongly; this breaks the cycle.
private final class WeakScriptHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}
