// The demo's made-up workspace: four bots, a group with a person and two
// bots, an approval waiting on you, a working bot with a computer, and a
// routine. Generic names only, no real data. Every time is an offset from
// `now`, so a fixed clock gives identical screens.
import Foundation

struct DemoFixture {
    let bots: [Bot]
    let rooms: [Room]
    let routines: [Routine]
    let runs: [RoutineRun]

    init(now: Date) {
        let base = (now.timeIntervalSince1970 * 1000).rounded()
        func ago(_ minutes: Double) -> Double { base - minutes * 60_000 }
        let model: [String: Any] = ["instanceId": "demo", "model": "demo"]

        func bot(_ id: String, _ name: String, _ title: String, _ description: String, color: String, section: String, look: [String: Any]? = nil, skin: String? = nil, extra: [String: Any] = [:], task: String, messages: [[String: Any]]) -> [String: Any] {
            var value: [String: Any] = [
                "id": "demo-\(id)", "threadId": "demo-thread-\(id)", "name": name, "title": title,
                "description": description, "notifications": true, "color": color, "unread": false,
                "modelSelection": model, "createdAt": ago(60 * 24 * 30), "section": section,
                "tasks": [["threadId": "demo-thread-\(id)", "title": task, "createdAt": ago(60 * 24)]],
                "messages": messages,
                "activeLeafId": messages.last?["id"] ?? NSNull(),
            ]
            if let look { value["mascotLook"] = look }
            if let skin { value["mascotSkin"] = skin }
            for (key, item) in extra { value[key] = item }
            return value
        }
        func text(_ id: String, _ role: String, _ minutes: Double, _ body: String, parent: String? = nil) -> [String: Any] {
            var value: [String: Any] = ["id": id, "role": role, "kind": "text", "at": ago(minutes), "text": body]
            if let parent { value["parentId"] = parent }
            return value
        }

        let atlas = bot("atlas", "Atlas", "", "Keeps the team on track and writes the weekly plan.", color: "blue", section: "Launch", extra: ["chiefOfStaff": true, "pinned": true], task: "Weekly plan", messages: [
            text("atlas-1", "user", 95, "What should the team focus on this week?"),
            text("atlas-2", "bot", 94, "Three things, in order:\n\n- **Ship the iOS beta** to internal testers (Scout is waiting on your approval).\n- **Finish the onboarding screens** with Pixel.\n- **Keep the release build green**: Forge is running the checks now.\n\nI'll send you a summary on Friday.", parent: "atlas-1"),
        ])
        let scout = bot("scout", "Scout", "Researcher", "Finds the facts and brings back sources.", color: "cyan", section: "Launch", extra: ["unread": true, "activity": "waiting-on-you"], task: "TestFlight checklist", messages: [
            text("scout-1", "user", 30, "Compare the TestFlight checklist with Apple's requirements, then upload the build."),
            text("scout-2", "bot", 28, "Signing, privacy declarations and review notes all check out. One step needs your approval before I continue.", parent: "scout-1"),
            [
                "id": "scout-approval", "role": "bot", "kind": "options", "at": ago(27), "parentId": "scout-2",
                "card": [
                    "title": "Approval needed",
                    "subtitle": "Upload build 12 to TestFlight for internal testing?",
                    "options": ["Allow", "Deny"],
                    "requestId": "demo-request-testflight",
                    "tool": "App Store Connect",
                    "allowKey": "testflight:upload",
                ] as [String: Any],
            ],
        ])
        let pixel = bot("pixel", "Pixel", "Designer", "Shapes polished product experiences.", color: "purple", section: "Launch", look: ["character": "shape", "shape": "cloud"], task: "Onboarding screens", messages: [
            text("pixel-1", "user", 240, "Can you tighten the welcome screen?"),
            text("pixel-2", "bot", 238, "Done. One owl, three clear choices, and the demo is one tap away. I kept the dark theme and the 16 pt card corners.", parent: "pixel-1"),
        ])
        let forge = bot("forge", "Forge", "Engineer", "Builds and verifies releases.", color: "orange", section: "Engineering", skin: "neon", extra: ["busy": true, "activity": "working", "computer": "local"], task: "Release build", messages: [
            text("forge-1", "user", 12, "Run the full release verification."),
            text("forge-2", "bot", 11, "Building the signed archive and running the test suite on my computer. You can watch it live from the Computer view.", parent: "forge-1"),
        ])

        let roomMessages: [[String: Any]] = [
            ["id": "room-1", "role": "bot", "kind": "text", "at": ago(50), "text": "Morning! The beta notes are in the shared doc, can someone check the French?", "from": ["botId": "person-sam", "name": "Sam Rivera", "color": "teal"]],
            ["id": "room-2", "role": "bot", "kind": "text", "at": ago(49), "text": "On it. Two small fixes: \"connexion\" and the accents in the title.", "parentId": "room-1", "from": ["botId": "demo-pixel", "name": "Pixel", "color": "purple"]],
            ["id": "room-3", "role": "user", "kind": "text", "at": ago(45), "text": "@Atlas add the beta to Friday's summary please.", "parentId": "room-2"],
            ["id": "room-4", "role": "bot", "kind": "text", "at": ago(44), "text": "Added. I'll include who tested what.", "parentId": "room-3", "from": ["botId": "demo-atlas", "name": "Atlas", "color": "blue"]],
        ]
        let room: [String: Any] = [
            "id": "demo-launch-room", "threadId": "demo-thread-launch-room", "name": "Launch room",
            "memberIds": ["demo-atlas", "demo-pixel"], "defaultResponder": ["kind": "mentions"],
            "bulletin": "Coordinate the beta with Sam Rivera.", "unread": true, "createdAt": ago(60 * 24 * 7),
            "section": "Launch", "pinned": true,
            "tasks": [["threadId": "demo-thread-launch-room", "title": "Beta launch", "createdAt": ago(60 * 24 * 7)]],
            "messages": roomMessages,
        ]

        let decoder = JSONDecoder()
        func decode<T: Decodable>(_ value: Any, as: T.Type) -> T {
            // The fixture is a constant: failing to decode it is a bug in
            // this file, caught by DemoModeTests.
            let data = try! JSONSerialization.data(withJSONObject: value)
            return try! decoder.decode(T.self, from: data)
        }
        bots = [atlas, scout, pixel, forge].map { decode($0, as: Bot.self) }
        rooms = [decode(room, as: Room.self)]
        let routine: [String: Any] = [
            "id": "demo-routine-digest", "name": "Morning digest", "botId": "demo-atlas", "runOn": "computer",
            "prompt": "Summarize what every bot did yesterday and what needs me today.",
            "enabled": true, "schedule": ["type": "daily", "time": "08:30", "weekdays": [1, 2, 3, 4, 5]],
            "durationMinutes": 10, "nextRunAt": base + 60 * 60_000 * 18, "createdAt": ago(60 * 24 * 14), "updatedAt": ago(60 * 24 * 2),
        ]
        routines = [decode(routine, as: Routine.self)]
        let run: [String: Any] = [
            "id": "demo-run-1", "routineId": "demo-routine-digest", "routineName": "Morning digest", "botId": "demo-atlas",
            "runOn": "computer", "scheduledFor": ago(60 * 6), "status": "succeeded", "manual": false,
            "startedAt": ago(60 * 6), "finishedAt": ago(60 * 6 - 2), "output": "Four bots active, one approval waiting (Scout).", "createdAt": ago(60 * 6),
        ]
        runs = [decode(run, as: RoutineRun.self)]
    }

    /// A canned reply, chosen from the words of the message so the demo
    /// answers the same way every time.
    static func reply(to text: String, from name: String) -> String {
        let lower = text.lowercased()
        if lower.contains("status") || lower.contains("update") || lower.contains("où en") {
            return "Here's where things stand: the release build is green, the onboarding screens are ready for review, and one approval is waiting for you in Scout's chat."
        }
        if lower.contains("bonjour") || lower.contains("salut") || lower.contains("merci") {
            return "Avec plaisir ! Ceci est une démo : je réponds avec des messages préparés, rien n'est envoyé nulle part."
        }
        if lower.contains("hello") || lower.contains("hi") || lower.contains("thanks") {
            return "Hi! This is the demo, so \(name) answers with prepared replies and nothing leaves your phone. Connect a computer to talk to your real bots."
        }
        return "Got it. In the demo, \(name) only pretends to work on \"\(text.prefix(60))\". Connect a computer or sign in to your organization and your real bots will take it from here."
    }
}
