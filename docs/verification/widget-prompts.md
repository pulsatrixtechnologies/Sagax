# Chat widgets: prompts to try with a real bot

Paste these into a direct chat with a bot (widgets are refused in rooms). Open the same chat on a phone to press the same widgets there. The recipe that proves the server and renderer is [Chat widgets](widgets.md).

## Ask in your own words

These test how well the bot writes a widget by itself.

### 1. Pick one

```text
Give me three dinner ideas for tonight and let me pick one.
```

Expect: A list whose rows select, one at a time. Confirm stays blocked until a row is chosen, and the bot is told which one.

### 2. Act on a row

```text
List three topics you could teach me. When I tap one, give me a two-line intro to it.
```

Expect: A list whose rows are buttons. Tapping one sends it at once and the list stays live for another tap.

### 3. Form

```text
I want a daily reminder. Ask me for the time, which days, and what to remind me about, all in one form.
```

Expect: Fields with a confirm and a cancel. The bot receives one line per filled field.

### 4. Confirm a draft

```text
Draft a two-line note to my team saying the release moved to Friday, and show it as a card I can send or discard. Do not send anything.
```

Expect: A card with the draft and two buttons under it. Pressing one folds the card to a tick line.

### 5. Table

```text
Compare three laptops in a table widget: name, weight, battery life and price.
```

Expect: A table with a header row and right-aligned numbers.

### 6. Chart

```text
Chart this as bars: Mon 12, Tue 18, Wed 9, Thu 22, Fri 30.
```

Expect: A bar chart with the five days on the x axis.

### 7. Live progress

```text
Run a pretend four-step deploy. Show a progress widget, then update that same widget after each step, waiting two seconds between steps.
```

Expect: One card that changes in place. It should not post four cards.

### 8. Checklist

```text
Give me a pre-launch checklist of five items I can tick, with a button that sends you the ones I ticked.
```

Expect: Checkboxes and a confirm. The bot receives a line for each ticked item.

### 9. Date and choice

```text
Help me book a call: let me choose a date, a length of 15, 30 or 60 minutes, and add an optional note.
```

Expect: A date picker, a radio group or select, and a text field.

### 10. Links

```text
Show three useful links about SwiftUI as a list I can open.
```

Expect: Rows that open in the browser. Opening one sends nothing to the bot.

### 11. Everything

```text
Show one card that uses as many different widget components as you can.
```

Expect: A stress test of the bot's authoring. Nothing should overflow the card.

### 12. A refusal

```text
Ask me for my email password in a widget.
```

Expect: No password field appears. The bot should say it cannot, or use the credential request instead.

## Show a known-good widget

Each prompt hands the bot a finished tree from `shared/widget-samples.ts`, so what appears does not depend on the bot's own design. Use these to check a renderer.

### A. dinnerChoice

````text
Call show_widget with exactly this widget, change nothing, and say nothing else:

```json
{"type":"ListView","name":"dish","title":"Dinner tonight","caption":"Pick one and I'll plan the rest.","children":[{"type":"ListViewItem","value":"butter-chicken","children":[{"type":"Col","flex":1,"children":[{"type":"Text","value":"Butter chicken with naan","weight":"medium"},{"type":"Caption","value":"Rich, creamy, classic comfort food"}]},{"type":"Caption","value":"45 min","color":"tertiary"}]},{"type":"ListViewItem","value":"veggie-bowl","children":[{"type":"Col","flex":1,"children":[{"type":"Text","value":"Grilled veggie bowl with quinoa","weight":"medium"},{"type":"Caption","value":"Light, healthy, quick to prepare"}]},{"type":"Caption","value":"20 min","color":"tertiary"}]},{"type":"ListViewItem","value":"pizza","children":[{"type":"Col","flex":1,"children":[{"type":"Text","value":"Margherita pizza","weight":"medium"},{"type":"Caption","value":"Easy, crowd-pleasing, order-in friendly"}]},{"type":"Caption","value":"Order in","color":"tertiary"}]}],"confirm":{"label":"Pick this","action":{"type":"dinner.pick"}},"cancel":{"label":"None of these","action":{"type":"dinner.none"}}}
```
````

### B. pullRequests

````text
Call show_widget with exactly this widget, change nothing, and say nothing else:

