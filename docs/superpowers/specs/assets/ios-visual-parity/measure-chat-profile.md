# Parity measurements: chat, computer, profile, routine screens

Source: `ios/parity-refs/` at 1206x2622 px (@3x), which is 402x874 pt. All values are in **pt** (px / 3) unless marked px.
Method: PIL pixel scans (colour runs, bounding boxes, corner-inset fits). Font sizes come from rendering SF Pro (`SFNS.ttf` variable, opsz) against the measured ink width, cap height and coverage, with iOS tracking applied. Cap-height checks (stem alpha integration) confirmed the 14 pt body and list text. Expect about ±0.5 pt on sizes and ±1 px on edges. Weights read from ink coverage: "regular" = 400, "medium" = 510, "semibold" = 590.

## 0. Shared tokens

| Token | Value | Notes |
|---|---|---|
| Screen bg (chat, profile, routine) | `#141414` | |
| Screen bg (computer view) | `#000000` | |
| Card / bubble fill | `#202020` (reads `#1F1F1F` to `#201F20`) | |
| Card divider (hairline) | `#313131` (also `#303030`/`#313030`), 1 pt | |
| Tab bar hairline | `#262626` (`#252525`), 1 pt | |
| Glass control fill | white about **13 % over the backdrop**: `#333333` on `#141414`, `#3C3C3C` on `#1E1E1E`, `#1F1F1F` to `#232323` on black | |
| Glass rim | top and bottom highlight arc `#747474` to `#858585` (about 1 pt, fading over about 3 pt); at the left and right sides a 1 to 2 px dark outer line `#030303` to `#0C0C0C` | iOS 26 Liquid Glass look |
| Primary text | `#FFFFFF` | |
| Secondary text (subtitles, role, URL, "due now") | `#9C9BA1` (`#9B9BA2`) | |
| Tertiary text (section labels, footers, inactive tabs, timestamp) | `#575659` (`#555557` for the chat timestamp) | about white at 30 % on bg |
| Disabled/empty text ("No runs yet") | `#5F5E62` | |
| Placeholder (composer) | `#6B6B6E` | |
| Icon grey (list leading icons) | `#9B9BA1` | |
| Chevron grey | `#6B6A6D` | |
| Accent blue (links, Reset, Add routine, Share) | `#2F6CE7` (text), `#2E6BE6` (icons) | |
| Destructive red (menu) | `#FF7876` | |
| Routine active green (clock icon) | `#5DA16B` (stroke core) | |
| Routine paused red (clock icon) | `#D65555` | |
| Toggle on track | `#68CE67` | knob `#FFFFFF` |
| Mascot purple | `#895BF6` | |
| Card corner radius | **16 pt** continuous (fits a 48 px circle; the tail starts about 18 pt from the corner) | name card, character card, list cards, routine cards, media tiles |
| Chat bubble radius | **20 pt** continuous | |

Round top buttons (all screens): **44 pt circles** at y 68 to 112 (centre y 90). Back button x 18 to 62. Trailing pair: x 288 to 332 and 340 to 384 (8 pt gap; 18 pt right margin). On the computer view the "?" and "..." pair is x 284 to 328 and 340 to 384 (12 pt gap).
- Back chevron: ink 8.7 x 15.3 pt, white, about 2 pt stroke. Matches SF `chevron.left` at about 20 pt medium.
- Ellipsis: three dots, each 2.67 pt, at a 5.3 pt pitch (ink 13.7 x 3 pt). Matches `ellipsis` at about 17 pt semibold, white.
- Share: `square.and.arrow.up` with ink 17.7 x 17.7 pt, white.

Status bar clock (calibration): it fits 17 to 18 pt semibold.

## 1. Chat (02-chat.png)

