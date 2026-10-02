# Home / search / new group / create bot: measured specs

> **Note (JC, 2026-10-01):** Sagax keeps its own mascots and palette. Use this file for frame sizes, positions, controls and type only. The 11 swatch hexes and §6 (mascot geometry and eyes) document the reference app and are **not** to be implemented.

Source: `ios/parity-refs/` 01, 17, 18, 19, 20 (1206x2622 px @3x, so 402x874 pt). All values are in pt (px/3) unless marked. Measured with PIL using coverage-weighted edges. Accuracy is about ±0.33 pt (1 px), and ±0.5 pt for font sizes. Fonts were fitted by rendering SF Pro (`SFNS.ttf`, opsz = size) and matching against the crops. Calibration check: the status-bar clock fits 18 pt semibold.
Scripts: `scratchpad/home/*.py` (mh, eyes, iou, shp).

## 0. Global tokens

| Token | Value |
|---|---|
| Screen background | `#141414` (solid, also the sheet fill) |
| Backdrop behind a sheet | `#0A0A0A` (= `#141414` under black 50%) |
| Glass control fill (circle buttons, search field, menu) | `#333333` centre (`#323232`-`#373737`). Equivalent to white ≈13% over `#141414`. Specular rim top+bottom: 1 px `#747474` fading to `#404040` over ~1.7 pt. Left/right edges have a 1 px `#030303` dark rim (shadow) |
| Primary text | `#FFFFFF` |
| Secondary text (previews, headers, pinned labels) | `#97969D` (≈ `rgba(235,235,245,0.60)` over `#141414`) |
| Tertiary text (time, type label) | `#575659` (≈ `rgba(235,235,245,0.30)`) |
| Placeholder in glass | `#6B6A6C` |
| Mascot eye colour | `#141414` (same as the background, so the eyes read as holes) |
| Unread dot | `#2D6BE3` |
| Caret | `#4C69EA` |

## 1. Home (01-home.png)

### Top bar
- **Profile photo**: a 44 pt glass circle (`#333333` ring with the same specular rim as the buttons) at x 18-62, y 68-112, centre (40, 90). The photo inside is a **38 pt** circle inset 3 pt, so the ring is 3 pt wide.
- **Search and + buttons**: 44 pt glass circles. Search spans x 287.7-331.7 (centre 309.8), + spans x 339.7-383.7 (centre 361.8), both y 68-112. Centre-to-centre 52 pt, so the **gap is 8 pt** and the trailing inset is 18 pt. Leading inset for the photo is also 18 pt.
- **Icons**: white. The magnifier glyph box is 17.3x17.3 pt and the plus is 16.7x16.7 pt, both centred. This matches SF Symbols `magnifyingglass` / `plus` at about 19-20 pt, medium weight.

### Pinned row (3 equal columns of 134 pt, centres x = 67 / 201 / 335)
- **Mascot frame S = 85 pt** (circle measured 84.8 wide). Top y = 149.3 and centre y = 191.8. The shape fills the frame in its major dimension, with no inner padding. The hexagon is 76.7x84.7.
- **Body colour (purple)**: `#895BF6`.
- **Label**: SF Pro **12 pt regular** (11.5-12), `#97969D`. Cap top 249.3 and baseline 257.7, so the gap from the mascot bottom to the cap top is 15 pt. The label is centred on the column.
- **Unread dot**: **10 pt** circle `#2D6BE3`, 7.7 pt after the label text (ink gap), vertically centred on the cap height (centre y 253.5). The text and dot are centred together as one group.
- **Group composite** (inside the same 85 pt frame): three members, each **0.57·S ≈ 48.5 pt**.
  - Triangle, white `#FFFFFF`: back layer, centre offset (−0.7, −20.1). Top at y 149.3, width ≈ 45 visible.
  - Drop, blue `#3C82F6`: middle layer, offset (−20.5, +19.9). Its bbox is y 187.7-235.7.
  - Circle, purple `#895BF6`: front layer, offset (+19.8, +20.0), diameter 48.5.
  - Each front member is cut out of the members behind it by a background-coloured outline about **5.3 pt** wide (≈0.062·S). In practice this is a `#141414` stroke of ~5.3 pt around each front shape.
  - The composite bbox is x 295-379, y 149-236. Offsets are about ±0.235·S horizontally and −0.236·S / +0.234·S vertically from the frame centre.