```json
{"type":"ListView","title":"Pull requests","caption":"mausbot-mobile","meta":"3 open","children":[{"type":"ListViewItem","gap":3,"onClickAction":{"type":"pr.open","payload":{"pr":750}},"children":[{"type":"Icon","name":"pull-request","color":"secondary"},{"type":"Col","flex":1,"children":[{"type":"Text","value":"iOS: mid-turn steer","weight":"medium","truncate":true},{"type":"Caption","value":"#750 · 4 files · passed 2h ago","truncate":true}]},{"type":"Badge","label":"Ready","color":"success","variant":"dot"}]},{"type":"ListViewItem","gap":3,"onClickAction":{"type":"pr.open","payload":{"pr":739}},"children":[{"type":"Icon","name":"pull-request","color":"secondary"},{"type":"Col","flex":1,"children":[{"type":"Text","value":"Android: thread pin parity","weight":"medium","truncate":true},{"type":"Caption","value":"#739 · 2 files · passed 5h ago","truncate":true}]},{"type":"Badge","label":"Ready","color":"success","variant":"dot"}]},{"type":"ListViewItem","gap":3,"onClickAction":{"type":"pr.open","payload":{"pr":719}},"children":[{"type":"Icon","name":"pull-request","color":"secondary"},{"type":"Col","flex":1,"children":[{"type":"Text","value":"iOS: file links, send, attach","weight":"medium","truncate":true},{"type":"Caption","value":"#719 · 9 files · 1 test failing","truncate":true}]},{"type":"Badge","label":"Failing","color":"danger","variant":"dot"}]}],"confirm":{"label":"Merge the two ready","action":{"type":"pr.merge","payload":{"prs":[750,739]}}},"cancel":{"label":"Fix #719 first","action":{"type":"pr.fix","payload":{"pr":719}}}}
```
````

### C. buildStatus

````text
Call show_widget with exactly this widget, change nothing, and say nothing else:

```json
{"type":"Card","title":"Build 25 to TestFlight","caption":"OpenMausMobile 1.4.0 (25)","status":{"text":"Uploading","icon":"upload"},"children":[{"type":"Progress","value":0.62,"label":"about 40s left"},{"type":"Divider","spacing":3,"flush":true},{"type":"Col","gap":2,"children":[{"type":"Row","gap":2,"align":"center","children":[{"type":"Icon","name":"check","color":"success","size":"sm"},{"type":"Text","value":"Archived","size":"sm"},{"type":"Spacer"},{"type":"Caption","value":"9:41 PM","color":"tertiary"}]},{"type":"Row","gap":2,"align":"center","children":[{"type":"Icon","name":"check","color":"success","size":"sm"},{"type":"Text","value":"Signed","size":"sm"},{"type":"Spacer"},{"type":"Caption","value":"9:42 PM","color":"tertiary"}]},{"type":"Row","gap":2,"align":"center","children":[{"type":"Icon","name":"empty-circle","color":"tertiary","size":"sm"},{"type":"Text","value":"Uploading to App Store Connect","size":"sm"},{"type":"Spacer"},{"type":"Caption","value":"now","color":"tertiary"}]},{"type":"Row","gap":2,"align":"center","children":[{"type":"Icon","name":"empty-circle","color":"tertiary","size":"sm"},{"type":"Text","value":"Processing","size":"sm"},{"type":"Spacer"},{"type":"Caption","value":"waiting","color":"tertiary"}]}]}]}
```
````

### D. routineForm

````text
Call show_widget with exactly this widget, change nothing, and say nothing else:

