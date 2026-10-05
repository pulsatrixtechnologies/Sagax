import Foundation

// Client calls for the home screens of the visual-parity pass: create a bot
// with its name and look (20), pin a group (01), and the defensive fallbacks
// those need while the server catches up.

/// What the create-bot sheet sends: a name and the character it picked,
/// and, from its More options (WP13, NB2-NB4), the starting preset, the
/// team, the title, the description and the standing instructions. A `nil`
/// field is not sent, so the server's New bot defaults apply to it.
public struct NewBotDraft: Equatable, Sendable {
    public var name: String
    /// One of the twelve `MausColors` names.
    public var color: String
    public var look: MascotLook
    public var skin: MascotSkin
    public var title: String?
    public var description: String?
    /// Standing instructions (the bot's SOUL.md).
    public var soul: String?
    /// The team; "" is General.
    public var section: String?
    /// A preset id from `GET /api/bot-presets`: the server adds its skills,
    /// starter notes and playbooks.
    public var preset: String?
    /// A preset's legacy owl body and expression (`presetDraftPatch`).
    public var mascotBody: String?
    public var mascotExpression: String?

    public init(
        name: String, color: String = "green", look: MascotLook = .owl, skin: MascotSkin = .none,
        title: String? = nil, description: String? = nil, soul: String? = nil, section: String? = nil,
        preset: String? = nil, mascotBody: String? = nil, mascotExpression: String? = nil
    ) {
        self.name = name
        self.color = color
        self.look = look
        self.skin = skin
        self.title = title
        self.description = description
        self.soul = soul
        self.section = section
        self.preset = preset
        self.mascotBody = mascotBody
        self.mascotExpression = mascotExpression
    }

    public var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

    /// Anything other than the default owl with no skin needs the look sent.
    public var hasCustomLook: Bool { look != .owl || skin != .none }
}

/// `POST /api/bots` body: the name, title, description, team and preset at
/// the top (as the desktop's `createConfiguredBot` sends them), the look and
/// the standing instructions under `settings` (the server's
/// `botDefaultsProfileSchema`, which is strict).
struct NewBotBody: Encodable {
    struct Settings: Encodable {
        var color: String
        var mascotLook: MascotLook?
        var mascotSkin: MascotSkin?
        var mascotBody: String?
        var mascotExpression: String?
        var soul: String?
    }

    var name: String
    var title: String?
    var description: String?
    var section: String?
    var preset: String?
    var settings: Settings
}

/// `PATCH /api/groups/:id` with `pinned` only.
struct GroupPinBody: Encodable {
    var pinned: Bool
}

struct GroupResponse: Decodable {
    var group: Room
}

public extension CompanionClient {
    /// The request for a new bot. `includeLook` false sends the colour only,
    /// for a server that does not take a look at create time yet.
    func createBotRequest(_ draft: NewBotDraft, includeLook: Bool) throws -> URLRequest {
        let name = draft.trimmedName
        guard !name.isEmpty else { throw APIError.badURL }
        let settings = NewBotBody.Settings(
            color: draft.color,
            mascotLook: includeLook && draft.look != .owl ? draft.look : nil,
            mascotSkin: includeLook && draft.skin != .none ? draft.skin : nil,
            mascotBody: draft.mascotBody,
            mascotExpression: draft.mascotExpression,
            soul: draft.soul
        )
        let body = NewBotBody(
            name: name, title: draft.title, description: draft.description,
            section: draft.section, preset: draft.preset, settings: settings
        )
        return try makeRequest("POST", "/api/bots", encodedBody: body)
    }

    /// Make a bot with a name and a look. A server that refuses the look at
    /// create time (400 on the strict settings schema) gets the plain create
    /// and then a `PATCH /api/bots/:id` with the look, so the result is the
    /// same bot either way.
    func createBot(_ draft: NewBotDraft) async throws -> Bot {
        guard draft.hasCustomLook else {
            return try await send(createBotRequest(draft, includeLook: false), as: CreatedBot.self).bot
        }
        do {
            return try await send(createBotRequest(draft, includeLook: true), as: CreatedBot.self).bot
        } catch let APIError.status(code, _) where code == 400 {
            let bot = try await send(createBotRequest(draft, includeLook: false), as: CreatedBot.self).bot
            let patch = BotPatch(
                mascotLook: draft.look != .owl ? draft.look : nil,
                mascotSkin: draft.skin != .none ? draft.skin : nil
            )
            guard !patch.isEmpty else { return bot }
            return try await patchBot(botId: bot.id, patch: patch)
        }
    }

    func setGroupPinnedRequest(groupId: String, pinned: Bool) throws -> URLRequest {
        guard Self.validRouteID(groupId) else { throw APIError.badURL }
        return try makeRequest("PATCH", "/api/groups/\(groupId)", encodedBody: GroupPinBody(pinned: pinned))
    }

    /// Pin or unpin a group on the home row. Throws `GroupPinUnsupported`
    /// when the server answered but did not keep the flag, which is how a
    /// server without group pins answers an admin.
    func setGroupPinned(groupId: String, pinned: Bool) async throws -> Room {
        let room = try await send(setGroupPinnedRequest(groupId: groupId, pinned: pinned), as: GroupResponse.self).group
        guard (room.pinned ?? false) == pinned else { throw GroupPinUnsupported() }
        return room
    }
}

/// The server took the request but has no group pins.
public struct GroupPinUnsupported: Error, Equatable, Sendable {
    public init() {}
}
