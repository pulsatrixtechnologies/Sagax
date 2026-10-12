// Inline HLS or MP4 video in the transcript (AVPlayer).
import AVKit
import SwiftUI
import CompanionCore

struct VideoWidgetView: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    let video: WireVideoWidget
    @State private var player: AVPlayer?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let title = video.title ?? video.streamer {
                Text(title)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.textPrimary)
            }
            if video.kind == "live" {
                Text("En direct")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(Capsule().fill(Color.red))
            }
            Group {
                if let player {
                    VideoPlayer(player: player)
                        .aspectRatio(16 / 9, contentMode: .fit)
                        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                } else {
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(Theme.card)
                        .aspectRatio(16 / 9, contentMode: .fit)
                        .overlay { ProgressView() }
                }
            }
        }
        .frame(maxWidth: 520, alignment: .leading)
        .task {
            guard player == nil, let url = session.absoluteAPIURL(path: video.playbackUrl) else { return }
            player = AVPlayer(url: url)
        }
        .onDisappear {
            player?.pause()
            player = nil
        }
    }
}