### Section header
- **Text**: SF Pro **12 pt regular**, `#97969D`, x = 20.3 (leading inset ≈ 20.5). Cap 304.3-313.0, baseline 313.
- **Chevron** (down): 11.7x6.3 pt, colour `#3C3C3D` (very dim), 9 pt after the text, vertically centred on the cap.
- **Spacing**:
  - Pinned label baseline to header baseline: 55.3.
  - Header baseline to first row name baseline: 44.7.
  - Last row name baseline to next header baseline: 76.3. Equivalently, from the previous row's bottom edge (row box below) the next header cap top is ~23 pt.

### List rows (pitch **80 pt**)
- **Avatar**: **42 pt** frame, x 23-65. The avatar is vertically centred in the row: avatar top 341.7 gives a row box of 322.7-402.7.
- **Text column**: x = 82.5 (avatar right + 17.5). The trailing edge for time and preview is 378.7, so the trailing inset is ≈ 23.3.
- **Name**: SF Pro **14 pt medium (510)**, white, tracking ≈ −0.3. Cap top = avatar top + 6.3 and baseline = avatar top + 16.
- **Role chip**:
  - Size: height **19 pt** (343.3-362.3), vertically centred on the name cap. Corner radius **≈ 6.3 pt**, so it is not a capsule.
  - Colours: fill `#252527`, text **12 pt medium** `#9E9EA4`.
  - Spacing: horizontal padding ≈ 6.7 pt. The ink gap from the name is 9.3 pt, so about 8 pt of layout spacing.
- **Time**: SF Pro **11.5 pt regular** (11.5-12), `#575659`, right-aligned to 378.7, centred on the name cap.
- **Preview line**:
  - Text: SF Pro **12.5 pt regular** (12-13), `#97969D`, baseline = name baseline + 20.7. One line, truncated with "…".
  - Leading icon, same colour: a paperclip of 9.7x13 pt or a "sent" paper-plane of 12.7x11.3 pt. It starts at x 82.3-84 and is followed by an 8 pt gap, so the text starts at x 102.5-103.
- **Shape colours seen**: red `#EB4045`, blue `#3C82F6`, purple `#895BF6`.

## 2. "+" menu (18-home-plus-menu.png)
- **Popover**: glass, fill `#323232` (white ≈12.5%), with the same 1 px specular top rim (`#757575`) and dark side rim. The background behind it is not dimmed.
- **Frame**: x **143.7-394.3** (w ≈ 250.7), y **62.0-153.0** (h ≈ 91). Right inset 7.7 and top 62, so it grows from the + button towards the top-right.
- **Corner radius**: ≈ **31.5 pt** by circle fit (continuous corner, ~1/3 of the height).
- **Items**: "New Bot" and "New Group Chat", SF Pro **14 pt regular**, `#F9F9F9`. Text x = 173.3, which is 29.7 pt of leading padding.
  - Item pitch is **35.3 pt** (cap tops 85.0 and 120.3), and the two items are centred in the popover.
  - Vertical padding is ≈ 10 pt above the first row and below the last.
  - No separators and no icons.
- The search button stays visible, blurred, under the glass. The popover replaces the + button (a morph).

## 3. Search sheet (19-search.png)
- **Sheet**: full width (x 0-402), top **62 pt**, fill `#141414` over a `#0A0A0A` backdrop. Corner radius ≈ **38 pt** by circle fit; with `.continuous` style use about 34. It runs under the keyboard.
- **Header row**: y 80-124 (44 pt, centre 101.8).
  - Close: 44 pt glass circle at x 18-62 with a white X glyph of 14x14.
  - Search field: glass capsule of 44 pt height, x **69.7-332.3** (w 262.7), fill `#333333`.
    - Magnifier glyph: 15.3 pt, `#6B6A6C`, x 85-100.
    - Caret: `#4C69EA`, 2 pt wide by 17 pt tall, at x 110.
    - Placeholder "Search": ≈ **14.5-15 pt regular**, `#6B6A6C`, x 112.
  - Filter: 44 pt glass circle at x 339.7-383.7 with a 3-line filter glyph of 18x14, white.
  - Gaps between controls: ≈ 7.7-8.