### Top bar
- Back circle: 44 pt glass circle, x 18 to 62, y 68 to 112. Fill `#353535` over content and `#333333` over bg.
- **Name capsule**: centred, x 159.7 to 242.7 (**83 x 44 pt**, fully rounded), y 68 to 112. Glass fill `#3C3C3C` (over the `#1E1E1E` blurred bubble), with a top and bottom rim highlight (`#80`/`#85`) and a dark side hairline.
  - Mini mascot: **24 pt** circle (ink 24.67 with antialiasing), x 171.3 to 195.7, centre y 90. That is a 12 pt leading inset.
  - "Ara": **14 pt medium** (510), white, ink x 206 to 227.7, cap top 85. Gap mascot to text is about 10 pt; trailing inset about 15 pt.
- Computer button: 44 pt glass circle, x 340 to 384. Icon `desktopcomputer` ink 18 x 16.7 pt (x 353 to 371, y 81.7 to 98.3), white.

### Content under the top bar (scroll edge)
- The content scrolls under the bar with a **progressive blur plus fade**. Bubble fill `#1F1F1F` fades to about 64 % at y≈100, about 36 % at y≈60 and 0 % (pure `#141414`) at y≈36. Fully hidden above about 36 pt; nearly full opacity by about 116 pt.
- Blur is heavy: the bubble's right edge smears over about 50 pt horizontally (Gaussian sigma about 10 to 15 pt). The text is unreadable but visible.
- Model it as an iOS 26 scroll-edge effect (`.scrollEdgeEffectStyle(.soft, for: .top)`), or as a gradient mask 0 to 116 pt plus a variable blur.

### Timestamp separator
- "Today 4:53 PM": **11 pt regular**, `#555557`, centred (ink x 161 to 240.3). Cap top 137.3, baseline about 148.3.
- About 17 pt from the baseline to the bubble top (165.3). The previous bubble ends at about 112 pt.

### Assistant bubble
- Frame x **16 to 349** (width 333 pt; right gap 53 pt, so max width is about screen minus 69, or about 83 % of 402), y 165.3 to 773.7.
- Fill `#202020`. Radius **20 pt**. No border, no shadow.
- Padding: horizontal **14 pt** (ink starts at 30.3 to 31; right-most ink 333). Vertical about **10 pt** (first line box top about 175, last descent about 764).
- Body: **SF Pro 14 pt regular**, white (cap height 9.86 pt, x-height 7.33 pt). **Line pitch 18.1 pt** (lineSpacing about 1.4 over the 16.7 natural line).
- Paragraph spacing: about **8 pt** extra (paragraph-to-paragraph top pitch 26 to 26.7 against the 18.1 line pitch).
- Inline code (`2bb4f38`, `main`, `README`): **SF Mono 12 pt regular**, white, **no chip/background** (the same `#202020` as the bubble).
- Bullets:
  - Dot: **5 pt** circle, `#5F5E61`, x 36 to 41 (centre 38.5, so about 8 pt in from the text start), vertically centred on the x-height (dot y 289.3 to 294.3 for a line with cap top 285.3).
  - Bullet text indent: x **57** (26 pt from the paragraph text start of 31). Wrapped lines align at 57.
  - Item-to-item spacing is the same as the paragraph spacing (about 8 pt extra).
- Gap from bubble bottom (773.7) to composer top (800): 26.3 pt.

