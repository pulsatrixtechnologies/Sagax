// Sagax on the car's screen (docs/ios-carplay.md): a CarPlay voice-based
// conversational app. It appears in CarPlay only with Apple's entitlement
// (`com.apple.developer.carplay-voice-based-conversation`, iOS 26.4) and the
// CarPlay scene in Info.plist, both added by `project-carplay.yml`; without
// them this file is compiled and never runs.
//
// Two screens, the depth Apple allows is three:
//   1. the recent bots, by name and face, never a message (a list);
//   2. the call: CarPlay's voice screen while the bot listens, thinks or
//      speaks, with mute and hang up (iOS 26.4 action buttons).
// Choosing a bot calls it: the conversation is the voice, as the category
// requires. An approval during the call is asked aloud or waits for the
// phone (DrivingSafety); nothing on this screen asks to pick up the iPhone.
import CarPlay
import Combine
import CompanionCore
import UIKit

@MainActor
final class CarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {
    private var interface: CPInterfaceController?
    private var list: CPListTemplate?
    private var voice: CPVoiceControlTemplate?
    private var shownState: CarVoiceState?
    private var faces: [String: UIImage] = [:]
    /// bots whose face was already tried (drawn or not), never redrawn
    private var facesTried: Set<String> = []
    private var subscriptions = Set<AnyCancellable>()

    func templateApplicationScene(_ scene: CPTemplateApplicationScene, didConnect interfaceController: CPInterfaceController) {
        CarRoute.carPlayConnected = true
        interface = interfaceController
        let session = SessionHub.session
        session.connect()

        let list = CPListTemplate(title: "Sagax", sections: [])
        list.emptyViewTitleVariants = [String(localized: "No bots yet")]
        list.emptyViewSubtitleVariants = [String(localized: "Your bots appear here once Sagax is connected.")]
        self.list = list
        interfaceController.setRootTemplate(list, animated: false, completion: nil)
        reload(session.state)

        // the list follows the fleet, calmly (no faster than every 2 s)
        session.statePublisher
            .debounce(for: .seconds(2), scheduler: DispatchQueue.main)
            .sink { [weak self] state in self?.reload(state) }
            .store(in: &subscriptions)

        // a call, wherever it started (the car, Siri, the phone): its voice
        // screen is shown while it runs, as the category requires
        let call = CallController.shared
        call.$target.combineLatest(call.$state)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] target, state in self?.follow(target: target, state: state) }
            .store(in: &subscriptions)
        call.$unavailable
            .receive(on: DispatchQueue.main)
            .sink { [weak self] unavailable in
                guard let unavailable else { return }
                self?.alert(unavailable.title)
            }
            .store(in: &subscriptions)
    }

    func templateApplicationScene(_ scene: CPTemplateApplicationScene, didDisconnect interfaceController: CPInterfaceController) {
        CarRoute.carPlayConnected = false
        subscriptions.removeAll()
        interface = nil
        list = nil
        voice = nil
        shownState = nil
        faces = [:]
        facesTried = []
    }

    // MARK: - The list

    private func reload(_ state: CompanionState) {
        guard let list else { return }
        let bots = CarDirectory.recentBots(CarDirectory.contacts(bots: state.bots))
        let limit = min(CPListTemplate.maximumItemCount, CarDirectory.carLimit)
        let items: [CPListItem] = bots.prefix(limit).map { contact in
            let item = CPListItem(text: contact.name, detailText: nil, image: faces[contact.id] ?? UIImage(systemName: "waveform.circle.fill"))
            item.handler = { [weak self] _, done in
                self?.call(contact)
                done()
            }
            return item
        }
        list.updateSections([CPListSection(items: items, header: String(localized: "Call a bot"), sectionIndexTitle: nil)])
        loadFaces(bots, state: state)
    }

    /// Each bot's mascot, drawn once (the notification's face).
    private func loadFaces(_ bots: [CarContact], state: CompanionState) {
        let missing = bots.filter { !facesTried.contains($0.id) }.compactMap { state.bot($0.id) }
        guard !missing.isEmpty else { return }
        for bot in missing {
            facesTried.insert(bot.id)
            if let data = MascotAvatarRenderer.render(PushSenderLook(bot: bot)), let image = UIImage(data: data, scale: MascotAvatarRenderer.scale) {
                faces[bot.id] = image
            }
        }
        reload(state)
    }

    private func call(_ contact: CarContact) {
        Task { await CarCalls.call(contactId: contact.id) }
    }

    // MARK: - The call

    private func follow(target: Chat?, state: CallState) {
        guard let interface else { return }
        guard target != nil, let carState = CarVoiceState(state) else {
            if voice != nil {
                voice = nil
                shownState = nil
                interface.popToRootTemplate(animated: true, completion: nil)
            }
            return
        }
        if voice == nil {
            let template = CPVoiceControlTemplate(voiceControlStates: CarVoiceState.allCases.map(voiceState))
            voice = template
            interface.pushTemplate(template, animated: true, completion: nil)
        }
        if shownState != carState {
            shownState = carState
            voice?.activateVoiceControlState(withIdentifier: carState.rawValue)
        }
    }

    private func voiceState(_ state: CarVoiceState) -> CPVoiceControlState {
        let (title, symbol): (String, String) = switch state {
        case .connecting: (String(localized: "Calling…"), "phone.arrow.up.right")
        case .listening: (String(localized: "Listening"), "waveform")
        case .thinking: (String(localized: "Thinking…"), "ellipsis")
        case .speaking: (String(localized: "Speaking"), "speaker.wave.2.fill")
        case .paused: (String(localized: "Microphone off"), "mic.slash.fill")
        }
        let image = UIImage(systemName: symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: 72, weight: .regular))
        let voiceState = CPVoiceControlState(identifier: state.rawValue, titleVariants: [title], image: image, repeats: state != .paused)
        if #available(iOS 26.4, *) {
            voiceState.actionButtons = [muteButton(paused: state == .paused), hangUpButton()]
        }
        return voiceState
    }

    private func muteButton(paused: Bool) -> CPButton {
        let symbol = paused ? "mic.fill" : "mic.slash.fill"
        return CPButton(image: UIImage(systemName: symbol) ?? UIImage()) { _ in
            let call = CallController.shared
            call.setMuted(!call.state.muted)
        }
    }

    private func hangUpButton() -> CPButton {
        CPButton(image: UIImage(systemName: "phone.down.fill") ?? UIImage()) { _ in
            CallController.shared.end()
        }
    }

    /// A call that could not start: its title only. The details are for
    /// the phone, later; nothing here asks to pick it up.
    private func alert(_ title: String) {
        guard let interface else { return }
        let alert = CPAlertTemplate(titleVariants: [title], actions: [
            CPAlertAction(title: String(localized: "OK"), style: .cancel) { [weak interface] _ in
                interface?.dismissTemplate(animated: true, completion: nil)
            },
        ])
        interface.presentTemplate(alert, animated: true, completion: nil)
    }
}
