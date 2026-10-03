// The call as the phone sees it: CallKit. An outgoing call to the bot, so
// the system treats it as a call (the green pill and the Dynamic Island,
// the lock screen, audio priority, Bluetooth and AirPods routes, another
// call or Siri interrupting it), and its own mute, hold and end buttons
// reach the call. The audio session is activated by the system for the
// call; the engine starts when it is.
//
// When CallKit cannot place the call (the simulator, a restricted device),
// the call activates its own audio session and runs the same way.
import AVFoundation
import CallKit
import UIKit

final class CallKitBridge: NSObject, CXProviderDelegate {
    private let provider: CXProvider
    private let controller = CXCallController()
    private(set) var callId: UUID?

    var onActivate: @MainActor () -> Void = {}
    var onDeactivate: @MainActor () -> Void = {}
    var onEnd: @MainActor () -> Void = {}
    var onMute: @MainActor (Bool) -> Void = { _ in }
    var onHold: @MainActor (Bool) -> Void = { _ in }

    override init() {
        let configuration = CXProviderConfiguration()
        configuration.supportsVideo = false
        configuration.maximumCallGroups = 1
        configuration.maximumCallsPerCallGroup = 1
        configuration.supportedHandleTypes = [.generic]
        // a bot is not a contact: keep it out of the Phone app's Recents
        configuration.includesCallsInRecents = false
        if let icon = UIImage(systemName: "waveform")?.pngData() { configuration.iconTemplateImageData = icon }
        provider = CXProvider(configuration: configuration)
        super.init()
        provider.setDelegate(self, queue: nil)
    }

    /// Place the call. False when CallKit refused it (run without it).
    func start(name: String) async -> Bool {
        let id = UUID()
        let action = CXStartCallAction(call: id, handle: CXHandle(type: .generic, value: name))
        action.contactIdentifier = name
        do {
            try await controller.request(CXTransaction(action: action))
            callId = id
            let update = CXCallUpdate()
            update.localizedCallerName = name
            update.remoteHandle = CXHandle(type: .generic, value: name)
            update.hasVideo = false
            update.supportsHolding = true
            update.supportsGrouping = false
            update.supportsUngrouping = false
            update.supportsDTMF = false
            provider.reportCall(with: id, updated: update)
            return true
        } catch {
            return false
        }
    }

    func connected() {
        guard let callId else { return }
        provider.reportOutgoingCall(with: callId, connectedAt: Date())
    }

    /// The person ended the call in the app.
    func end() {
        guard let callId else { return }
        self.callId = nil
        controller.request(CXTransaction(action: CXEndCallAction(call: callId))) { [provider] error in
            if error != nil { provider.reportCall(with: callId, endedAt: Date(), reason: .remoteEnded) }
        }
    }

    /// The bot hung up, or the call failed.
    func ended(reason: CXCallEndedReason = .remoteEnded) {
        guard let callId else { return }
        self.callId = nil
        provider.reportCall(with: callId, endedAt: Date(), reason: reason)
    }

    /// Keep the system's mute button in step with the app's.
    func setMuted(_ muted: Bool) {
        guard let callId else { return }
        controller.request(CXTransaction(action: CXSetMutedCallAction(call: callId, muted: muted))) { _ in }
    }

    func setHeld(_ held: Bool) {
        guard let callId else { return }
        controller.request(CXTransaction(action: CXSetHeldCallAction(call: callId, onHold: held))) { _ in }
    }

    // MARK: - CXProviderDelegate (on the main queue)

    func providerDidReset(_ provider: CXProvider) {
        callId = nil
        let end = onEnd
        DispatchQueue.main.async { end() }
    }

    func provider(_ provider: CXProvider, perform action: CXStartCallAction) {
        try? CallAudioIO.configureSession()
        provider.reportOutgoingCall(with: action.callUUID, startedConnectingAt: Date())
        action.fulfill()
    }

    func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        let wasOurs = callId == action.callUUID || callId == nil
        callId = nil
        action.fulfill()
        guard wasOurs else { return }
        let end = onEnd
        DispatchQueue.main.async { end() }
    }

    func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
        let muted = action.isMuted
        action.fulfill()
        let mute = onMute
        DispatchQueue.main.async { mute(muted) }
    }

    func provider(_ provider: CXProvider, perform action: CXSetHeldCallAction) {
        let held = action.isOnHold
        action.fulfill()
        let hold = onHold
        DispatchQueue.main.async { hold(held) }
    }

    func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
        let activate = onActivate
        DispatchQueue.main.async { activate() }
    }

    func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
        let deactivate = onDeactivate
        DispatchQueue.main.async { deactivate() }
    }
}