- **Results**: same row metrics as the home list.
  - Row pitch **80**, first avatar top **174.7** (50.7 below the header bottom), avatar 42 at x 23.
  - Name 14 pt medium white at x 82.5. Subtitle 12.5 pt regular `#97969D`, baseline +20.3.
  - Type label ("Bot" / "Group Chat") on the right: **12 pt regular**, `#575759`, right edge 379, aligned to the name cap.
  - The group composite is used at S = 42.

## 4. New group chat (17-new-group-chat.png)
- **Sheet**: same as search (top 62, full width, `#141414`).
- **Header row**: y 80-124.
  - Close: 44 pt glass circle at x 18-62.
  - Title "New Group Chat": SF Pro **14 pt medium**, white, x **79.3**, centred on y 101.8.
  - **Next** (disabled): capsule **59.7 x 44** at x 324.3-384.
    - Fill `#999999` (white ≈ 57% glass), with a light specular rim `#C9C9C9` top and bottom.
    - Text "Next": **14 pt semibold** `#2D2D2D`.
- **To field**: x **18-384** (w 366), y **134-176** (h **42**), glass capsule fill `#333333`-`#353535`.
  - "To:" label: 13.5-14 pt regular `#6B6B6D`, x 32.7.
  - Caret at x 59.3.
  - Placeholder "Search Bots": 14 pt regular `#6B6B6D`, x 60.7.
- **Rows**: avatar **32 pt** at x 22-54, row pitch **54 pt**, first avatar top **219**.
  - Name: **14 pt regular**, white, x **68.7** (gap 15 after the avatar), vertically centred on the avatar.
  - No subtitle and no separators.

## 5. Create New Bot (20-create-bot.png)
- **Sheet**: inset card x **8-394** (w 386), y **123.7-865.7** (h 742), fill `#141414` over a `#0A0A0A` backdrop. All four corners are rounded, ≈ **36 pt** by circle fit (continuous).
- **Header**:
  - Close: **42 pt** glass circle at x 25.3-67.7, y 141-183.3 (centre 46.5, 162.2), with a white X glyph of 13.7 pt.
  - Title "Create New Bot": **14 pt medium** white, x **83.7** (gap 16), cap 157.3-167.
- **Preview mascot**: a cloud of **142.3 x 113.3**, bbox x 130-272, y 258.3-371.3, centre (**201, 314.8**). It fills a frame of S ≈ 142 in width. Colour brown `#8C6640`. Eyes are described in §6.
- **Name field**:
  - Frame: x **23.3-378.3** (w **355**), y **445.3-492.7** (h **47.3**). Radius **≈ 15.5 pt** (continuous). Fill **`#202020`** (solid, no rim).
  - Placeholder "Name your Bot": **17.5-18 pt medium**, `#5E5E60`, centred.
- **Shape grid**: 4 columns x 2 rows.
  - Cell pitch **57.67 pt** both ways. Column centres x 114.3 / 172.0 / 229.7 / 287.3; row centres y 546.7 / 604.3.
  - Shapes are drawn in a **34 pt** frame filling the major dimension, in the current colour, **with no eyes**.
  - Order: circle, blob, squircle, pill / triangle, hexagon, cloud, drop.
  - **Selected** state: an outline that follows the shape (not a circle), stroke **2 pt** `#545356`, gap **≈ 2.7 pt** from the shape edge. Selected cloud ring bbox: 208-251 x 586.3-622.3.