### Composer
- Composer row: y **800 to 844** (centre 822). Bottom gap to the screen edge is 30 pt (home indicator). Horizontal insets **29.3 pt** each side (not 18).
- "+" button: 44 pt glass circle, x 29.7 to 73.7. Fill `#333333`, same rim as above. Plus glyph **16.7 x 16.7 pt**, stroke about 2.1 pt, white. Matches SF `plus` at about 20 pt medium.
- Field capsule: x **83.3 to 372.7** (289.3 x 44 pt), fully rounded. Glass fill `#333333` to `#353535`, top and bottom rim `#777777` fading over 3 pt, dark side hairline. Gap after "+" is about 9.5 pt.
- Placeholder "Ask Ara": **14 pt regular**, `#6B6B6E`, ink starts at x 100.7 (17.3 pt from the capsule edge; about 18 pt padding), cap centred on 822.
- Mic: ink **11.7 x 16.3 pt**, `#A3A2AA`, x 299.3 to 311, centre y 822. Matches SF `mic` at about 17 pt regular.
- Voice button: **white capsule 36 x 28 pt** (not a circle), x 327.3 to 363.3, y 808 to 836, fill `#FFFFFF`. Right inset 9.3 pt inside the field; gap from the mic is 16 pt.
  - Waveform: black, 5 vertical rounded bars, each **2 pt wide on a 3.33 pt pitch**. Heights **6, 14.7, 8.7, 14.7, 6 pt**, centred. Total ink about 15 x 14.7 pt. Close to SF `waveform` at about 15 pt semibold; a 5-bar custom shape is safer.

## 2. Computer view (13-computer.png, 11-computer-trackpad-toast.png)

- Background **#000000** (the whole screen including behind the bar).
- Top bar, all centred at y 90:
  - Back: 44 pt glass circle x 18 to 62, fill `#1F1F1F` to `#272727`.
  - Mini mascot: 24 pt at x 75.7 to 100. **No capsule** here; 13.7 pt after the back button.
  - "Ara": 14 pt medium, white, x 110.3.
  - "?" button: 44 pt glass circle x 284 to 328, glyph "?" ink 11.7 x 17.7 pt, white (SF `questionmark` at about 20 pt regular).
  - "...": 44 pt circle x 340 to 384.
- **Screenshot frame**: full width x 0 to 402, y **166.7 to 417.7** (height **251 pt**, 16:10 aspect, height = width / 1.6). No radius, no border.
- **Clipboard / keyboard buttons**: **38 pt** glass circles, fill `#1F1F1F` (`#232323` near the rim), rim highlight `#626262` at the top.
  - Clipboard: x 18 to 56, y 517 to 555. Icon `list.clipboard` ink 14 x 17.3 pt, white.
  - Keyboard: x 346 to 384, y 517 to 555. Icon `keyboard` (dots style) ink 17.3 x 14 pt, white.
  - Bottom edge about 27.7 pt above the system keyboard top (about 582.3).
- **Trackpad toast** (11): a glass capsule that grows out of the trailing buttons and covers "?" and "...".
  - Frame x **144 to 394** (250 pt), y **62 to 117.3** (**55.3 pt** tall), fully rounded (radius 27.7).
  - Fill `#202020` to `#272727` on black (white about 13 to 15 %). Top rim `#636363` 1 pt; the underlying "?" glyph shows through blurred, so it is glass.
  - Icon `cursorarrow.motionlines`: ink 13.7 x 13.7 pt, `#F8F8F8`, x 174.3 (30.3 pt leading inset).
  - Label "Trackpad mode": **14 to 15 pt regular**, `#F9F9F9`, x 202.7 (14.7 pt after the icon), cap centred at y 90.

## 3. Profile (03, 04, 07, 08, 09, 10)

### Header
- Top buttons: back (x 18 to 62), share (288 to 332), more (340 to 384), all 44 pt glass.
- **Mascot**: **84 pt** circle (ink 84.3 to 85), centre x 201, y 133.3 to 217.7 (centre about 175.5), fill `#895BF6`.
  - Top inner shade darker (`#7751D4` at the top edge, blending to `#865AF0` over about 11 pt).
  - Faint purple glow about 16 pt above (`#161519` on `#141414`).
  - Eyes: two dark tilted capsules in the upper right (ink box x 203.3 to 239.7, y 140 to 166).
- **Name card**: x 24 to 378 (354 pt), y **240 to 333.3** (93.3 pt), fill `#202020`, radius 16.
  - Name row 240 to 289.7: "Ara" **18 pt semibold**, white, centred, cap top 258.3 (cap height 13).
  - Divider at y 289.7, 1 pt `#313131`, from x **42 to 378** (18 pt leading inset, flush trailing).
  - Role row 290.7 to 333.3: "Admin" **13 pt regular**, `#9B9BA2`, centred, cap top 306.7.