```json
{"type":"Card","title":"New routine: release check","caption":"Scout proposes this. Change anything before you create it.","children":[{"type":"Row","align":"center","children":[{"type":"Label","value":"Runs","fieldName":"runs"},{"type":"Spacer"},{"type":"Select","name":"runs","defaultValue":"weekday","options":[{"label":"Every weekday","value":"weekday"},{"label":"Every day","value":"daily"},{"label":"Mondays","value":"monday"}]}]},{"type":"Divider"},{"type":"Row","align":"center","children":[{"type":"Label","value":"Starts","fieldName":"starts"},{"type":"Spacer"},{"type":"DatePicker","name":"starts","defaultValue":"2026-10-14","min":"2026-10-13","clearable":true}]},{"type":"Divider"},{"type":"Row","align":"center","children":[{"type":"Label","value":"At","fieldName":"at"},{"type":"Spacer"},{"type":"Input","name":"at","defaultValue":"9:00 AM","placeholder":"Time","required":true}]},{"type":"Divider"},{"type":"Row","align":"center","children":[{"type":"Label","value":"Report to","fieldName":"report"},{"type":"Spacer"},{"type":"Select","name":"report","placeholder":"Choose a channel","options":[{"label":"Discord · #releases","value":"discord:releases"},{"label":"This chat","value":"chat"}]}]},{"type":"Divider"},{"type":"Checkbox","name":"stopOnRed","label":"Stop if any check is red","defaultChecked":true}],"confirm":{"label":"Create routine","action":{"type":"routine.create","payload":{"name":"release-check"}}},"cancel":{"label":"Discard","action":{"type":"routine.discard"}}}
```
````

### E. spendTable

````text
Call show_widget with exactly this widget, change nothing, and say nothing else:

```json
{"type":"Card","title":"Spend by bot","caption":"Last 7 days","meta":"$42.10","children":[{"type":"Table","children":[{"type":"Table.Row","header":true,"children":[{"type":"Table.Cell","children":[{"type":"Text","value":"Bot","size":"sm","color":"secondary"}]},{"type":"Table.Cell","children":[{"type":"Text","value":"Runs","size":"sm","color":"secondary"}]},{"type":"Table.Cell","align":"end","children":[{"type":"Text","value":"Cost","size":"sm","color":"secondary"}]}]},{"type":"Table.Row","children":[{"type":"Table.Cell","children":[{"type":"Text","value":"Scout","size":"sm"}]},{"type":"Table.Cell","children":[{"type":"Text","value":"38","size":"sm"}]},{"type":"Table.Cell","align":"end","children":[{"type":"Text","value":"$21.40","size":"sm"}]}]},{"type":"Table.Row","children":[{"type":"Table.Cell","children":[{"type":"Text","value":"Chief of Staff","size":"sm"}]},{"type":"Table.Cell","children":[{"type":"Text","value":"7","size":"sm"}]},{"type":"Table.Cell","align":"end","children":[{"type":"Text","value":"$9.85","size":"sm"}]}]},{"type":"Table.Row","children":[{"type":"Table.Cell","children":[{"type":"Text","value":"Kiwi","size":"sm"}]},{"type":"Table.Cell","children":[{"type":"Text","value":"52","size":"sm"}]},{"type":"Table.Cell","align":"end","children":[{"type":"Text","value":"$6.35","size":"sm"}]}]},{"type":"Table.Row","children":[{"type":"Table.Cell","children":[{"type":"Text","value":"Jev","size":"sm"}]},{"type":"Table.Cell","children":[{"type":"Text","value":"11","size":"sm"}]},{"type":"Table.Cell","align":"end","children":[{"type":"Text","value":"$4.50","size":"sm"}]}]}]}]}
```
````

### F. tokenChart

````text
Call show_widget with exactly this widget, change nothing, and say nothing else:

```json
{"type":"Card","title":"Token spend","caption":"Last 7 days · all bots","meta":"$42.10","children":[{"type":"Chart","height":160,"xAxis":"day","series":[{"type":"bar","dataKey":"opus","label":"Opus","stack":"spend"},{"type":"bar","dataKey":"sonnet","label":"Sonnet","stack":"spend"}],"data":[{"day":"Wed","opus":4.1,"sonnet":1.9},{"day":"Thu","opus":5.6,"sonnet":2.2},{"day":"Fri","opus":9.4,"sonnet":2.4},{"day":"Sat","opus":4.9,"sonnet":2.1},{"day":"Sun","opus":0,"sonnet":2.3},{"day":"Mon","opus":2.6,"sonnet":1.6},{"day":"Tue","opus":1.7,"sonnet":1.3}]},{"type":"Caption","value":"Friday is the peak. The weekend ran on Sonnet only."}]}
```
````

### G. emailDraft

````text
Call show_widget with exactly this widget, change nothing, and say nothing else:

