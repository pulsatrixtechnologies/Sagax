# Mascots

The characters a bot can wear (`bot.mascotLook`, `shared/mascot-look.ts`):
the owl, the Shapes, Trombi, Bunbu, and the Mastery characters (Shiba,
Grump, Ogre, Frog) that the Mastery achievements unlock
(`shared/mascot-unlocks.ts`, [achievements](achievements.md)). Each section
below describes one character: its art, its colors, its skins and its moves.

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

## Ogre

The big green ogre, direction C ("aplat net"), approved on 2026-10-09: a
bald inverted-pear head, trumpet ears, a heavy brow, a three-lobed nose, a
wide mouth, a massive neck, a cream tunic under an open vest. Two flat tones
and one shade crescent per part, one uniform outline (1.9 units, never under
1.6 screen px), geometric shapes, the same family as Shiba.

### Files

| File | What it holds |
|---|---|
| `src/components/ogre-art.ts` | The art as data: paths, paint roles, the sixteen faces, the mouths, the colors, the limbs (two bones placed by a hand or a boot), the marks (Lava's cracks, Armor's rivets). |
| `src/components/ogre-rig.ts` | One moment of the drawing (`OgreFrame`) and the drawing at that moment as nested groups (`ogreFrameLayers`), shared by the component, the tests and the renders. |
| `src/components/ogre-moves.ts` | The moves (frames over time), `OgreRig` (idle life, held activity, one-shot, blending), the clip map, the desktop mapping. |
| `src/components/OgreMascot.tsx`, `ogre-mascot.css` | The component: the still drawing with a CSS idle, the rig while a move plays. |
| `src/components/skin-fx/ogre-skins.tsx` | The thirteen skins. |
| `ios/Sources/CompanionCore/OgreStillArt.swift` | Generated from the art by `src/components/ios-mascot-export.test.ts`: the phone's still frames. |
| `ios/App/Mascots/OgreMascotView.swift` | The phone's drawing. |

### Stances and crop

- `rest`: the approved head and shoulders, what every avatar shows.
- `stand`: the whole ogre (the same head at 0.58 on a barrel body with a
  belt, two arms, two legs) for the walk and the moves that need hands.
- `log`: the whole ogre sitting on a log, for the nap.
- Under 48 px the drawing is the bust (`5 12 90 90`), the trumpets kept.

### Faces

The sixteen ids of the Shapes (`SHAPE_EXPRESSIONS`), so a state or a clip
names one face for every character. The approved moods are five of them:
idle is `neutral`, happy is `happy`, thinking is `curious`, alert is
`surprised`, sleepy is `sleepy`. The app's states map as Shiba's do
(`ogreExpressionFor` in `Avatar.tsx`).

### Colors

- Skin: the ogre green `#9DBE4A` a quarter (24 %) toward the bot color,
  in HSL so the hue and lightness move while the saturation stays an
  ogre's (`tintColor`).
- Vest: the bot color worn as leather (42 % toward brown, as approved);
  a light color (white, the pastels) is darkened until the cream tunic
  reads against it (contrast 1.6 or more).
- Without a bot color: the archetype's green and brown vest.

### Skins

| Skin | Rarity | Look |
|---|---|---|
| Plain | Common | The bot's color. |
| Swamp | Common | Deep bog green, a mud vest. |
| Moss | Common | Bright spring green, a moss vest. |
| Stone | Common | A grey granite ogre, a slate vest. |
| Lava | Rare | A basalt ogre whose cracks glow, embers for eyes, heat over the head. |
| Armor | Rare | Riveted plate steel for a vest, the chrome sweep on the plates. |
| Retro 98 | Rare | The sixteen colors, a black outline, a dithered shade. |
| Gold | Rare | A solid gold ogre in a royal vest. |
| Neon | Epic | Tubes of light on a dark ogre. |
| Chrome | Epic | A mirror ogre. |
| Glitch | Epic | Split channels and scan lines. |
| Holographic | Legendary | Pearl and rainbow foil. |
| Molten | Legendary | Rock and flowing magma. |

Unlocks come from the Mastery registry: Conductor unlocks Ogre; Swamp and
Moss come with Ten Hands, Stone and Lava with Plugged In, Armor with Swarm;
Full House gives Retro 98 and Gold; the five hardest skins come from the
cross-character achievements.

### Moves

The fourteen moves every character plays, ported to an ogre, then its own:

| Move | What it does | Desktop trigger |
|---|---|---|
| idle | Standing at ease: a heavy breath, the weight shifting between the boots, seeded slow blinks. | Always under the rest. |
| blink, look, nod, shake | The small ones; the head and the trumpets follow the eyes. | Clips (look, bob, headSpin, wink). |
| bounce | A crouch, a short heavy hop, a squashed landing that shakes the ground. | hop, jump, land. |
| wave | The right arm up, the open hand swinging from the elbow. | wave. |
| think | The head scratch: one hand at the side of the head, the other fist on the hip, thought bubbles. | The bot thinks (pose `think`), scratch, confused. |
| celebrate | Two heavy hops, fists pumping. | Moves menu. |
| sleep | Sits on a log, the head nodding, a snore bubble that swells under the nose and pops, z's. | The mascot sleeps; a snooze. |
| alert | Startled: a jump back, the eyes wide, the trumpets straight up. | surprised, startled. |
| talk, listen, work | Talking with a gesturing hand; a hand cupped behind a trumpet; a fist pounding a palm. | A reply streams; the bot works. |
| walk | The heavy walk: eight keys per stride pair on a periodic spline (contact, down, passing, up on each foot), the body dropping on each landing, the belly, the head and the trumpets following a beat late, dust and a ground shake on every contact. | The window travels (idle wander). |
| laugh | The belly laugh: rocked back, the hands on a bouncing belly, the face thrown up. | love (many strokes), Moves menu. |
| crossArms | Arms crossed, a boot tapping, a sceptical head tilt now and then. | An approval or an error waits on the person (pose `alert`). |
| roar | A crouch, then the roar: the jaw dropped, the lower tusks out, the trumpets flat back, shock lines, the air shaking. | A task failed or refused (sad), angry. |
| flex | The double biceps flex, the biceps swelling, sparkles. | A task done (celebrate). |
| earWiggle | The trumpets wiggle left and right, quick then settling. | A nudge, a stroke (petted). |
| stomp | Stomps around a small circle, fists up, the ground shaking. | An achievement, dance. |
| stretch | Up from the log, arms overhead, a huge yawn, a shake out. | Waking. |
| chomp | A message flies in; the ogre grabs it and eats it in three bites, crumbs flying, then pats its belly. | A reply lands. |
| drag | Dangling: arms up, the boots kicking slowly. | Dragged. |

The rig blends a move in over 0.15 s and out over 0.22 s; a change of
stance lands with a squash. The desktop runs it at most 60 frames a second
and not while hidden; each step and stomp jolts the drawing by a pixel or
two. Under reduced motion nothing moves: a move only shows its face.

The Moves menu names Ogre's moves (Belly laugh, Roar, Flex, Stomp, Chomp,
Ear wiggle, Head scratch, Stretch, Wave, Hop) and plays them through the
shared clips.

### Checking the animation

`ogreFrameSvg(ogreMoveFrame(move, t), { size })` draws any frame as an SVG
string; render six frames of a move to PNG with headless Chrome to look at
it. The keyframes of the heavy walk and the belly laugh were checked that
way while tuning.
