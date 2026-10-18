// The demo's made-up workspace: four bots, a group with a person and two
// bots, an approval waiting on you, a working bot with a computer, and a
// week of routines. Generic names only, no real data. Every time is an
// offset from `now`, so a fixed clock gives identical screens. The words
// follow the interface's language (`DemoLanguage`): French when the app is
// in French, English otherwise.
import Foundation

/// The language the demo's made-up data is written in.
public enum DemoLanguage: String, Sendable, CaseIterable {
    case english = "en"
    case french = "fr"

    /// French for any French interface (fr, fr-CA, fr_FR); English for
    /// every other language, which the demo has no words for.
    public init(identifier: String?) {
        let code = (identifier ?? "").lowercased()
        self = code == "fr" || code.hasPrefix("fr-") || code.hasPrefix("fr_") ? .french : .english
    }

    /// The English or the French words.
    public func pick(_ english: String, _ french: String) -> String {
        self == .french ? french : english
    }
}

struct DemoFixture {
    let bots: [Bot]
    let rooms: [Room]
    let routines: [Routine]
    let runs: [RoutineRun]
    let sections: [String]

    init(now: Date, language: DemoLanguage = .english, calendar: Calendar = .current) {
        let t = language.pick
        let base = (now.timeIntervalSince1970 * 1000).rounded()
        func ago(_ minutes: Double) -> Double { base - minutes * 60_000 }
        let model: [String: Any] = ["instanceId": "demo", "model": "demo"]
        let launch = t("Launch", "Lancement")
        let engineering = t("Engineering", "Ingénierie")
        sections = [launch, engineering]

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

        let atlas = bot("atlas", "Atlas", "", t("Keeps the team on track and writes the weekly plan.", "Garde l'équipe sur la bonne voie et écrit le plan de la semaine."), color: "blue", section: launch, extra: ["chiefOfStaff": true, "pinned": true], task: t("Weekly plan", "Plan de la semaine"), messages: [
            text("atlas-1", "user", 95, t("What should the team focus on this week?", "Sur quoi l'équipe doit-elle se concentrer cette semaine?")),
            text("atlas-2", "bot", 94, t(
                "Three things, in order:\n\n- **Ship the iOS beta** to internal testers (Scout is waiting on your approval).\n- **Finish the onboarding screens** with Pixel.\n- **Keep the release build green**: Forge is running the checks now.\n\nI'll send you a summary on Friday.",
                "Trois choses, dans l'ordre :\n\n- **Livrer la bêta iOS** aux testeurs internes (Scout attend ton approbation).\n- **Terminer les écrans d'accueil** avec Pixel.\n- **Garder le build de version au vert** : Forge lance les vérifications en ce moment.\n\nJe t'envoie un résumé vendredi."
            ), parent: "atlas-1"),
        ])
        let scout = bot("scout", "Scout", t("Researcher", "Recherchiste"), t("Finds the facts and brings back sources.", "Trouve les faits et rapporte ses sources."), color: "cyan", section: launch, extra: ["unread": true, "activity": "waiting-on-you"], task: t("TestFlight checklist", "Liste de contrôle TestFlight"), messages: [
            text("scout-1", "user", 30, t("Compare the TestFlight checklist with Apple's requirements, then upload the build.", "Compare la liste de contrôle TestFlight avec les exigences d'Apple, puis téléverse le build.")),
            text("scout-2", "bot", 28, t("Signing, privacy declarations and review notes all check out. One step needs your approval before I continue.", "La signature, les déclarations de confidentialité et les notes de revue sont en ordre. Une étape demande ton approbation avant que je continue."), parent: "scout-1"),
            [
                "id": "scout-approval", "role": "bot", "kind": "options", "at": ago(27), "parentId": "scout-2",
                "card": [
                    "title": t("Approval needed", "Approbation requise"),
                    "subtitle": t("Upload build 12 to TestFlight for internal testing?", "Téléverser le build 12 dans TestFlight pour les tests internes?"),
                    "options": ["Allow", "Deny"],
                    "requestId": "demo-request-testflight",
                    "tool": "App Store Connect",
                    "allowKey": "testflight:upload",
                ] as [String: Any],
            ],
        ])
        let pixel = bot("pixel", "Pixel", t("Designer", "Designer"), t("Shapes polished product experiences.", "Façonne des expériences produit soignées."), color: "purple", section: launch, task: t("Onboarding screens", "Écrans d'accueil"), messages: [
            text("pixel-1", "user", 240, t("Can you tighten the welcome screen?", "Peux-tu resserrer l'écran d'accueil?")),
            text("pixel-2", "bot", 238, t(
                "Done. One owl, three clear choices, and the demo is one tap away. I kept the dark theme and the 16 pt card corners.",
                "C'est fait. Un hibou, trois choix clairs, et la démo est à portée de doigt. J'ai gardé le thème sombre et les coins de carte de 16 pt."
            ), parent: "pixel-1"),
        ])
        let forge = bot("forge", "Forge", t("Engineer", "Ingénieur"), t("Builds and verifies releases.", "Construit et vérifie les versions."), color: "orange", section: engineering, skin: "neon", extra: ["busy": true, "activity": "working", "computer": "local"], task: t("Release build", "Build de version"), messages: [
            text("forge-1", "user", 12, t("Run the full release verification.", "Lance la vérification complète de la version.")),
            text("forge-2", "bot", 11, t(
                "Building the signed archive and running the test suite on my computer. You can watch it live from the Computer view.",
                "Je construis l'archive signée et je lance la suite de tests sur mon ordinateur. Tu peux suivre en direct dans la vue Ordinateur."
            ), parent: "forge-1"),
        ])

        let roomMessages: [[String: Any]] = [
            ["id": "room-1", "role": "bot", "kind": "text", "at": ago(50), "text": t("Morning! The beta notes are in the shared doc, can someone check the French?", "Bon matin ! Les notes de la bêta sont dans le document partagé, quelqu'un peut relire l'anglais?"), "from": ["botId": "person-sam", "name": "Sam Rivera", "color": "teal"]],
            ["id": "room-2", "role": "bot", "kind": "text", "at": ago(49), "text": t("On it. Two small fixes: \"connexion\" and the accents in the title.", "Je m'en occupe. Deux petites corrections : « sign in » et la majuscule du titre."), "parentId": "room-1", "from": ["botId": "demo-pixel", "name": "Pixel", "color": "purple"]],
            ["id": "room-3", "role": "user", "kind": "text", "at": ago(45), "text": t("@Atlas add the beta to Friday's summary please.", "@Atlas ajoute la bêta au résumé de vendredi, s'il te plaît."), "parentId": "room-2"],
            ["id": "room-4", "role": "bot", "kind": "text", "at": ago(44), "text": t("Added. I'll include who tested what.", "Ajouté. J'indiquerai qui a testé quoi."), "parentId": "room-3", "from": ["botId": "demo-atlas", "name": "Atlas", "color": "blue"]],
        ]
        let room: [String: Any] = [
            "id": "demo-launch-room", "threadId": "demo-thread-launch-room", "name": t("Launch room", "Salon de lancement"),
            "memberIds": ["demo-atlas", "demo-pixel"], "defaultResponder": ["kind": "mentions"],
            "bulletin": t("Coordinate the beta with Sam Rivera.", "Coordonner la bêta avec Sam Rivera."), "unread": true, "createdAt": ago(60 * 24 * 7),
            "section": launch, "pinned": true,
            "tasks": [["threadId": "demo-thread-launch-room", "title": t("Beta launch", "Lancement de la bêta"), "createdAt": ago(60 * 24 * 7)]],
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

        // A week of routines: every day of the week has at least two, so the
        // Automations calendar is never empty, whatever day the demo opens.
        let plans = DemoFixture.routinePlans(language)
        let created = ago(60 * 24 * 14)
        routines = plans.map { plan in
            decode([
                "id": plan.id, "name": plan.name, "botId": plan.botId, "runOn": "computer",
                "prompt": plan.prompt, "enabled": true,
                "schedule": ["type": "daily", "time": plan.time, "weekdays": plan.weekdays],
                "durationMinutes": plan.minutes,
                "nextRunAt": DemoFixture.nextRun(plan, after: now, calendar: calendar).map { ($0.timeIntervalSince1970 * 1000).rounded() } ?? NSNull(),
                "createdAt": created, "updatedAt": ago(60 * 24 * 2),
            ] as [String: Any], as: Routine.self)
        }
        // The run log: what already ran over the last seven days.
        var runValues: [[String: Any]] = []
        let today = calendar.startOfDay(for: now)
        for back in (0..<7).reversed() {
            guard let day = calendar.date(byAdding: .day, value: -back, to: today) else { continue }
            for plan in plans {
                guard let at = DemoFixture.occurrence(plan, on: day, calendar: calendar), at < now else { continue }
                let ms = (at.timeIntervalSince1970 * 1000).rounded()
                runValues.append([
                    "id": "demo-run-\(plan.id)-\(back)", "routineId": plan.id, "routineName": plan.name, "botId": plan.botId,
                    "runOn": "computer", "scheduledFor": ms, "status": "succeeded", "manual": false,
                    "startedAt": ms, "finishedAt": ms + Double(plan.minutes) * 60_000, "output": plan.output, "createdAt": ms,
                ])
            }
        }
        runs = runValues.map { decode($0, as: RoutineRun.self) }
    }

    struct RoutinePlan {
        var id: String
        var name: String
        var botId: String
        var prompt: String
        var time: String
        /// 0 is Sunday, as `RoutineSchedule.weekdays`.
        var weekdays: [Int]
        var minutes: Int
        var output: String
    }

    static func routinePlans(_ language: DemoLanguage) -> [RoutinePlan] {
        let t = language.pick
        let everyDay = Array(0...6)
        return [
            RoutinePlan(
                id: "demo-routine-digest", name: t("Morning digest", "Résumé du matin"), botId: "demo-atlas",
                prompt: t("Summarize what every bot did yesterday and what needs me today.", "Résume ce que chaque bot a fait hier et ce qui m'attend aujourd'hui."),
                time: "08:30", weekdays: everyDay, minutes: 10,
                output: t("Four bots active, one approval waiting (Scout).", "Quatre bots actifs, une approbation en attente (Scout).")
            ),
            RoutinePlan(
                id: "demo-routine-triage", name: t("Inbox triage", "Tri des demandes"), botId: "demo-scout",
                prompt: t("Sort the new requests and flag the urgent ones.", "Classe les nouvelles demandes et signale les urgentes."),
                time: "11:00", weekdays: [1, 2, 3, 4, 5], minutes: 15,
                output: t("Six requests sorted, one marked urgent.", "Six demandes classées, une marquée urgente.")
            ),
            RoutinePlan(
                id: "demo-routine-inspiration", name: t("Design inspiration", "Inspiration design"), botId: "demo-pixel",
                prompt: t("Collect three interface ideas worth a look.", "Rassemble trois idées d'interface à regarder."),
                time: "14:00", weekdays: [0, 3, 6], minutes: 20,
                output: t("Three ideas saved to the board.", "Trois idées ajoutées au tableau.")
            ),
            RoutinePlan(
                id: "demo-routine-weekly", name: t("Weekly plan", "Plan de la semaine"), botId: "demo-atlas",
                prompt: t("Draft next week's plan from this week's threads.", "Rédige le plan de la semaine prochaine à partir des fils de cette semaine."),
                time: "16:00", weekdays: [5], minutes: 15,
                output: t("Plan drafted: three priorities.", "Plan rédigé : trois priorités.")
            ),
            RoutinePlan(
                id: "demo-routine-build", name: t("Nightly build", "Build de nuit"), botId: "demo-forge",
                prompt: t("Build the app and run every test.", "Construis l'application et lance tous les tests."),
                time: "21:00", weekdays: everyDay, minutes: 30,
                output: t("Build green, 1,284 tests passed.", "Build au vert, 1 284 tests réussis.")
            ),
        ]
    }

    /// The plan's run on `day`, or nil when it does not run that weekday.
    static func occurrence(_ plan: RoutinePlan, on day: Date, calendar: Calendar) -> Date? {
        guard plan.weekdays.contains(calendar.component(.weekday, from: day) - 1) else { return nil }
        let parts = plan.time.split(separator: ":").compactMap { Int($0) }
        guard parts.count == 2 else { return nil }
        return calendar.date(bySettingHour: parts[0], minute: parts[1], second: 0, of: day)
    }

    static func nextRun(_ plan: RoutinePlan, after now: Date, calendar: Calendar) -> Date? {
        let today = calendar.startOfDay(for: now)
        for ahead in 0...7 {
            guard let day = calendar.date(byAdding: .day, value: ahead, to: today),
                  let at = occurrence(plan, on: day, calendar: calendar), at > now else { continue }
            return at
        }
        return nil
    }

    /// A canned reply, chosen from the words of the message so the demo
    /// answers the same way every time. `onCall`: said aloud on a demo call.
    static func reply(to text: String, from name: String, language: DemoLanguage = .english, onCall: Bool = false) -> String {
        let lower = text.lowercased()
        let t = language.pick
        if lower.contains("status") || lower.contains("update") || lower.contains("où en") || lower.contains("état") || lower.contains("nouvelles") {
            return t(
                "Here's where things stand: the release build is green, the onboarding screens are ready for review, and one approval is waiting for you in Scout's chat.",
                "Voici où on en est : le build de version est au vert, les écrans d'accueil sont prêts pour la revue, et une approbation t'attend dans la conversation de Scout."
            )
        }
        if onCall {
            return t(
                "Hi, this is \(name). This is a demo call: I answer with prepared lines, read by your phone's voice, and nothing leaves your phone. Ask me for a status update.",
                "Bonjour, ici \(name). C'est un appel de démo : je réponds avec des phrases préparées, lues par la voix du téléphone, et rien ne quitte ton téléphone. Demande-moi où on en est."
            )
        }
        // whole words, so "this" or "anything" is not a greeting
        let words = Set(lower.split(whereSeparator: { !$0.isLetter }).map(String.init))
        let french = words.intersection(["bonjour", "salut", "merci", "allo", "allô"])
        let english = words.intersection(["hello", "hi", "hey", "thanks", "thank"])
        if !french.isEmpty || (!english.isEmpty && language == .french) {
            return "Avec plaisir ! C'est une démo : \(name) répond avec des messages préparés, rien n'est envoyé nulle part."
        }
        if !english.isEmpty {
            return "Hi! This is the demo, so \(name) answers with prepared replies and nothing leaves your phone. Connect a computer to talk to your real bots."
        }
        return t(
            "Got it. In the demo, \(name) only pretends to work on \"\(text.prefix(60))\". Connect a computer or sign in to your organization and your real bots will take it from here.",
            "Bien reçu. Dans la démo, \(name) fait seulement semblant de travailler sur « \(text.prefix(60)) ». Connecte un ordinateur ou connecte-toi à ton organisation et tes vrais bots prendront le relais."
        )
    }
}