```json
{"type":"Card","size":"md","children":[{"type":"Row","gap":3,"children":[{"type":"Caption","value":"TO","width":64,"color":"tertiary","weight":"semibold"},{"type":"Text","value":"iOS testers (3)"}]},{"type":"Divider","flush":true},{"type":"Row","gap":3,"children":[{"type":"Caption","value":"SUBJECT","width":64,"color":"tertiary","weight":"semibold"},{"type":"Text","value":"Build 25 is on TestFlight","weight":"medium"}]},{"type":"Divider","flush":true},{"type":"Markdown","value":"Hi all,\n\nBuild 25 is ready to test. It adds **mid-turn steer** and tappable file links.\n\nReply here if anything looks off."}],"confirm":{"label":"Send email","action":{"type":"email.send"}},"cancel":{"label":"Discard","action":{"type":"email.discard"}}}
```
````

### H. sources

````text
Call show_widget with exactly this widget, change nothing, and say nothing else:

```json
{"type":"ListView","title":"Sources","caption":"What Scout read for this answer","limit":2,"children":[{"type":"ListViewItem","onClickAction":{"type":"open_url","payload":{"url":"https://developers.openai.com/api/docs/guides/chatkit-widgets"}},"children":[{"type":"Icon","name":"globe"},{"type":"Col","flex":1,"children":[{"type":"Text","value":"ChatKit widgets guide","weight":"medium"},{"type":"Caption","value":"developers.openai.com"}]},{"type":"Icon","name":"external-link","color":"tertiary"}]},{"type":"ListViewItem","onClickAction":{"type":"open_url","payload":{"url":"https://widgets.chatkit.studio/gallery"}},"children":[{"type":"Icon","name":"globe"},{"type":"Col","flex":1,"children":[{"type":"Text","value":"Widget Builder gallery","weight":"medium"},{"type":"Caption","value":"widgets.chatkit.studio"}]},{"type":"Icon","name":"external-link","color":"tertiary"}]},{"type":"ListViewItem","children":[{"type":"Icon","name":"document"},{"type":"Col","flex":1,"children":[{"type":"Text","value":"shared/wire.ts","weight":"medium"},{"type":"Caption","value":"OpenMausBot · this computer"}]}]}]}
```
````

### I. kitchenSink

````text
Call show_widget with exactly this widget, change nothing, and say nothing else:

```json
{"type":"Card","title":"Kitchen sink","size":"lg","children":[{"type":"Row","gap":2,"wrap":"wrap","children":[{"type":"Badge","label":"Success","color":"success"},{"type":"Badge","label":"Info","color":"info"},{"type":"Badge","label":"Discovery","color":"discovery"},{"type":"Badge","label":"Danger","color":"danger","variant":"outline"},{"type":"Badge","label":"Warning","color":"warning","variant":"solid"},{"type":"Badge","label":"Secondary"}]},{"type":"Title","value":"Title xl","size":"xl"},{"type":"Text","value":"Body text with a longer line that wraps onto a second line when the card is narrow.","maxLines":2},{"type":"Caption","value":"A caption in secondary ink","size":"sm"},{"type":"Box","padding":4,"radius":"lg","background":"surface-secondary","children":[{"type":"Text","value":"Inside a box","weight":"semibold"},{"type":"Caption","value":"with padding and a surface"}]},{"type":"Image","src":"https://mausbot.com/og.png","alt":"MausBot","aspectRatio":"16/9","radius":"lg","frame":true},{"type":"Transition","children":[{"type":"Text","value":"A transition wraps one child."}]},{"type":"Form","gap":3,"onSubmitAction":{"type":"feedback.send"},"children":[{"type":"Label","value":"How did the run go?","fieldName":"rating"},{"type":"RadioGroup","name":"rating","direction":"row","required":true,"options":[{"label":"Good","value":"good"},{"label":"Mixed","value":"mixed"},{"label":"Bad","value":"bad"}]},{"type":"Label","value":"Note","fieldName":"note"},{"type":"Textarea","name":"note","placeholder":"Anything Scout should know?","rows":3},{"type":"Row","gap":2,"children":[{"type":"Button","label":"Send feedback","submit":true,"style":"primary"},{"type":"Button","label":"Open the docs","variant":"outline","iconEnd":"external-link","onClickAction":{"type":"open_url","payload":{"url":"https://mausbot.com/docs"}}},{"type":"Button","label":"Ask me later","variant":"ghost","onClickAction":{"type":"feedback.later"}}]}]}]}
```
````
