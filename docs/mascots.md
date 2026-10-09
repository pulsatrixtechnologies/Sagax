# Mascots

The characters a bot can wear (`bot.mascotLook`, `shared/mascot-look.ts`):
the owl, the Shapes, Trombi, Bunbu, and the Mastery characters (Shiba,
Grump, Ogre, Frog) that the Mastery achievements unlock
(`shared/mascot-unlocks.ts`, [achievements](achievements.md)). Each section
below describes one character: its art, its colors, its skins and its moves.

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
