// Full-screen computer stages: the picture fills the window; chrome floats
// on top and auto-hides in landscape (JC, TestFlight 27).
import SwiftUI

/// Floating top and bottom chrome over a full-screen computer stage.
struct ComputerImmersiveShell<Top: View, Bottom: View, Content: View>: View {
    @ViewBuilder var top: () -> Top
    @ViewBuilder var bottom: () -> Bottom
    @ViewBuilder var content: () -> Content

    @State private var chromeVisible = true
    @State private var hideTask: Task<Void, Never>?

    var body: some View {
        GeometryReader { proxy in
            let landscape = proxy.size.width > proxy.size.height
            let topPad = proxy.safeAreaInsets.top
            let bottomPad = proxy.safeAreaInsets.bottom
            ZStack {
                Theme.bgComputer.ignoresSafeArea()
                content()
                    .frame(width: proxy.size.width, height: proxy.size.height)
                VStack(spacing: 0) {
                    chromeBar {
                        top()
                            .padding(.horizontal, Theme.Metric.screenEdge)
                            .padding(.top, topPad + 6)
                    }
                    Spacer(minLength: 0)
                    chromeBar {
                        bottom()
                            .padding(.horizontal, Theme.Metric.screenEdge)
                            .padding(.bottom, bottomPad + Theme.Computer.buttonsBottom)
                    }
                }
                .opacity(showsChrome(landscape: landscape) ? 1 : 0)
                .animation(.easeInOut(duration: 0.22), value: chromeVisible)
                .allowsHitTesting(showsChrome(landscape: landscape))
            }
            .contentShape(Rectangle())
            .onTapGesture {
                if landscape, !chromeVisible { revealChrome(landscape: landscape) }
            }
            .onAppear { revealChrome(landscape: landscape) }
            .onValueChange(of: landscape) { revealChrome(landscape: $0) }
        }
    }

    private func showsChrome(landscape: Bool) -> Bool {
        !landscape || chromeVisible
    }

    private func revealChrome(landscape: Bool) {
        chromeVisible = true
        hideTask?.cancel()
        guard landscape else { return }
        hideTask = Task {
            try? await Task.sleep(for: .seconds(4))
            guard !Task.isCancelled else { return }
            await MainActor.run {
                withAnimation { chromeVisible = false }
            }
        }
    }

    @ViewBuilder
    private func chromeBar<Inner: View>(@ViewBuilder _ inner: () -> Inner) -> some View {
        inner()
            .frame(maxWidth: .infinity, alignment: .leading)
            .background {
                Rectangle()
                    .fill(.ultraThinMaterial)
                    .opacity(0.92)
                    .ignoresSafeArea(edges: .horizontal)
            }
    }
}
