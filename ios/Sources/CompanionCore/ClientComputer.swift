import Foundation

// Client calls for the phone's native computer viewer (parity 13 and 11):
//
//   POST /api/bots/:id/computer/control     { action: take | release, controlLeaseId? }
//   POST /api/bots/:id/computer/input       { events, controlLeaseId? } -> { ok, applied }
//   GET  /api/bots/:id/computer/clipboard   ?controlLeaseId=            -> { text }
//   PUT  /api/bots/:id/computer/clipboard   { text, controlLeaseId? }   -> { ok }
//   POST /api/bots/:id/computer/screenshot                              -> { png, format }
//
// Input and clipboard need the person to hold control: 409 `no_control` or
// `control_lease` otherwise, 404 `no_computer` for a bot without a desktop.
// Those refusals come back as `ComputerError`, by the server's `code`.
public extension CompanionClient {
    /// Take control of the bot's computer (the bot's own hands are refused
    /// while the person holds it). With a lease, `owned` says whether it is ours.
    func takeComputerControl(botId: String, controlLeaseId: String?) async throws -> ComputerControlState {
        try await computerSend(computerControlRequest(botId: botId, action: "take", controlLeaseId: controlLeaseId), as: ComputerControlState.self)
    }

    /// Hand control back. With a lease, only a hold that lease owns is released.
    func releaseComputerControl(botId: String, controlLeaseId: String?) async throws -> ComputerControlState {
        try await computerSend(computerControlRequest(botId: botId, action: "release", controlLeaseId: controlLeaseId), as: ComputerControlState.self)
    }

    func computerControl(botId: String) async throws -> ComputerControlState {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        return try await computerSend(makeRequest("GET", "/api/bots/\(botId)/computer/control"), as: ComputerControlState.self)
    }

    /// Send one batch of at most 64 events.
    @discardableResult
    func computerInput(botId: String, events: [ComputerInputEvent], controlLeaseId: String?) async throws -> ComputerInputResult {
        try await computerSend(computerInputRequest(botId: botId, events: events, controlLeaseId: controlLeaseId), as: ComputerInputResult.self)
    }

    /// The remote clipboard's text.
    func computerClipboard(botId: String, controlLeaseId: String?) async throws -> String {
        try await computerSend(computerClipboardReadRequest(botId: botId, controlLeaseId: controlLeaseId), as: ComputerClipboard.self).text
    }

    /// Put `text` on the remote clipboard (16 KiB at most).
    func setComputerClipboard(botId: String, text: String, controlLeaseId: String?) async throws {
        _ = try await computerData(computerClipboardWriteRequest(botId: botId, text: text, controlLeaseId: controlLeaseId))
    }

    /// One fresh capture of the bot's desktop, for a faster picture while in control.
    func computerScreenshot(botId: String) async throws -> ComputerScreenshot {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        var request = try makeRequest("POST", "/api/bots/\(botId)/computer/screenshot", body: [:])
        request.timeoutInterval = 60
        return try await computerSend(request, as: ComputerScreenshot.self)
    }

    // MARK: Requests

    func computerControlRequest(botId: String, action: String, controlLeaseId: String?) throws -> URLRequest {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        return try makeRequest("POST", "/api/bots/\(botId)/computer/control",
                               encodedBody: ComputerControlBody(action: action, controlLeaseId: controlLeaseId))
    }

    func computerInputRequest(botId: String, events: [ComputerInputEvent], controlLeaseId: String?) throws -> URLRequest {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        guard !events.isEmpty, events.count <= ComputerInputEvent.maxBatch else { throw APIError.transport("A batch holds 1 to 64 events.") }
        return try makeRequest("POST", "/api/bots/\(botId)/computer/input",
                               encodedBody: ComputerInputBody(events: events, controlLeaseId: controlLeaseId))
    }

    func computerClipboardReadRequest(botId: String, controlLeaseId: String?) throws -> URLRequest {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        return try makeRequest("GET", "/api/bots/\(botId)/computer/clipboard",
                               query: controlLeaseId.map { [URLQueryItem(name: "controlLeaseId", value: $0)] } ?? [])
    }

    func computerClipboardWriteRequest(botId: String, text: String, controlLeaseId: String?) throws -> URLRequest {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        guard text.utf8.count <= 16 * 1024 else { throw ComputerError.other(status: nil, message: "The clipboard holds at most 16 KB of text.") }
        return try makeRequest("PUT", "/api/bots/\(botId)/computer/clipboard",
                               encodedBody: ComputerClipboardBody(text: text, controlLeaseId: controlLeaseId))
    }

    // MARK: Transport

    /// Like `send`, but a refusal keeps the server's `code` (`ComputerError`).
    private func computerSend<T: Decodable>(_ request: URLRequest, as type: T.Type) async throws -> T {
        let data = try await computerData(request)
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw ComputerError.other(status: nil, message: "The computer sent something this app couldn't read.")
        }
    }

    private func computerData(_ request: URLRequest) async throws -> Data {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await perform(request)
        } catch let APIError.transport(detail) {
            throw ComputerError.offline(detail)
        }
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            if http.statusCode == 401 { throw APIError.status(code: 401, message: nil) }
            throw ComputerError.from(status: http.statusCode, body: data)
        }
        return data
    }
}
