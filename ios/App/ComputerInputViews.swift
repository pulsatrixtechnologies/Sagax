// The UIKit halves of the computer viewer (parity 13 and 11): the trackpad
// surface laid over the frame, and the hidden key-input responder that
// raises the system keyboard and streams what is typed.
//
// Both only report what the person did; `ComputerController` turns it into
// input events (CompanionCore `TrackpadTranslator`, `RemoteKeyboardTranslator`).
import CompanionCore
import SwiftUI
import UIKit

// MARK: - Trackpad

/// One finger moves the pointer, a tap clicks, a double tap double-clicks,
/// two fingers tap to right-click and pan to scroll, and a long press then
/// drag holds the button down.
struct TrackpadSurface: UIViewRepresentable {
    let onGesture: (TrackpadGesture) -> Void

    func makeUIView(context: Context) -> TrackpadSurfaceView {
        let view = TrackpadSurfaceView()
        view.onGesture = onGesture
        return view
    }

    func updateUIView(_ view: TrackpadSurfaceView, context: Context) {
        view.onGesture = onGesture
    }
}

final class TrackpadSurfaceView: UIView, UIGestureRecognizerDelegate {
    var onGesture: ((TrackpadGesture) -> Void)?

    private var lastTranslation = CGPoint.zero
    private var lastTime: CFTimeInterval = 0
    private var lastScroll = CGPoint.zero
    private var dragLast = CGPoint.zero
    private var dragTime: CFTimeInterval = 0

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .clear
        isMultipleTouchEnabled = true
        isAccessibilityElement = true
        accessibilityIdentifier = "computer-trackpad"
        accessibilityLabel = String(localized: "Trackpad")
        accessibilityHint = String(localized: "Move one finger to move the pointer, tap to click.")
        accessibilityTraits = [.allowsDirectInteraction]

