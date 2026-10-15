// The room the iPad's window controls (close, minimize, tile: Stage Manager
// and windowed apps on iPadOS 26) take at a view's top leading corner, so a
// header can start after them instead of under them. Zero on an iPhone, on
// iOS before 26 and wherever the controls are not over the view.
import SwiftUI
import UIKit

extension View {
    /// Writes into `inset` how far the leading edge must move to clear the
    /// window controls over this view.
    func windowControlsInset(_ inset: Binding<CGFloat>) -> some View {
        background(WindowControlsProbe(inset: inset).allowsHitTesting(false))
    }
}

private struct WindowControlsProbe: UIViewRepresentable {
    @Binding var inset: CGFloat

    func makeUIView(context: Context) -> ProbeView {
        let view = ProbeView()
        view.isUserInteractionEnabled = false
        view.onChange = { value in
            if abs(inset - value) > 0.5 { inset = value }
        }
        return view
    }

    func updateUIView(_ view: ProbeView, context: Context) {
        view.onChange = { value in
            if abs(inset - value) > 0.5 { inset = value }
        }
    }

    final class ProbeView: UIView {
        var onChange: ((CGFloat) -> Void)?

        override func layoutSubviews() {
            super.layoutSubviews()
            report()
        }

        override func safeAreaInsetsDidChange() {
            super.safeAreaInsetsDidChange()
            report()
        }

        override func didMoveToWindow() {
            super.didMoveToWindow()
            report()
        }

        private func report() {
            guard UIDevice.current.userInterfaceIdiom == .pad, window != nil else { return }
            var extra: CGFloat = 0
            if #available(iOS 26.0, *) {
                let adapted = directionalEdgeInsets(for: .safeArea(cornerAdaptation: .horizontal)).leading
                let plain = directionalEdgeInsets(for: .safeArea()).leading
                extra = max(0, adapted - plain)
            }
            let value = extra
            DispatchQueue.main.async { [weak self] in self?.onChange?(value) }
        }
    }
}
