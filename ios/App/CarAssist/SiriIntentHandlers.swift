// Siri talks to a bot (docs/ios-carplay.md), in the app's own process
// (`application(_:handlerFor:)`, INIntentsSupported in Info.plist):
//
// - "Send a message to Scout with Sagax", and the reply to a message Siri
//   announced (the banner donated INSendMessageIntent with the bot and its
//   conversation, CommunicationNotification.swift): INSendMessageIntent.
// - "Call Scout with Sagax", and calling again from the car or the call
//   screen (the CallKit handle names the bot): INStartCallIntent, which
//   continues in the app, in the background, as a CallKit call.
//
// Works on the phone, with AirPods, and in any car through Siri, without the
// CarPlay entitlement. Who a name is: CarDirectory (CompanionCore).
import CompanionCore
import Foundation
import Intents

enum SiriPeople {
    static func person(_ contact: CarContact) -> INPerson {
        INPerson(
            personHandle: INPersonHandle(value: contact.id, type: .unknown),
            nameComponents: nil,
            displayName: contact.name,
            image: nil,
            contactIdentifier: nil,
            customIdentifier: contact.id
        )
    }

    static func ids(_ people: [INPerson]?) -> [String] {
        (people ?? []).compactMap { $0.customIdentifier ?? $0.personHandle?.value }
    }

    static func names(_ people: [INPerson]?) -> [String] {
        (people ?? []).map(\.displayName)
    }
}

final class SendMessageToBotHandler: NSObject, INSendMessageIntentHandling {
    func resolveRecipients(for intent: INSendMessageIntent) async -> [INSendMessageRecipientResolutionResult] {
        let contacts = await CarContacts.current()
        if intent.recipients?.isEmpty != false, intent.conversationIdentifier == nil {
            return [.needsValue()]
        }
        switch route(intent, in: contacts) {
        case let .one(contact): return [.success(with: SiriPeople.person(contact))]
        case let .several(found): return [.disambiguation(with: found.map(SiriPeople.person))]
        case .none: return [.unsupported()]
        }
    }

    func resolveContent(for intent: INSendMessageIntent) async -> INStringResolutionResult {
        let text = intent.content?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return text.isEmpty ? .needsValue() : .success(with: text)
    }

    func handle(intent: INSendMessageIntent) async -> INSendMessageIntentResponse {
        let text = intent.content?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let contacts = await CarContacts.current()
        guard !text.isEmpty, case let .one(contact) = route(intent, in: contacts),
              let client = await CarContacts.client()
        else { return INSendMessageIntentResponse(code: .failure, userActivity: nil) }
        do {
            // retry-safe, frozen on the conversation (as the share sheet sends)
            try await client.send(text: text, to: contact.destination, sendId: UUID().uuidString)
            return INSendMessageIntentResponse(code: .success, userActivity: nil)
        } catch {
            return INSendMessageIntentResponse(code: .failureRequiringAppLaunch, userActivity: nil)
        }
    }

    private func route(_ intent: INSendMessageIntent, in contacts: [CarContact]) -> CarMatch {
        CarDirectory.route(
            conversationId: intent.conversationIdentifier,
            personIds: SiriPeople.ids(intent.recipients),
            spokenNames: SiriPeople.names(intent.recipients) + [intent.speakableGroupName?.spokenPhrase].compactMap { $0 },
            in: contacts
        )
    }
}

final class StartCallToBotHandler: NSObject, INStartCallIntentHandling {
    func resolveContacts(for intent: INStartCallIntent) async -> [INStartCallContactResolutionResult] {
        guard let people = intent.contacts, !people.isEmpty else { return [.needsValue()] }
        let contacts = await CarContacts.current()
        let match = CarDirectory.route(conversationId: nil, personIds: SiriPeople.ids(people), spokenNames: SiriPeople.names(people), in: contacts)
        switch match {
        case let .one(contact): return [.success(with: SiriPeople.person(contact))]
        case let .several(found): return [.disambiguation(with: found.map(SiriPeople.person))]
        case .none: return [.unsupported()]
        }
    }

    func resolveCallCapability(for intent: INStartCallIntent) async -> INStartCallCallCapabilityResolutionResult {
        // a voice call only: a bot has no camera
        intent.callCapability == .videoCall ? .unsupported() : .success(with: .audioCall)
    }

    func handle(intent: INStartCallIntent) async -> INStartCallIntentResponse {
        // The CallKit call starts here, in the app's process, even when Siri
        // woke it in the background with no window (the phone locked in the
        // car). The activity Siri then hands a window asks for the same call,
        // which CallController ignores while it runs.
        let person = intent.contacts?.first
        guard let raw = person?.customIdentifier ?? person?.personHandle?.value, !raw.isEmpty else {
            return INStartCallIntentResponse(code: .failure, userActivity: nil)
        }
        let id = CarCallHandle.contactId(from: raw) ?? raw
        Task { @MainActor in await CarCalls.call(contactId: id) }
        return INStartCallIntentResponse(code: .continueInApp, userActivity: nil)
    }
}