        let doubleTap = UITapGestureRecognizer(target: self, action: #selector(doubleTapped))
        doubleTap.numberOfTapsRequired = 2
        let tap = UITapGestureRecognizer(target: self, action: #selector(tapped))
        tap.require(toFail: doubleTap)
        let twoFingerTap = UITapGestureRecognizer(target: self, action: #selector(twoFingerTapped))
        twoFingerTap.numberOfTouchesRequired = 2
        let longPress = UILongPressGestureRecognizer(target: self, action: #selector(longPressed(_:)))
        longPress.minimumPressDuration = 0.35
        longPress.allowableMovement = 12
        let pan = UIPanGestureRecognizer(target: self, action: #selector(panned(_:)))
        pan.minimumNumberOfTouches = 1
        pan.maximumNumberOfTouches = 1
        pan.require(toFail: longPress)
        let scroll = UIPanGestureRecognizer(target: self, action: #selector(scrolled(_:)))
        scroll.minimumNumberOfTouches = 2
        scroll.maximumNumberOfTouches = 2
        twoFingerTap.require(toFail: scroll)
        for recognizer in [doubleTap, tap, twoFingerTap, longPress, pan, scroll] {
            recognizer.delegate = self
            addGestureRecognizer(recognizer)
        }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    @objc private func tapped() { onGesture?(.tap) }
    @objc private func doubleTapped() { onGesture?(.doubleTap) }
    @objc private func twoFingerTapped() { onGesture?(.twoFingerTap) }

    @objc private func panned(_ recognizer: UIPanGestureRecognizer) {
        let now = CACurrentMediaTime()
        switch recognizer.state {
        case .began:
            lastTranslation = recognizer.translation(in: self)
            lastTime = now
        case .changed:
            let t = recognizer.translation(in: self)
            let interval = max(now - lastTime, 1.0 / 120)
            onGesture?(.pan(dx: t.x - lastTranslation.x, dy: t.y - lastTranslation.y, interval: interval))
            lastTranslation = t
            lastTime = now
        default:
            break
        }
    }

    @objc private func scrolled(_ recognizer: UIPanGestureRecognizer) {
        switch recognizer.state {
        case .began:
            lastScroll = recognizer.translation(in: self)
        case .changed:
            let t = recognizer.translation(in: self)
            onGesture?(.scroll(dx: t.x - lastScroll.x, dy: t.y - lastScroll.y))
            lastScroll = t
        default:
            break
        }
    }

    @objc private func longPressed(_ recognizer: UILongPressGestureRecognizer) {
        let point = recognizer.location(in: self)
        let now = CACurrentMediaTime()
        switch recognizer.state {
        case .began:
            dragLast = point
            dragTime = now
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            onGesture?(.dragBegan)
        case .changed:
            let interval = max(now - dragTime, 1.0 / 120)
            onGesture?(.dragChanged(dx: point.x - dragLast.x, dy: point.y - dragLast.y, interval: interval))
            dragLast = point
            dragTime = now
        case .ended, .cancelled, .failed:
            onGesture?(.dragEnded)
        default:
            break
        }
    }

    func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
        false
    }
}

// MARK: - Keyboard

/// A hidden responder: while active, the system keyboard is up and every key
/// goes to the remote computer. No autocorrection, no predictions: what is
/// typed is what is sent.
struct RemoteKeyboardField: UIViewRepresentable {
    @Binding var isActive: Bool
    var showsSpecialKeys: Bool
    var modifiers: Set<ComputerModifier>
    let onInsert: (String) -> Void
    let onDelete: () -> Void
    let onSpecial: (RemoteSpecialKey) -> Void
    let onModifier: (ComputerModifier) -> Void

    func makeUIView(context: Context) -> RemoteKeyInputView {
        let view = RemoteKeyInputView()
        configure(view)
        return view
    }

    func updateUIView(_ view: RemoteKeyInputView, context: Context) {
        configure(view)
        view.setShowsSpecialKeys(showsSpecialKeys)
        view.accessoryBar?.update(modifiers: modifiers)
        if isActive, !view.isFirstResponder {
            DispatchQueue.main.async { view.becomeFirstResponder() }
        } else if !isActive, view.isFirstResponder {
            DispatchQueue.main.async { _ = view.resignFirstResponder() }
        }
    }

    private func configure(_ view: RemoteKeyInputView) {
        view.onInsert = onInsert
        view.onDelete = onDelete
        view.onSpecial = onSpecial
        view.onModifier = onModifier
        view.onResign = {
            if isActive { DispatchQueue.main.async { isActive = false } }
        }
    }
}

final class RemoteKeyInputView: UIView, UIKeyInput {
    var onInsert: ((String) -> Void)?
    var onDelete: (() -> Void)?
    var onSpecial: ((RemoteSpecialKey) -> Void)?
    var onModifier: ((ComputerModifier) -> Void)?
    var onResign: (() -> Void)?
    private(set) var accessoryBar: RemoteKeysBar?

    override init(frame: CGRect) {
        super.init(frame: frame)
        accessibilityIdentifier = "computer-keyboard-input"
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    func setShowsSpecialKeys(_ shows: Bool) {
        guard shows != (accessoryBar != nil) else { return }
        if shows {
            let bar = RemoteKeysBar()
            bar.onSpecial = { [weak self] in self?.onSpecial?($0) }
            bar.onModifier = { [weak self] in self?.onModifier?($0) }
            accessoryBar = bar
        } else {
            accessoryBar = nil
        }
        if isFirstResponder { reloadInputViews() }
    }

    override var inputAccessoryView: UIView? { accessoryBar }
    override var canBecomeFirstResponder: Bool { true }

    override func resignFirstResponder() -> Bool {
        let resigned = super.resignFirstResponder()
        if resigned { onResign?() }
        return resigned
    }

    // Always "has text", so backspace reaches the remote even on an empty field.
    var hasText: Bool { true }
    func insertText(_ text: String) { onInsert?(text) }
    func deleteBackward() { onDelete?() }

    // UITextInputTraits
    var autocorrectionType: UITextAutocorrectionType = .no
    var autocapitalizationType: UITextAutocapitalizationType = .none
    var spellCheckingType: UITextSpellCheckingType = .no
    var smartQuotesType: UITextSmartQuotesType = .no
    var smartDashesType: UITextSmartDashesType = .no
    var smartInsertDeleteType: UITextSmartInsertDeleteType = .no
    var keyboardAppearance: UIKeyboardAppearance = .dark
    var keyboardType: UIKeyboardType = .asciiCapable
    var returnKeyType: UIReturnKeyType = .default
}

/// The special keys over the keyboard: Esc, Tab, sticky Ctrl / Alt / Cmd,
/// and the arrows.
final class RemoteKeysBar: UIInputView {
    var onSpecial: ((RemoteSpecialKey) -> Void)?
    var onModifier: ((ComputerModifier) -> Void)?
    private var modifierButtons: [ComputerModifier: UIButton] = [:]

    init() {
        super.init(frame: CGRect(x: 0, y: 0, width: 402, height: 44), inputViewStyle: .keyboard)
        allowsSelfSizing = true
        let stack = UIStackView()
        stack.axis = .horizontal
        stack.distribution = .fillEqually
        stack.spacing = 6
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 6),
            stack.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -6),
            stack.topAnchor.constraint(equalTo: topAnchor, constant: 5),
            stack.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -5),
            heightAnchor.constraint(equalToConstant: 44),
        ])
        func button(_ title: String?, symbol: String?, id: String, action: @escaping () -> Void) -> UIButton {
            var config = UIButton.Configuration.gray()
            config.title = title
            config.image = symbol.flatMap { UIImage(systemName: $0) }
            config.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(pointSize: 13, weight: .medium)
            config.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attrs in
                var a = attrs
                a.font = UIFont.systemFont(ofSize: 13, weight: .medium)
                return a
            }
            config.baseForegroundColor = .white
            config.contentInsets = .zero
            let b = UIButton(configuration: config, primaryAction: UIAction { _ in action() })
            b.accessibilityIdentifier = "remote-key-\(id)"
            return b
        }
        stack.addArrangedSubview(button("esc", symbol: nil, id: "escape") { [weak self] in self?.onSpecial?(.escape) })
        stack.addArrangedSubview(button("tab", symbol: nil, id: "tab") { [weak self] in self?.onSpecial?(.tab) })
        for (modifier, title) in [(ComputerModifier.ctrl, "ctrl"), (.alt, "alt"), (.meta, "⌘")] {
            let b = button(title, symbol: nil, id: modifier.rawValue) { [weak self] in self?.onModifier?(modifier) }
            modifierButtons[modifier] = b
            stack.addArrangedSubview(b)
        }
        for (key, symbol) in [(RemoteSpecialKey.left, "arrow.left"), (.up, "arrow.up"), (.down, "arrow.down"), (.right, "arrow.right")] {
            stack.addArrangedSubview(button(nil, symbol: symbol, id: key.rawValue.lowercased()) { [weak self] in self?.onSpecial?(key) })
        }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    func update(modifiers: Set<ComputerModifier>) {
        for (modifier, button) in modifierButtons {
            var config = button.configuration
            config?.baseBackgroundColor = modifiers.contains(modifier) ? UIColor(white: 0.55, alpha: 1) : nil
            button.configuration = config
            button.isSelected = modifiers.contains(modifier)
        }
    }
}