### Segmented tabs
- 4 equal tabs across x 24 to 378 (88.5 pt each). Label centres x 68, 156.8, 245, 333.8.
- Labels: **13 pt regular**, cap top 378.3. Active `#FFFFFF`, inactive `#575659`.
- Hairline: y 401 to 402, 1 pt `#262626`, x 24 to 378.
- Active underline: **2 pt** white, y 400 to 402 (sits on the hairline), **64.7 pt wide**, centred under the label (tab width minus about 24).
- The first content (card or label) starts at y 418 (16 pt below the hairline).

### Info tab
- Section label "Character": **12 pt regular** (fit 11.5 to 12), `#575659`, x 42.7 (18 pt inset from the card edge), cap top 421. Label cap bottom to card top is **11 pt**.
- **Character card**: x 24 to 378, y 441 to 739.3, radius 16, fill `#202020`.
  - Shapes: 2 rows x 4. Each shape is a **35 pt** box (circle 35, square 35 with a rounded corner of about 9 pt, capsule 35 x 23, blob 35 x 32, triangle 35 x 32.7, hexagon 32 x 35, cloud 35 x 28.7, drop 28.7 x 35). Fill `#895BF6`.
    - Column centres x **110.8, 170.8, 230.8, 290.8** (60 pt pitch).
    - Row centres y **485** and **545** (60 pt pitch). First row centre is 44 pt below the card top.
  - Shape selection ring: **2 pt** stroke `#5D5D5F`, **3 pt** gap, outer diameter **45 pt** (ring y 462.3 to 507.7).
  - Swatches: **26 pt** circles.
    - Row 1 (6): centres x **68.7, 121.7, 174.7, 227.7, 280.7, 333.7** (53 pt pitch, 27 pt gap), centre y **613**. Colours `#FFFFFF`, `#8C6640`, `#EB4045`, `#ED712D`, `#F19D38`, `#5AC67A`.
    - Row 2 (5): centres x **95.2, 148.2, 201.2, 254.2, 307.2**, centre y **657** (44 pt row pitch). Colours `#54B9A6`, `#3C82F7`, `#895BF6`, `#EB4699`, `#777777`.
  - Swatch selection ring: **2 pt** `#5D5C5E`, **3 pt** gap, outer **36 pt**.
  - Last swatch ring bottom 675 to divider 693 is 18 pt.
  - Divider y 693, 1 pt `#313131`, x **42 to 378**.
  - "Reset to default" row 694 to 739.3 (**45.3 pt**): **14 pt regular** `#2F6CE7`, x 43, cap top 711.
- Footer "How this Bot's mark looks everywhere": **12 pt regular** (11.5 to 12), `#575659`, x 42.7. Cap top 750.3, which is 11 pt below the card.
- Gap from footer to the next card is about 17 pt. Gap from a card to the next section label cap top is about 19 pt.
- **Instructions card** (single row): y 778.3 to 824.7, **46.3 pt** row.
  - Leading icon (doc with lines, like SF `doc.text`): ink **14 x 17.3 pt**, `#9B9AA2`, centre x 54.
  - Title "Instructions": **14 pt regular** white at x **76.7**.
  - Chevron: ink **7 x 12.3 pt** `#6B6A6D` at x 348.7 to 355.7 (22.3 pt right inset), vertically centred.
- "Routines" label: 12 pt `#575659`, cap top 843.7.

