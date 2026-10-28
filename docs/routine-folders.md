# Routine folders

A bot's routines can be sorted into folders (2026-10-28). Each routine sits in
at most one folder of its bot, and each bot keeps its folders in an order the
person chooses.

## In the app

Bot panel > Details > Routines:

- Routines in no folder come first, as the list always was. Each folder
  follows as a folding header (chevron, name, count), styled like the
  sidebar's sections. A folded folder is remembered per bot on this device.
- A row's menu (right click, its "…" button, Shift+F10) has **Move to
  folder**: the bot's folders, **New folder…** and **Remove from folder**.
  Rows can also be dragged onto a folder.
- A folder's menu (right click, "…", Shift+F10): **Rename**, **Move up** /
  **Move down** (also Alt+Up / Alt+Down on the header), **Pause the whole
  folder** or **Resume the whole folder**, **Delete folder** (its routines go
  back to no folder; none is deleted; Undo puts them back).
- A folder's **+** creates a new routine in that folder.
- When titles start with a bracketed prefix ("[Reports] Morning summary"), a
  quiet line offers **Sort by prefix** once per bot. It files each such
  routine in the folder named by its prefix and removes the prefix from the
  title. **Undo** restores the titles, folders and order. Nothing is filed
  without that click.

The iPhone and iPad app show the same sections and the same Move to folder
choices.

## Who may do it

Whoever may change a bot's routines arranges its folders: the bot's owner,
or on an organization server a member with the right to run that bot. No
admin right is needed.

## API

- Each routine carries an optional `folder`. `POST /api/routines` and
  `PATCH /api/routines/:id` accept `folder` (a name, or `null` to take it out
  of its folder).
- `GET /api/routines` carries `folders`: bot id to its folder names in order.
- `POST /api/routines/folders` with `{ action, botId, ... }`: `create {name}`,
  `rename {from, to}` (onto an existing folder: the two merge), `delete
  {name}`, `reorder {order}`, `move {routineIds, folder}`, `sort-by-prefix`
  (answers `undo`) and `restore {undo}`. The answer is `{ folders, routines,
  undo? }`.
- The live frame `routine.folders` carries `{ botId, folders }`.
- Folder names are compared without regard to case and are at most 60
  characters.

## Bots

`propose_routine` and `propose_routine_action` accept `folder` (null in an
update takes the routine out of its folder); `list_routines` shows each
routine's folder; `sagax_settings` reads and sets `routine.folder`. A bot
files its routines this way instead of writing a [Prefix] in the name.
