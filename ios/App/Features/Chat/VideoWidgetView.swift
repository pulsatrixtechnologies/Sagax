// Inline HLS or MP4 video in the transcript (AVPlayer).
import AVKit
import SwiftUI
import CompanionCore

struct VideoWidgetView: View {
    @EnvironmentObject private var session: Session
    let video: WireVideoWidget
    @State private var player: AVPlayer?
    @State private var loading = true
    @State private var error: String?

    var body: some View {
        VideoWidgetChrome(
            title: video.title ?? video.streamer ?? String(localized: "video.untitled"),
            streamer: video.streamer,
            source: video.source,
            live: video.kind == "live",
            viewerCount: video.viewerCount,
            loading: loading && player != nil,
            error: error,
            onRetry: { Task { await load() } }
        ) {
            Group {
                if let player {
                    VideoPlayer(player: player)
                } else {
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(Color.black)
                }
            }
        }
        .task { await load() }
        .onDisappear {
            player?.pause()
            player = nil
        }
    }

    @MainActor
    private func load() async {
        loading = true
        error = nil
        guard let url = session.absoluteAPIURL(path: video.playbackUrl) else {
            error = String(localized: "video.playbackError")
            loading = false
            return
        }
        // AVPlayer fetches the playlist and its segments itself and sends no
        // bearer. A proxied URL (/api/media/proxy/<token>) needs none: the
        // server takes its signed, thread-bound, short-lived token as the
        // authorization (server/routes/media-widgets.ts).
        let item = AVPlayerItem(url: url)
        let p = AVPlayer(playerItem: item)
        player = p
        loading = false
    }
}
