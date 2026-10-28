// "Reach me" (#1187): the bot's reach-me routes (ReachMe.swift). Each
// person chooses for themself; the server answers with their own view.
import Foundation

extension CompanionClient {
    /// `GET /api/bots/:id/reach-me`: the person's choice for this bot (or the
    /// default: push, any hour) and each channel's readiness.
    public func reachMe(botId: String) async throws -> ReachMeView {
        try await send(botRequest("GET", botId, "/reach-me"), as: ReachMeView.self)
    }

    /// `PUT /api/bots/:id/reach-me { channels, smsNumber?, hours }`.
    public func saveReachMe(botId: String, settings: ReachMeSettings) async throws -> ReachMeView {
        var request = try botRequest("PUT", botId, "/reach-me")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(settings)
        return try await send(request, as: ReachMeView.self)
    }

    /// `POST /api/bots/:id/reach-me/telegram { token }`: the person's own bot
    /// from BotFather, checked and sealed by the server; the answer carries
    /// the t.me link to press Start in. The token never comes back.
    public func connectReachTelegram(botId: String, token: String) async throws -> ReachMeView {
        var request = try botRequest("POST", botId, "/reach-me/telegram")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["token": token.trimmingCharacters(in: .whitespacesAndNewlines)])
        return try await send(request, as: ReachMeView.self)
    }

    /// `DELETE /api/bots/:id/reach-me/telegram`: forget that bot and chat.
    public func disconnectReachTelegram(botId: String) async throws -> ReachMeView {
        try await send(botRequest("DELETE", botId, "/reach-me/telegram"), as: ReachMeView.self)
    }
}
