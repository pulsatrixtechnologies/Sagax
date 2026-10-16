// Security keys for sensitive approvals (wave 2, package E; server
// shared/step-up.ts, server/routes/security-keys.ts). When the person chose
// that a kind of approval needs one of their keys, the server refuses the
// Allow with `step_up_required` and names what to sign. The phone starts
// that step-up, the person signs it on the server's own ceremony page in an
// AuthenticationServices sheet (a passkey with Face ID, or a security key),
// and the same answer goes again with the step-up's id. The server verifies
// everything; nothing here decides.
import Foundation

/// The server asked for the person's security key before this Allow.
public struct StepUpRequired: Error, LocalizedError, Sendable, Equatable {
    /// What to sign, exactly as the server named it (JSON object).
    public let target: Data
    public let message: String?
    /// `step_up_failed`: a step-up was sent and did not count.
    public let failed: Bool

    public var errorDescription: String? { message ?? "This approval needs your security key." }
}

/// A started step-up: the ceremony page the sheet opens.
public struct StepUpStart: Decodable, Sendable, Equatable {
    public let ceremonyId: String
    public let pageUrl: String
    public let rpId: String
}

extension CompanionClient {
    private struct StepUpBody: Decodable {
        let code: String?
        let error: String?
    }

    /// Throws `StepUpRequired` for a step-up refusal, else what `check` throws.
    static func checkStepUp(_ response: URLResponse, _ data: Data) throws {
        if let http = response as? HTTPURLResponse, http.statusCode == 403,
           let body = try? JSONDecoder().decode(StepUpBody.self, from: data),
           body.code == "step_up_required" || body.code == "step_up_failed",
           let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let target = object["target"], JSONSerialization.isValidJSONObject(target),
           let targetData = try? JSONSerialization.data(withJSONObject: target, options: [.sortedKeys]) {
            throw StepUpRequired(target: targetData, message: body.error, failed: body.code == "step_up_failed")
        }
        try check(response, data)
    }

    /// `POST /api/security-keys/begin` for the target a refusal named.
    public func beginStepUp(target: Data) async throws -> StepUpStart {
        guard let object = try JSONSerialization.jsonObject(with: target) as? [String: Any] else { throw APIError.badURL }
        let (data, response) = try await perform(try makeRequest("POST", "/api/security-keys/begin", body: ["target": object, "via": "page"]))
        try Self.check(response, data)
        return try JSONDecoder().decode(StepUpStart.self, from: data)
    }

    /// The ceremony page on this server, in its phone form: it ends on
    /// `sagax://security-key-done`. Only an https server can run it (a
    /// passkey never answers an IP address or plain http).
    public func stepUpPageURL(_ start: StepUpStart) -> URL? {
        guard let base = connection.baseURL, base.scheme == "https",
              start.pageUrl.hasPrefix("/api/security-keys/ceremony/"),
              var components = URLComponents(url: base, resolvingAgainstBaseURL: false)
        else { return nil }
        components.path = start.pageUrl
        components.queryItems = [URLQueryItem(name: "phone", value: "1")]
        return components.url
    }

    /// Whether the sheet's return address says the key answered.
    public static func stepUpSucceeded(_ callback: URL?, ceremonyId: String) -> Bool {
        guard let callback, callback.scheme == "sagax", callback.host == "security-key-done",
              let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems
        else { return false }
        return items.first(where: { $0.name == "status" })?.value == "ok"
            && items.first(where: { $0.name == "ceremony" })?.value == ceremonyId
    }
}
