// A bot reads or changes a setting this iPhone keeps (#1545,
// CompanionCore/DeviceSettings.swift): fetch the requests the server's
// `device-settings` frame announced and answer each once.
import CompanionCore
import Foundation

extension Session {
    func answerDeviceSettings() async {
        var requests: [DeviceSettingRequest] = []
        await perform(quietly: true) { client in requests = try await client.deviceSettingRequests() }
        for request in requests {
            let answer = DeviceSettings.answer(request, defaults: .standard)
            await perform(quietly: true) { client in try await client.answerDeviceSetting(id: request.id, answer: answer) }
        }
    }
}
