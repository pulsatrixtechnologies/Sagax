# Mascots

The characters a bot can wear (`bot.mascotLook`, shared/mascot-look.ts),
how each one is drawn, how it moves and how the phone follows. Each
character keeps its own skin, so switching character and back finds the
choice made before.

## Grump

The grumpy cat of direction C ("aplat net", approved by JC on 2026-10-09):
cream fur, dark point markings (the mask with its light blaze, the ears, the
tail), a white muzzle and chest, blue almond eyes slanted eight degrees with
a slit pupil, a small pink nose and a mouth whose corners drop very low. Two
flat tones and a shade crescent per part, one uniform outline that never
drops under 1.6 screen px. Under 48 px the drawing is a bust.

### Files

| What | Where |
|---|---|
| Art as data: parts, paint roles, sixteen faces, four stances, jointed tail, two-bone IK legs | `src/components/grump-art.ts` |
| Skins: palettes, gradients, the Shapes treatments, Void's lit eyes, the flat palettes the phone draws | `src/components/skin-fx/grump-skins.tsx` |
| Moves, the rig, the desktop clip map | `src/components/grump-moves.ts` |
| The component: CSS idle, the live rig writing poses onto the groups | `src/components/GrumpMascot.tsx`, `grump-mascot.css` |
| Desktop: render, menu moves, held activities, event cues | `src/components/floating-bots/mascots.tsx` (`GrumpRender`, `GRUMP_CUES`, `grumpHeldFor`) |
| Desktop behavior: the prowl, the cat's idle actions | `floating-bots/behavior.ts` (`cat`, trip phase `stalk`), `scheduler.ts` (`cat: true` actions) |
| Unlocks (Mastery) | `shared/mascot-unlocks.ts` (`grump`), `src/components/achievements/mastery-art.tsx` |
| Phone | `ios/Sources/CompanionCore/GrumpStillArt.swift` (generated), `GrumpArt.swift`, `ios/App/Mascots/GrumpMascotView.swift` |

### Colours

The markings are the bot colour deepened like a colourpoint cat's (42 % toward
a dark brown); a light colour is darkened further until the mask reads on the
fur (contrast 2.2 or more). The cream fur takes 8 % of the markings. Where no
bot gives a colour, Grump is a warm brown.

### Faces

The sixteen Shapes ids. The approved moods are five of them: idle is
`neutral` (half lids sloping out, pinched brows, the deep arc), happy is
`happy`, thinking is `curious`, alert is `surprised`, sleepy is `sleepy`.
The pupil is a slit at rest and dilates (scared, excited, sad, shy). The
app's states map to faces through the same table as the Shiba
(`shibaExpressionFor` in Avatar.tsx).

### Skins

| Skin | Rarity | Unlock (Mastery) | Look |
|---|---|---|---|
| Plain | Common | with Grump (`reviewer`) | the bot colour on the points |
| Tuxedo | Rare (named) | `prompter` | black, white bib and socks, green eyes |
| Calico | Rare (named) | `prompter` | the mask split orange and black down the blaze |
| Tabby | Rare (named) | `red-pen` | striped all over, green eyes |
| Siamese | Rare (named) | `red-pen` | seal points on pale fur, deep blue eyes |
| Void | Rare (named) | `not-so-fast` | all black, eyes glowing in the bot colour (or a cat's yellow green) |
| Retro 98, Gold | Rare | `justice-of-peace` | 64-colour coat with a dithered shade; a lucky gold figurine with emerald eyes |
| Neon, Chrome, Glitch | Epic | the shared Mastery premium rungs | the Shapes treatments per part |
| Holographic, Molten | Legendary | the shared Mastery premium rungs | the Shapes treatments per part |

Legacy ids (`tux`, `tortie`, `tiger`, `colourpoint`, `black`, `retro`, `royal`,
`metal`, `cyber`, `holographic`, `lava`...) read as the current ones.

### Moves

Thirty-one moves, pure functions of time (`grumpMoveAt`). The fourteen every
character plays: idle, blink, look, nod, shake, bounce, wave (reluctant),
think, celebrate, sleep (curled), alert, talk, listen, work. The cat's own:

| Move | What it does |
|---|---|
| walk | a cat's lateral sequence, eight keyframes of the paw's path (0.88 s), IK legs that never slide into the ground, head steady, ears and tail trailing |
| stalk | low and slow, the body sunk over bent legs, head forward, tail low with a twitching tip |
| sitUp, loaf | from the loaf to sitting tall; the loaf with half lids and one slow blink a cycle |
| stretch | the front (chest down, rump up, a yawn), then the back (a hind leg out behind) |
| groom | licks the paw, rubs it over the face and behind the ear |
| tailFlick, earsFlat, slowBlink | annoyed; an error; content |
| knead | the front paws press in turn, eyes half shut |
| pounce | crouch, rump wiggle, spring, land |
| ledge | hops up onto a ledge, sits there a moment, hops down |
| curl | turns once on the spot, then the ball with the tail around the front |
| yawn, hiss, bonk, drag | a yawn and a head shake; puffed with ears flat and fangs; two head bonks; dangling, unimpressed |

The rig (`GrumpRig`) blends the idle life, one held activity and one
one-shot move; a stance change lands with a small squash. Reduced motion
never runs it: a move only shows its face (`grumpReducedFace`). Two live
Grumps hold 60 fps in Chrome.

### On the desktop

It walks while the window walks. Every few minutes it prowls: it stalks low
and slow to a spot within its room and loafs there (never while the chat is
open or its bot waits for an approval, never under reduced motion). When
idle it grooms, flicks its tail, slow blinks, kneads, loafs and hops onto a
ledge. Events: a head bonk at a nudge, kneading for an achievement, a pounce
on a new message, curled up before a snooze, a hiss at a refused approval,
ears flat on an error. The avatar popover and the mascot's Moves menu offer
stretch, groom, knead, pounce, ledge, hiss, bonk, slow blink, tail flick,
yawn, curl and wave.

### Keyframe renders

`grumpPoseSvg` draws any frame of a move as SVG (the tests use it). To look at
a move, render a few frames of `grumpMovePose(move, t)` to a page and take a
headless Chrome screenshot.