- **Colour swatches**: two rows (6 + 5) of **25 pt** circles.
  - Pitch 53.33 horizontally.
  - Row 1 centres x 67.5 / 120.8 / 174.2 / 227.8 / 281.2 / 334.5 at y 669.7.
  - Row 2 is offset by half a pitch: x 94.2 / 147.7 / 201.2 / 254.5 / 308.2 at y 711.8, so the row pitch is 42.2.
  - **Selected** ring: stroke **2 pt** `#545356`, outer diameter 34.7, gap **2.7 pt** between the fill and the ring.
  - The 11 exact colours (flat fills, std 0) are below.

  | # | Hex | Name guess |
  |---|---|---|
  | 1 | `#FFFFFF` | white |
  | 2 | `#8C6640` | brown (selected) |
  | 3 | `#EB4045` | red |
  | 4 | `#ED712D` | orange |
  | 5 | `#F19D38` | amber |
  | 6 | `#5AC67A` | green |
  | 7 | `#54B9A6` | teal |
  | 8 | `#3C82F7` | blue (avatar blue `#3C82F6`) |
  | 9 | `#895BF6` | purple |
  | 10 | `#EB4699` | pink |
  | 11 | `#777777` | gray |

  The repo's `MAUS_COLORS` (12 entries: green `#009957`, blue `#377FE6`, ...) **does not match** these. The reference set has no black, cyan, coral or yellow; it adds brown, amber and gray, and every hex differs.
- **Create button** (disabled): x **36.7-365.3** (w **328.7**), y **794.7-837.3** (h **42.7**), centre y 816. Bottom of the sheet minus the button bottom is 28.3.
  - Shape: **capsule**.
  - Fill `#9A9A9A` (white ≈ 57% glass) with a specular rim `#D7D7D7` on top and `#CECECE` at the bottom.
  - Label "Create": **13.5-14 pt semibold** `#2D2D2D`.

## 6. Mascot geometry vs `src/components/ShapeMascot.tsx`

### Frame
In the screenshots every shape **fills its frame in its major dimension**: circle, squircle, hexagon and drop are full height; circle, squircle, pill, cloud, blob and triangle are full width. The code instead draws inside a 100 viewBox with ~8-10% padding (circle 8-92, squircle 10-90, ...). To match at the same `size`, either drop the padding (scale the paths to 0-100) or render at size/0.84.

### Per-shape proportions (screenshot vs code path bbox)

| Shape | Screenshot w/h | Code w/h | Shape IoU after bbox normalise | Verdict / adjustment |
|---|---|---|---|---|
| circle | 1.000 | 1.000 | - | Matches (padding only). |
| squircle | 1.000, corner r ≈ **0.25·S** | 1.000, r = 20/80 = 0.25 | 0.983 | Matches (padding only). |
| hexagon | **0.906**, pointy top. Vertical flat sides span 0.283-0.713 of h; corner rounding ≈ 0.08·h | 0.941, flats 0.33-0.67 | 0.981 | Make it narrower and closer to regular: w = 0.906 h, side vertices at y ≈ 0.25 h and 0.75 h, corner radius ≈ 8% of h. |
| pill | **1.54** (h = 0.65 w), corner r ≈ **0.45·h** (slightly flatter than a capsule) | 1.833 full capsule | 0.977 | Make it taller: height 65% of width, radius ≈ 0.45 h. |
| drop | **0.794**. A bottom circle of r = 0.397 h centred at 0.60 h; the sides are **straight cone lines** tangent to the circle; the tip is at the top with ~0.03 h rounding | 0.744, curved shoulders | 0.921 | Widen it, and use straight tangent sides with a rounder, fuller bottom. |
| triangle | **1.086**. Straight sides; apex rounded r ≈ 0.10 w; bottom corners rounded more (bottom edge only 65% of the max width); widest at 0.85-0.90 h | 1.081 | 0.915 | Increase the corner radii (apex ≈ 0.10 w, base corners ≈ 0.12 w). |
| blob | **1.10**. A smooth egg/potato with **no notch**. Its major axis is tilted ~12° clockwise (the right side sits lower); top point at x 0.47-0.59, fuller lower-right. Axis ratio 1.11 | 1.038 with a concave notch at the left | 0.891 | Replace it with a smooth ellipse-like blob (rx/ry ≈ 1.11, rotated +12°) with a slight bulge toward the bottom-right. Remove the notch. |
| cloud | **1.25** (also 1.256 on the big preview). **Five lobes** (top-left, top-right, right, bottom, left); scalloped bottom with no flat base | 1.485, 3 lobes + flat base | 0.842 | Redraw it as a union of 5 circles (below). |

