import Foundation

public extension CompanionClient {
    /// `POST /api/youtube/transcript` — public captions, session auth.
    func youtubeTranscript(videoId: String) async throws -> YouTubeTranscriptResponse {
        guard videoId.range(of: #"^[\w-]{11}$"#, options: .regularExpression) != nil else { throw APIError.badURL }
        return try await send(
            makeRequest("POST", "/api/youtube/transcript", body: ["videoId": videoId]),
            as: YouTubeTranscriptResponse.self
        )
    }
}
