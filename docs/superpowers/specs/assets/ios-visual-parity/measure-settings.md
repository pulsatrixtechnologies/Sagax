# Settings / Plugins / Account / Bot Computer: measured specs

Source: `ios/parity-refs/` 12, 14, 15, 16, 21 (+ 01-home for the dim comparison). iPhone @3x, 1206x2622 px = 402x874 pt.
All values in **pt**, in **screen coordinates** (origin at the top-left of the screen) unless noted. Precision is about ±0.33 pt (1 px).
Method: PIL edge/subpixel scans. Font sizes come from the cap-height stem (SF cap = 0.7046 em) and are cross-checked against CoreText ink widths of the same string (macOS `NSFont.systemFont`, same SF Pro and auto-tracking).

> **Main finding on type:** the whole UI runs at **non-HIG sizes**. Row titles are **13.5 pt Regular**, subtitles, section labels and footers are **11 pt Regular**, and the header title is **13.5 pt Medium**. That is about 0.79x the usual 17/14 pt. Cap height and ink width agree on these values within ±0.1 pt, so use `.system(size: 13.5)` etc. and do not use Dynamic Type styles.

---

## 1. Sheet container (same in all 5 screens)

| Property | Value |
|---|---|
| Sheet frame | x 8 → 394 (side inset **8**), top **123.67**, bottom **865.7** (bottom gap 8.3). Size 386 x 742 |
| Sheet fill | **#141414** (opaque) |
| Top corner radius | about **37** (circular fit 37.0; use 38 continuous) |
| Bottom corner radius | about **50** (circular fit 50.7; concentric with the display corners, about device radius minus 8) |
| Content clipping | content is clipped by the sheet shape (the Appearance row and "Grok Bot" are cut at the bottom edge) |
| Home behind | **not scaled, not offset, not blurred.** Pixel positions match 01-home exactly; edges stay sharp |
| Dim over home | full screen, status bar area included (the status bar glyphs are drawn above it and stay #FFFFFF). Measured pairs home → dimmed: #FFFFFF→#858585, #333333→#151515, #141414→#0A0A0A, #3C82F7→#1B3D74. Best single fit: **black at 0.50 opacity** (20→10 exact; white gives 128 vs 133). Use `Color.black.opacity(0.5)` |
| Top scroll-edge fade (14) | content scrolled under the header fades into the sheet colour over about **123.67 → 201** (about 78 pt, header height). Card colour #1F1F1F shows as #141414 at the top, about 0.82 overlay at +18, 0.64 at +45, 0.18 at +75, 0 at +78. Text under it is heavily dimmed (white reads ≤ 52/255 at +20..30), which matches the iOS 26 soft scroll-edge effect |

## 2. Header: close / back glass circle and title

| Property | Value |
|---|---|
| Circle | **42 x 42**, frame x 25.33 → 67.33, y 141 → 183.33 (center **46.33, 162.17**). That is **17.33** from the sheet's left and top edges |
| Fill | **#333333** flat centre. Glass rim: top 1 pt highlight (lum 86 → 100 → 83), then an inner vertical gradient lum 64 → 51 (centre) → 65 at the bottom, a bottom 1 pt highlight (lum 83 → 100 → 92), and a 1 px dark outline at the sides (#080808 to #0A0A0A, a shadow). Equivalent to the iOS 26 `.glassEffect()` on dark |
| X icon (settings) | xmark glyph box **13.67 x 13.67**, white, centered in the circle. About SF Symbol `xmark` 17 pt regular |
| Chevron-left (sub-pages) | glyph box **8.33 x 15**, white, centered (46.17, 162.17). About `chevron.left` 17 to 18 pt regular/medium |
| Title text ("Plugins", "Account", "Bot Computer") | **SF Pro 13.5 Medium**, #FFFFFF. Ink x starts **84.0** (16.67 after the circle). Cap top 157, baseline about 166.5, cap centre aligned to the circle centre 162.17. Width check: "Bot Computer" 87.33 (Medium 88.06, Regular 85.92); "Plugins" 45.0 (Medium 45.26) |
| Settings root | no title; the close circle is alone |
| First card top | **213.84** (30.5 below the circle bottom; 90.2 below the sheet top) |

## 3. Grouped cards (Settings / Account / Bot Computer)

| Property | Value |
|---|---|
| Card frame | x **23.17 → 378.5** (width 355.33; inset **15.17** from the sheet and **23.17** from the screen) |
| Fill | **#201F20** (≈ #202020; use #1F1F1F/#202020) |
| Corner radius | **16** continuous (circular fit 15.5) |
| Gap between cards | **27** (e.g. 323.5 → 350.49; 384.33 → 411.33; 660.67 → 687.33) |
| Content leading inset | **17.5** from the card edge (text/divider start x **40.67**; ink starts at 41.0 to 41.67 because of the glyph side bearing) |
| Divider | 1 pt (3 px) **#313131** (white at about 0.07 over the card). Runs from x **40.67** to the card's trailing edge (no trailing inset) |
| Row height, single-line, no control | **44.5** pitch (≈ 43.5 content + 1 hairline). A standalone single-row card is **44.67** (Send Feedback, Sign Out, Disk space 44.33) |
| Row height, single-line with toggle (Notifications) | **53.67** |
| Row height, title + 1 subtitle line (Plugins) | **61.0** |
| Row height, title + 2 subtitle lines (Auto-review, Set TZ) | **74 to 75** |
| Row height, Bot Computer action row with 3 description lines | **89.33**; with 2 lines **74** |
| Profile row (avatar + name + email) | **65.5** |
| Vertical rhythm in subtitle rows | title cap top = row top + **17.3**; title baseline = row top + **27.5**; title baseline → first subtitle baseline **17.0**; subtitle line pitch **14.0**; last baseline → row bottom **16.5 to 16.7** |
| Single-line row | text is vertically centred (cap centre = row centre) |
| Title font | **SF Pro 13.5 Regular**, **#FFFFFF** (cap 9.47 measured on B/N/P/T; "Bot Computer" 85.67 vs CT 85.92) |
| Subtitle font | **SF Pro 11 Regular**, **#9C9BA0** (cap 7.67; "Require approval for risky shell, MCP, and" 215.0 vs CT 215.46) |
| Value text (35%, 16, America/Toronto, System · Black, On, Normal) | **13.5 Regular**, **#9C9BA1** |
| Value right edge | with chevron: ink ends **335.67** (15 pt before the chevron); without chevron: ink ends **360.67** (≈ 17.8 from the card's trailing edge) |
| Chevron (disclosure) | ink box **6.67 x 11.67 to 12**, x 350.67 → 357.33 (center x **354**, trailing gap 21.2), colour **#6B6A6D** (core #69686B), stroke about 1.5 pt. About `chevron.right` 15 pt regular/semibold in #6B6A6D. Vertically centred on the title (single-line) or the row (profile, Plugins) |
| Toggle (Switch on) | track **60.33 x 26.33 to 27** (x 301 → 361.33, trailing 17.2), fill **#68CE67** (also seen as #67CE66). Knob white capsule **35.33 x 22.67** (iOS 26 style), inset about 2 pt. In 2-line rows the toggle is **top-aligned**: track top = row top + 13.8 (centre ≈ title cap centre + 4). In a single-line row it is centred |
| Destructive text (Sign Out, Reset Computer, Delete Account) | **13.5 Regular**, **#F49A96** (samples #F39B97, #F59B97; the trash icon reads #F19A95) |
| Link/action blue (Update Computer) | **13.5 Regular**, **#2D6DE7** |

### Section labels / footers (outside cards)
| Property | Value |
|---|---|
| Section label ("Bot", "Switch Account") | **SF Pro 11 Regular**, **#575659** on #141414. x 41.67 (same as the row text). Previous card bottom → label cap top **30.2**; label baseline → next card top **10.5 to 11** |
| Footer text (account delete note, "The one computer your Bots share.") | **11 Regular**, **#575659** (#575759). Card bottom → footer cap top **10.5 to 10.8**; line pitch 14; footer last baseline → next card top **30.3** |

## 4. Settings root (12 / 14): exact stack

Screen y values (12-settings-top, scroll at rest):
- Card A 213.84 → 323.5: profile row 213.84 → 279.3 (65.5); hairline 279.3; Usage row 280.3 → 323.5.
  - **Profile photo: 38.5 x 38.5 circle**, x 40.67 → 79.17, centre y 246.67 (vertically centred in the row).
  - Name: **13.5 Regular #FFFFFF**, ink x **89.0** (≈ 10 after the photo). Baseline about 242.8 (cap top 233.33).
  - Email: **11 Regular #9C9BA0**, x 88.67. Name and email are stacked and centred on the photo. Ink box 252 → 262.33.
  - Chevron centred on the row.
  - "Usage": baseline 306.67; value "35%" + chevron.
- Card B "Plugins / Tools and skills for Grok Bot" 350.49 → 411.5 (61): title baseline 378, subtitle baseline 395.
- Label "Bot" baseline 449.67.
- Card C 460.17 → 743.5: Auto-review (75, toggle) | Auto-review Rules (44.67, value "16" + chevron) | Set Time Zone Automatically (74, toggle) | Time Zone (44.67, value only, no chevron) | Bot Computer (43.33, chevron).
- Card D 770.7 → (in 14: 197 → 384.33): Notifications (53.67, toggle) | Appearance "System · Black" | Language "System" | Haptics "On" (44.5 each, chevrons).
- Card E 411.33 → 589 (in 14): Help Center | Privacy Policy | Terms of Service | Grok Bot Terms (4 x 44.4, chevrons).
- Card F Send Feedback 616 → 660.67 (chevron).
- Card G Sign Out 687.33 → 732 (red text, no chevron).
- **Footer mascot:** white circle **47.67 diameter**, centre x **201.17** (screen centre), top **792.67** (60.67 below the Sign Out card). Fill #FFFFFF. Two eye cut-outs in the sheet colour #141414, upper right: left eye about 6.3 x 8.3 at x 203 → 209.33, y 802.67 → 811; right eye x 213.33 → 218.67, y 800.67 → 809. Both slanted (top leaning right), the same mascot shape as home.
- **App name "Grok Bot"**: cap top **860.67** (20.3 below the mascot), centred, white, ink width about 65 → **SF Pro 17 Regular/Medium** (CT 17 Regular 65.47, Medium 67.08). Clipped by the sheet bottom, so the baseline is about 872.7.

## 5. Plugins (15)

| Element | Value |
|---|---|
| Back circle | as in §2 (42, centre 46.33, 162.17) |
| Title "Plugins" | 13.5 Medium white, x 84, baseline 167 |
| **"N installed" capsule** | frame x **226.67 → 376.67**, y 141 → 183.33: **150 x 42.33**, full capsule radius 21.17. Trailing inset 25.33 (mirrors the circle's leading inset). Glass fill **#333333 to #353535** with the same rim as the glass circle |
| Stacked icons | 3 circles, **diameter ≈ 19**, centres x **≈ 250, 262.67, 275.33** (step **12.67**, overlap ≈ 6.3), centre y 162.17. Circle 1: dark fill **#2E2E2E** (logo on dark); circles 2 and 3: white fill with a full-bleed logo. Leading padding to the first circle about 14; drawn left to right, each one above the previous one |
| Capsule label "17 installed" | **13.5 Medium #FFFFFF**, ink x 292.67 → 362 (≈ 8 after the last circle; trailing padding 14.7). Width 69.33 (CT Medium 13.5 ≈ 69.7) |
| **Search capsule** | x **25.33 → 326.67**, y **193.67 → 234.33**: **301.33 x 40.67**, capsule radius 20.33. Glass fill **#333333 to #363636** + top rim highlight (lum 109) + bottom rim (105). Top gap to the header circle: 10.33 |
| Magnifier | glyph **14.67 x 14.67**, colour **#6B6B6D**, x 39.67 (14.3 into the capsule), centred vertically |
| Placeholder "Search plugins" | **13.5 Regular #6C6B6F**, ink x **64.67**, baseline 218.67 |
| **Filter circle** | **42 x 42**, x 334.67 → 376.67 (8 gap after the search capsule), centre y 214. Glass fill #333333 |
| Filter icon | 3 centred white bars (≈ `line.3.horizontal.decrease`): widths **17.33 / 11 / 4**, thickness ≈ 1.5, bar centres y 207.9 / 213.8 / 219.7 (pitch ≈ 5.9). Glyph box 17.33 x 13.33 |
| Section header ("Featured", "Team plugins") | **11 Regular #575658**, ink x **30.0**. Baseline 277 (Featured), 602.67 (Team) |
| "View all" | **11 Regular #97969C**, right-aligned, ink right **371.67** (trailing 30.3 from the screen) |
| Header baseline → first row icon top | 26.3 to 29 |
| Rows (no card, on the sheet bg) | icon tile **38.5 x 38.5**, x **29.0 → 67.67** (21 from the sheet edge), radius **11.5** continuous |
| Tile fills | brand tiles: white (#FFFFFF; Gmail/Calendar/Drive) or brand colour (Granola lime). Generic plugin tile: **#2B2B2D** with a 1 px **#363537** border and a white puzzle-piece glyph (≈ `puzzlepiece.extension` outline, about 22 pt) |
| Name | **13.5 Regular #FFFFFF**, ink x **81.67** (14 after the tile) |
| Description | **11 Regular #9C9BA0**, up to 2 lines then tail truncation "…". Line pitch 14 |
| Name baseline → description baseline | 17.0 |
| Text block | vertically centred on the tile centre |
| Row pitch | **69** with a 1-line description; **79** with a 2-line description (row height ≈ max(tile, text) + about 30.5). Pitches seen: 69, 69.33, 74 (1-line → 2-line), 79, 79 |
| **Add button** | capsule **44.67 x 32.67** (radius 16.3), fill **#2B2B2D** flat (no rim), x 328.33 → 373 (trailing 29 from the screen / 21 from the sheet), centred on the row. Label "Add" **11 Medium #FFFFFF** (CT 11 Medium 20.01 = measured 20.0); horizontal padding ≈ 12.3 |
| **Added button** | capsule **58 x 32.67**, x 315 → 373, same fill **#2B2B2D**, label "Added" **11 Medium #818183** (width 33.33, CT 33.45) |

## 6. Account (16)

| Element | Value |
|---|---|
| Header | back circle + "Account" 13.5 Medium white (as §2) |
| Profile card | 213.84 → 279.33 (**65.5**), same as the settings profile row: photo 38.5 circle at x 40.67, name 13.5 Regular white at x 89, email 11 Regular #9C9BA0. **No chevron** |
| Label "Switch Account" | 11 Regular **#575759**, x 41.33, baseline 317.33 (cap top 309 = card bottom + 29.7) |
| Switch card | 328.33 → 417.33 (89 = 2 rows of 44.5), hairline at y 372.67 (#323232, from x 40.67 to the card edge) |
| Account row | email **13.5 Regular #FFFFFF** at x 40.67 (CT 142.84 = 141.67), baseline 355.67. **Checkmark** white, glyph **12.67 x 9**, x 347.33 → 360 (trailing 18.5), centred on the row. About `checkmark` 15 pt medium |
| "+ Add Account" row | plus glyph **14.33 x 14.33** white, x 42 → 56.33, centre y 394.83 (≈ `plus` 17 to 18 pt light/regular). Label **13.5 Regular #FFFFFF** at x **68.0** (icon leading to text = 26; gap 11.7). Baseline 400 |
| Sign Out card | 444 → 488.67 (44.67), text 13.5 Regular **#F39B97**, x 41.33, baseline 471.33 |
| Delete Account card | 515.67 → 560 (44.33). Trash glyph **15.33 x 16.67**, colour **#F19A95**, x 41.67, centre y 537.67 (≈ `trash` 17 pt regular). Label 13.5 Regular **#F39B97** at x **68.67** |
| Footer | "Permanently deletes …" **11 Regular #575659**, x 41.67, first baseline 579 (cap top 570.67 = card bottom + 10.7), line 2 baseline 593 (pitch 14). Wraps at the card's content width (≈ 290 ink) |

## 7. Bot Computer (21)

| Element | Value |
|---|---|
| Header | back circle + "Bot Computer" 13.5 Medium white |
| Two-action card | **214 → 378.33** (164.33). Row 1 214 → 303.33 (89.33), hairline 303.33 → 304.33 (#313131 from x 40.67 to the edge), row 2 304.33 → 378.33 (74) |
| Row 1 title "Update Computer" | **13.5 Regular #2D6DE7** (blue). Cap top 231.33 (row top + 17.3), baseline 241.33 |
| Row 1 description | **11 Regular #9C9BA1**, 3 lines, baselines 258.33 / 272.33 / 286.67 (title → desc 17, pitch 14), bottom padding 16.67 |
| Row 2 title "Reset Computer" | **13.5 Regular #F59B97** (destructive), baseline 330.67 (hairline + 26.3) |
| Row 2 description | 11 Regular #9C9BA1, 2 lines, baselines 347.67 / 361.67, bottom padding 16.67 |
| No chevrons, no icons | the whole row is the tap target |
| Footer "The one computer your Bots share." | **11 Regular #575759**, x 41, cap top 388.67, baseline 397 (CT 182.89 = 183.0) |
| Disk space card | **427.33 → 471.67** (44.33); footer baseline → card top 30.3. Title "Disk space" 13.5 Regular white at x 41.67, baseline 454.33. Value "Normal" 13.5 Regular **#9C9AA1** right-aligned, ink right **360.33** (no chevron) |

## 8. Colour palette summary

| Token | Hex |
|---|---|
| Sheet bg | #141414 |
| Card fill | #1F1F1F to #202020 (#201F20) |
| Hairline | #313131 |
| Glass button fill (circle/capsule/search) | #333333 (rim highlights up to #646464) |
| Plugin Add/Added pill, generic tile | #2B2B2D (tile border #363537) |
| Primary text | #FFFFFF |
| Secondary (subtitle/value) | #9C9BA0 / #9C9BA1 |
| View all | #97969C |
| Placeholder / search icon | #6C6B6F / #6B6B6D |
| Chevron | #6B6A6D |
| Section label / footer | #575659 |
| Added label | #818183 |
| Toggle on | #68CE67 |
| Destructive | #F49A96 (±1: #F39B97, #F59B97) |
| Action blue | #2D6DE7 |
| Home dim | black 0.50 |
