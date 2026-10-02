// Turns off the keyboard's suggestion strip for a SwiftUI `TextField`.
//
// The search and "To:" fields filter as you type; word predictions above
// the keyboard add nothing there and push the keyboard 44 pt taller than the
// reference (17, 19). SwiftUI has no switch for spell checking or inline
// prediction, so a zero-size probe placed behind the field finds the
// `UITextField` SwiftUI made for it and sets them on it.
import SwiftUI
import UIKit

extension View {
    /// No autocorrection, spell checking or inline prediction: the keyboard
    /// shows no suggestion strip.
    func withoutKeyboardSuggestions() -> some View {
        autocorrectionDisabled()
            .textInputAutocapitalization(.never)
            .background(KeyboardSuggestionsOff().frame(width: 0, height: 0))
    }
}

private struct KeyboardSuggestionsOff: UIViewRepresentable {
    func makeUIView(context: Context) -> Probe { Probe() }
    func updateUIView(_ view: Probe, context: Context) { view.tune() }

    final class Probe: UIView {
        override func didMoveToWindow() {
            super.didMoveToWindow()
            tune()
        }

        func tune() {
            DispatchQueue.main.async { [weak self] in
                guard let self, let field = self.nearestTextField() else { return }
                field.autocorrectionType = .no
                field.spellCheckingType = .no
                field.smartDashesType = .no
                field.smartQuotesType = .no
                if #available(iOS 17.0, *) { field.inlinePredictionType = .no }
            }
        }

        /// The text field sharing this probe's closest ancestor.
        private func nearestTextField() -> UITextField? {
            var ancestor = superview
            for _ in 0..<6 {
                guard let current = ancestor else { return nil }
                if let field = Self.find(in: current) { return field }
                ancestor = current.superview
            }
            return nil
        }

        private static func find(in view: UIView) -> UITextField? {
            if let field = view as? UITextField { return field }
            for sub in view.subviews {
                if let field = find(in: sub) { return field }
            }
            return nil
        }
    }
}