**Cloud circles** (fitted on the 142 pt preview, in a 100x100 viewBox with the shape centred vertically; h = 79.6):

| Lobe | Centre | Radius |
|---|---|---|
| Top-left | (38.9, 36.6) | 26.4 |
| Top-right | (65.7, 37.0) | 22.9 |
| Right | (77.0, 58.7) | 22.9 |
| Bottom | (50.5, 63.3) | 26.4 |
| Left | (23.8, 61.2) | 23.7 |

The extents come out to x 0-100 and y 10.2-89.7. The notches between lobes sit at about (12,38), (55,7), (88,34), (71,89) and (32,92) as fractions ×100 of the bbox.

### Eyes: do not match the code
- **Code**: two vertical ellipses (rx 3.6, ry 4.6 in the 100 box), centred horizontally around `eyes[0]`, gap 11-12, colour `#1B1F27`.
- **Screenshot**: two **tilted capsule slits** (rounded rectangles with fully round ends).
  - Colour **`#141414`**, the same as the background, so the eyes could be drawn as cut-outs.
  - Tilt **−26.5°** from vertical, top leaning left ("\\ \\"), the same for both eyes.
  - The pair is **shifted up and to the right** (looking up-right).
  - The **left eye is wider** than the right (about 1.4x), a 3D "turned head" effect.
- **Static avatar eyes** (fractions of the frame S; centre x, y of the left and right eyes; length L, width W; spacing between centres):

  | Shape | Left eye (x, y) | Right eye (x, y) | L | W left / right | Spacing |
  |---|---|---|---|---|---|
  | circle (S 85) | 0.596, 0.290 | 0.813, 0.250 | 0.205 | 0.097 / 0.068 | 0.217 |
  | squircle (S 42) | 0.595, 0.286 | 0.813, 0.246 | 0.207 | 0.100 / 0.072 | 0.218 |
  | hexagon (S 85) | 0.590, 0.310 | 0.787, 0.272 | 0.205 | 0.097 / 0.070 | 0.197 |
  | pill (S 42) | 0.589, 0.363 | 0.794, 0.337 | 0.175 | 0.086 / 0.061 | 0.205 |
  | cloud (S 42) | 0.574, 0.371 | 0.746, 0.342 | 0.178 | 0.083 / 0.061 | 0.172 |
  | drop (S 42) | 0.578, 0.427 | 0.751, 0.394 | 0.185 | 0.090 / 0.065 | 0.172 |
  | triangle (S 42) | 0.564, 0.458 | 0.716, 0.429 | 0.166 | 0.080 / 0.059 | 0.152 |

  The right eye is always about 0.03-0.04·S higher than the left, which is the tilt of the pair.
- **Large preview (create bot, cloud 142 pt)** uses a different pose. The eyes are much larger:
  - Length 47.3 pt (0.33·w, 0.42·h); width 21.2 / 19.1 pt (0.14·w).
  - Tilted **+12° to +14°** ("/ /").
  - Centres at (0.446 w, 0.653 h) and (0.682 w, 0.678 h), so low and slightly right of centre, about 33.5 pt apart.

  This looks like an animated or "looking down" state, or a larger eye scale for the hero. Treat it as a separate mood/pose, not as the static geometry.
- **Shape grid** thumbnails have **no eyes**.
- **Changes to make in `ShapeMascot`**:
  1. Replace the ellipse with a rotated capsule.
  2. Use per-shape eye anchors from the table above, not `ex ± gap`.
  3. Set eye colour = background `#141414`.
  4. Use length ≈ 0.17-0.21·S and width ≈ 0.07-0.10·S (left wider).
  5. Remove the 8-10% frame padding.

## 7. Caveats
- Fonts are an ink fit on SF Pro. The odd sizes (11.5, 12.5) suggest the reference app uses web px/rem sizes, so treat them as ±0.5 pt. Tracking from the fits is roughly −0.15 to −0.3 pt on 14 pt text.
- Sheet and popover radii are circle fits of continuous corners. A `.continuous` RoundedRectangle needs a radius about 10-15% smaller than the fitted circle value.