### Info tab, scrolled (04) and more menu (07)
- **Routines card**: 3 rows. Measured on the 04 frame: top 477.7, bottom 650.7.
  - Routine row height **63.3 pt** (rows 477.7 to 541, 542 to 604.3).
  - Leading clock icon (SF `clock`) **17.3 pt**, centre x 54, vertically centred. Green **`#5DA16B`** for active, red **`#D65555`** for paused.
  - Title: **14 pt regular** white, x 76.7, cap top 17.7 pt below the row top.
  - Subtitle: **12 pt regular** (11.5 to 12), `#9C9AA1`, about 20 pt below the title cap top. The subtitle is the cron string or "Every Monday at 7:00 AM · Paused".
  - Chevron as above.
  - Dividers 1 pt `#313031` from x **76 to 378** (inset to the text column, flush right).
  - "Add routine" row **45.3 pt**: blue `plus` 14.7 x 14.7 pt `#2F6BE5`, centred at x 54. Label **14 pt regular** `#2E6CE6` at x 76.3.
- **Notifications card**: **56 pt** tall (666.7 to 722.7), 16 pt below the routines card.
  - "Notifications": 14 pt regular white at x 43.
  - Toggle **63 x 28 pt** at x 297 to 360 (18 pt right inset), centred.
    - Track `#68CE67`.
    - Knob: white **pill 37 x 24 pt** (iOS 26 style), 2 pt inset.
- Footer "Get notified when this Bot finishes or needs input": 12 pt `#575659`, 11 pt below the card.
- **Share as Template card**: 46.3 pt (761.7 to 808).
  - `square.and.arrow.up` icon 16 x 16 pt `#2E6BE6`, centre x 54.
  - Label **14 pt regular** `#2F6BE7` at x 76.7.
- Content scrolled under the top buttons fades and blurs the same way as chat: card `#201F20` goes to `#1C1C1C` at y 112, to `#181818` at y 64 and to bg by about y 40.
- **More-menu popover** (07): a glass panel morphing from the "..." button.
  - Frame x **143.7 to 393.7** (**250 pt**), y **62 to 153** (**91 pt**), radius **32 pt**. That is 8.3 pt from the right screen edge and 6 pt above the button top.
  - Fill: neutral `#393939` to `#3D3C3D` over the `#202020` card (white about 11 to 13 %), with strong blur of the content behind (the purple shapes show through tinted, `#594684` to `#5E4892`). Top rim highlight `#6D6D6E` to `#7B7390`, 1 pt.
  - 2 items: row pitch about **36 pt**, item centres y about 89.5 and 125.7 (vertical padding about 9.5 pt).
    - Icons at x **174** (30.3 pt inset): `doc.on.doc` 14 x 17.3 pt white, and `trash` 13.3 x 15.3 pt `#FF7876`.
    - Labels at x **203** (59.3 pt from the panel edge): **14 pt regular**. "Copy ID" `#FAF9FC`; "Delete Bot" **`#FF7876`**.
    - No separators.
  - The toast (section 2) uses the same geometry: x 144 to 394, icon x 174, text x 203.

### Links tab (08)
- Card x 24 to 378, y 418 to 574. **Row height 78 pt** (2-line URL).
- Globe icon (SF `globe`): **17.3 pt**, `#9B9BA1`, centre x 54, vertically centred in the row.
- Title (host): **14 pt regular** white, x 76.7, x-height top 438.7 (20.7 pt below the row top).
- URL: **12 pt regular** (11.5 to 12) `#9C9BA1`, up to 2 lines, truncated with an ellipsis at the end (`lineLimit(2)`). Line pitch **14.7 pt**. First line top 16.7 pt below the title x-height top.
- Divider 1 pt `#313031`, x 76 to 378. Chevron as above.
- "Show more": **14 pt medium** (510), `#97959C`, centred. Cap top 606.7, which is **32.7 pt** below the card bottom.

### Media tab (09)
- 2-column grid of square tiles **173 x 173 pt**. Tile 1 at x 24 to 197, tile 2 at x 205 to 378. **Gap 8 pt**. Top y 418.
- Radius **16 pt**, aspect fill, no border.
- "Show more" cap top 623.7 (33 pt below the tiles).

