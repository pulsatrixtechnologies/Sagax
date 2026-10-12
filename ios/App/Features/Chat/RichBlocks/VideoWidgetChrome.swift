// Premium inline video card chrome (live/VOD and YouTube).
import SwiftUI

struct VideoWidgetChrome<Stage: View, Drawer: View>: View {
    @Environment(\.themePalette) var themePalette
    let title: String
    var streamer: String?
    var source: String?
    var live: Bool = false
    var viewerCount: Int?
    var loading: Bool = false
    var error: String?
    var onRetry: (() -> Void)?
    var drawerOpen: Bool = false
    @ViewBuilder var stage: () -> Stage
    @ViewBuilder var drawer: () -> Drawer

    var body: some View {
        VStack(spacing: 0) {
            ZStack(alignment: .topLeading) {
                stage()
                    .aspectRatio(16 / 9, contentMode: .fit)
                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                LinearGradient(
                    colors: [.black.opacity(0.72), .black.opacity(0.05), .clear],
                    startPoint: .top,
                    endPoint: .center
                )
                .allowsHitTesting(false)
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(.white)
                        .lineLimit(2)
                    if let streamer, !streamer.isEmpty {
                        Text([streamer, source].compactMap { $0 }.joined(separator: " · "))
                            .font(.system(size: 12))
                            .foregroundStyle(.white.opacity(0.78))
                            .lineLimit(1)
                    }
                }
                .padding(12)
                if live {
                    HStack(spacing: 6) {
                        Circle().fill(.white).frame(width: 6, height: 6)
                        Text("En direct")
                            .font(.system(size: 11, weight: .bold))
                        if let viewerCount, viewerCount > 0 {
                            Text("· \(viewerCount)")
                                .font(.system(size: 11, weight: .medium))
                        }
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(Capsule().fill(Color.red.opacity(0.92)))
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .trailing)
                }
                if loading {
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(Theme.card.opacity(0.35))
                        .aspectRatio(16 / 9, contentMode: .fit)
                        .overlay { ProgressView().tint(.white) }
                }
                if let error {
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(.black.opacity(0.55))
                        .aspectRatio(16 / 9, contentMode: .fit)
                        .overlay {
                            VStack(spacing: 10) {
                                Text(error)
                                    .font(.system(size: 14))
                                    .multilineTextAlignment(.center)
                                    .foregroundStyle(.white)
                                if let onRetry {
                                    Button(String(localized: "video.retry"), action: onRetry)
                                        .buttonStyle(.borderedProminent)
                                }
                            }
                            .padding()
                        }
                }
            }
            .shadow(color: .black.opacity(0.18), radius: 18, y: 8)
            if drawerOpen {
                drawer()
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .frame(maxWidth: 520, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Theme.card)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(Theme.hairline.opacity(0.35), lineWidth: 1)
        )
    }
}

extension VideoWidgetChrome where Drawer == EmptyView {
    init(
        title: String,
        streamer: String? = nil,
        source: String? = nil,
        live: Bool = false,
        viewerCount: Int? = nil,
        loading: Bool = false,
        error: String? = nil,
        onRetry: (() -> Void)? = nil,
        @ViewBuilder stage: @escaping () -> Stage
    ) {
        self.title = title
        self.streamer = streamer
        self.source = source
        self.live = live
        self.viewerCount = viewerCount
        self.loading = loading
        self.error = error
        self.onRetry = onRetry
        self.drawerOpen = false
        self.stage = stage
        self.drawer = { EmptyView() }
    }
}
