// HD mascots on the phone (#968): a character that ships painted art draws
// it instead of its vector look while the person keeps "HD mascots" on, as
// on the desktop (src/components/hd-mascots/). Today only Shiba. The art is
// the desktop's own files (src/assets/mascots/<character>/, animated WebP
// and WebP with alpha), bundled as they are; the manifests and the state
// map are generated from the desktop's (`HdMascotData`). The pure choices
// live here, for the tests; App/Mascots/HdMascotView.swift draws.
import Foundation

/// What a state shows: a loop (with the still it falls back on), or a still only (`HdKey`).
public enum HdKey: Equatable, Sendable {
    case loop(HdLoop)
    case still(HdStill)
}

public struct HdManifest: Sendable {
    /// The art's folder in the app bundle.
    public var folder: String
    /// Every asset is this many pixels square, the character framed the same in each.
    public var px: Int
    public var loops: [HdLoop: String]
    public var stills: [HdStill: String]
    /// The still each loop shows under reduced motion, in small boxes, or when the loop fails.
    public var loopStill: [HdLoop: HdStill]
}

/// The asset to draw (`HdAsset`): a loop or a still, with the still behind it.
public struct HdAsset: Equatable, Sendable {
    public enum Kind: String, Sendable { case loop, still }
    public var kind: Kind
    /// The file (bundle name without the extension).
    public var file: String
    /// The still behind a loop, or the still itself.
    public var still: String
}

public enum HdMascots {
    /// The person's switch (`sagax.hdMascots.v1`: `on` | `off`, absent is on), shared with the desktop.
    public static let preferenceKey = "sagax.hdMascots.v1"

    /// The switch as the desktop reads it from its preferences.
    public static func enabled(_ value: String?) -> Bool { value != "off" }

    public static func manifest(for character: MascotCharacter) -> HdManifest? { HdMascotData.manifests[character] }

    /// The characters with HD art (the row in Appearance shows while there is one).
    public static var characters: [MascotCharacter] { MascotCharacter.allCases.filter { HdMascotData.manifests[$0] != nil } }

    /// An app state's art; an unknown or absent state is the idle loop (`hdKeyForState`).
    public static func key(forState state: String?) -> HdKey {
        guard let state, let key = HdMascotData.stateMap[state] else { return .loop(.idle) }
        return key
    }

    /// The loop when it may move (animated, no reduced motion, a box of
    /// `loopMinSize` or more), otherwise its still (`hdAssetFor`).
    public static func asset(_ manifest: HdManifest, _ key: HdKey, moving: Bool, size: Double) -> HdAsset? {
        switch key {
        case let .still(id):
            guard let file = manifest.stills[id] else { return nil }
            return HdAsset(kind: .still, file: file, still: file)
        case let .loop(id):
            guard let stillID = manifest.loopStill[id], let still = manifest.stills[stillID] else { return nil }
            if moving, size >= HdMascotData.loopMinSize, let loop = manifest.loops[id] {
                return HdAsset(kind: .loop, file: loop, still: still)
            }
            return HdAsset(kind: .still, file: still, still: still)
        }
    }
}

// MARK: - Synced with the person's other devices

extension CompanionClient {
    /// The switch as the person's organization keeps it (`/api/me/preferences`),
    /// or nil when the server keeps none (a personal computer, or never set).
    public func hdMascotsPreference() async -> String? {
        guard let record = try? await preferences() else { return nil }
        return record.preferences[HdMascots.preferenceKey]
    }

    /// Writes the switch beside the person's other preferences (the record is
    /// replaced whole, so it is read first). A personal computer has no such
    /// record: the choice stays on this phone.
    public func saveHdMascotsPreference(_ on: Bool) async {
        guard var record = try? await preferences().preferences else { return }
        record[HdMascots.preferenceKey] = on ? "on" : "off"
        _ = try? await putPreferences(record)
    }
}