### Files tab (10)
- Card y 418 to 557. Rows **46.3 pt** (including the 1 pt divider), 3 rows.
- File icon (doc): 14 x 17.3 pt `#9C9BA1`, centre x 54.
- Name: 14 pt regular white at x 76.7.
- Divider x 76 to 378. Chevron as above.
- "Show more" cap top 589.7 (32.7 pt below the card).

## 4. Routine detail (05) and instruction (06)

- Nav: back circle 44 pt (x 18 to 62). Title inline at x **78.7** (16.7 pt after the button), cap centred on y 90.
  - Title font **14 pt medium** (cap 9.86 pt; stem heavier than regular rows; semibold is possible, medium fits best), white, single line.
  - Example titles: "Scan skills populaires mensuel" and "Instruction".
- Cards here use **16 pt side margins**: x 16 to 386 (370 pt wide), radius 16, fill `#202020`. Text inset **18 pt** (text x 34.3 to 35).
- **Active card**: y 128 to 184 (**56 pt**).
  - "Active" 14 pt regular white.
  - Toggle 63 x 28 pt at x 305 to 368 (18 pt right inset), track `#68CE67`, white pill knob 36.3 x 24 pt.
- "Schedule" label: 12 pt (11.5 to 12) `#57575A`, x 34.7, cap top 203 (19 pt below the card). The card follows 11 pt after the label cap bottom.
- **Schedule card**: y 223 to 315.7.
  - Row 1 (46.3 pt): cron string, 14 pt regular white.
  - Divider at y 269.3, 1 pt `#302F30`, from x **34 to 386**.
  - Row 2 (45.3 pt): "Next run" 14 pt regular white on the left; value "due now" **14 pt regular `#9C9BA0`**, right-aligned to x 367.3 (18.7 pt right inset).
- **Instruction card**: y 331.7 to 378 (46.3 pt), 16 pt below the previous card.
  - "Instruction" 14 pt regular white.
  - Chevron 7 x 12 pt `#6C6B6D` at x 356.7 to 363.7 (22.3 pt right inset).
- "Run history" label: 12 pt `#575758`, cap top 397.
- Empty card: y 417 to 463.3 (46.3 pt), "No runs yet" **14 pt regular `#5F5E62`**.
- **Instruction view (06)**: one text card x 16 to 385.7, y **128 to 572.3** (grows with content), radius 16, fill `#202020`.
  - Text **14 pt regular** white, left aligned, x 34.7 (18 pt horizontal padding).
  - **Line pitch 18.1 pt** (same as chat). An empty source line renders as a full blank line (36.3 pt gap).
  - Vertical padding about **14 pt** to the line box (first cap top 145.7, which is 17.7 below the card top; last descent about 557.3, which is 15 pt above the bottom).
  - Wraps to about 328 pt.

## 5. Implementation notes
- Fonts: everything is the SF Pro system font; only inline code uses SF Mono.
  - 14 pt regular is the workhorse: body, rows, values, placeholder.
  - 12 pt for section labels, footers and subtitles; 13 pt for tabs and role; 11 pt for the chat timestamp.
  - Name 18 pt semibold; capsule and nav titles 14 pt medium; "Show more" 14 pt medium.
- Standard list row is 46.3 pt including the divider (about 45.3 + 1). Two-line routine row 63.3 pt; link row 78 pt.
- Insets:
  - Profile cards: 24 pt side margin, 18 pt text inset, icon column centred at x 54, text column at x 76.7.
  - Routine screens: 16 pt margin, 18 pt inset.
  - Chat bubble: 16 pt margin, 14 pt inset.
  - Composer: 29.3 pt margin.
- Glass: for every circle, capsule, toast and menu, use `.glassEffect()` (iOS 26) or an equivalent. The measured result is about 13 % white plus blur, a bright 1 pt top and bottom rim, and a dark side edge.
