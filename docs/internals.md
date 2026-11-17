# Internals: what the code cannot say

Read the section of the area that you change. [architecture.md](architecture.md)
gives the shape and the patterns, and this page does not repeat them. If a
section names no base, or a path is outside it, the path starts at `web/src/`.

## Editor engine

Paths are under `web/src/editor/engine/`.

**A valid document.** `domain/invariants.ts` defines it. In development, the
validation interceptor in `application/commands.ts` checks every command
result. Production builds do not run it.

- A document holds at least one paragraph. Only the codec accepts `[]`.
- A page break holds no runs. Every other paragraph holds at least one run.
- Cursor offsets count UTF-16 code units of the visible text, never Markdown
  characters. Backspace and Delete remove one grapheme cluster.
- If an operation needs a state that the checker forbids, correct the
  operation. Do not weaken the checker.
- Do not change a `Doc` in place. Undo states share paragraph objects.

**Words.** `domain/words.ts` is the only definition of a word character.
Search, the diff and the highlighter build on its `WORD_CHARS` and
`HYPHEN_JOINERS`. Do not write a second list. `hyphensJoinWords` is false by default, and the diff always joins
hyphens. A search match never crosses a page break.

**Undo and redo.**

- Production uses `DeltaTimeline` (`adapters/delta.ts`). `SnapshotHistory` is
  the test oracle.
- The session decides what merges (`shouldMerge` in `application/session.ts`).
  Put a merge rule in the session, not in an adapter.
- Undo never walks a side branch.
- A journal from disk is untrusted. If one shape check fails, the store drops
  the whole journal.
- A new history adapter passes `ports/history.contract.test.ts` and the
  differential rows in `adapters/delta.test.ts`.

**Commands.** Add an edit as a factory in `application/editorCommands.ts` and
a session method that calls the private `commit`. `commit` applies the
read-only gates of the diff modes and records the history step. Only open,
undo and redo call the bus directly. A `run` that changes nothing returns
`null`, so no step is recorded.

**Add a block type or a format flag.** Change these together:

- `domain/model.ts` and the lists in `domain/invariants.ts`.
- The codecs `adapters/commonmark.ts`, `adapters/html.ts` and
  `adapters/browserHtml.ts`.
- `paragraphsEqual` in `adapters/delta.ts`.
- `DIALECT` in `security/trustedHtml.ts`, if the renderer writes a new
  element or attribute.

Then check the mappings in `editor/export` and `editor/import`.

**Change a contract.**

1. Change the contract test in `ports/*.contract.test.ts` first, and see it
   fail.
2. Put the port, its contract test and its header comment in one commit.
3. If `boundaries.test.ts` fails, move the import. Do not relax
   `ALLOWED_IMPORTS`.

## Writing views

Paths are under `web/src/editor/views/`.

**The one question.** The `Scroller` (`view/scrollStrategy.ts`) decides
where a view holds the caret. Do not add a typewriter flag to `EditorCore`.
Put the difference in a `Scroller`.

- The core calls `hold` after a document change, `onCaretMove` when only the
  caret moves and `reflow` when lines move without input (a late web font).
  Each returns true only when the writing line moved.
- The core reads `wheelPolicy` before the native scroll starts. On `ratchet`
  it stops the native scroll and steps one line.

**Who owns what.**

- `editor/EditorRoute.tsx` imports only `engine.ts`, `view/port.ts` and
  `view/registry.ts` from this folder.
- Only the view adapter creates `.editor-surface`. `EditorCore` finds it as
  the parent of its root; do not pass it as a prop.
- `WritingViewHandle` has `surface()` and `focus()`. Do not add a third path
  back to the shell.
- `writing/dom.ts` is the only map between DOM points and `{ para, offset }`.
- `viewFor(name)` throws on an unknown name; do not add a fallback. A change
  of view remounts the surface. If a change replaces the surface, add it to
  `viewKey` in `editor/EditorRoute.tsx`. Otherwise a listener stays on the
  old element.
- `measureCaretRect` in `writing/caret.ts` restores the selection only if it
  moved. An unconditional restore fires `selectionchange` again and loops.

**Add a view.**

1. Write an adapter in `view/adapters/` that renders the desk, the frame and
   `EditorCore` inside its own `.editor-surface`.
2. Choose or write a `Scroller`.
3. Call `registerView` in `view/registry.ts`. Change `viewFor` and `viewKey`
   in `editor/EditorRoute.tsx`.
4. Run `runViewContract` from `view/contract.fixture.ts` in its test.

jsdom measures every rect as zero, so layout needs a real browser. The station
is checked by `web/e2e/station-probe.spec.ts` and the typewriter behaviour by
`web/e2e/typewriter-*.spec.ts`. A new view that holds the line adds a row to
the station probe.

## Typewriter and focus

Typewriter (on or off) and focus (off, line or paragraph) are independent
preferences. The phone layout honours neither, and it never rewrites the
stored value (`forPlane` in `editor/writingPreferences.ts`). Paths are under
`web/src/editor/views/writing/`.

**The station** is the vertical middle of the visible part of
`.editor-surface`, never of the window (`stationY` in `station.ts`).

- The fraction 0.5 is a constant, not a setting. Equal context above and below
  keeps recent sentences in one place.
- Chrome over the surface moves the station. `visibleCentre` in
  `stationProbe.ts` uses the same rule; change the two together.
- The line glides to the station in 300 ms (`glideScrollTo`). While the
  pointer is down, the line does not move. An open IME composition freezes
  the station.
- `QuietWindow.extend` keeps the later deadline. An earlier one would make the
  app read its own scroll as the writer's.

**The paper feed.** `TypewriterView` sets `--feed-top` and `--feed-bottom` to
half the surface height, so the first and last lines can reach the station.
Put the feed padding on `.editor`, never on `.editor-surface`: the surface is
`position: absolute; inset: 0`, and padding there starts a resize loop.

**Focus** dims the column (`.editor.focus-dim`) and paints the unit at the
caret back with the `focus` CSS Custom Highlight.

- Do not wrap the unit in a `<span>`. The patcher would then rebuild the
  document on every keystroke.
- Do not dim with `opacity`. It also fades the caret and the search marks.
- The units are the visual line and the paragraph only. A sentence boundary
  moves under the caret while the writer types.
- Find the line again on every paint. A wrap moves its boundary.

**Reduced motion.** `glideScrollTo` sets `scrollTop` at once and reads the
media query at each move. The station still holds the line: a still line is
not motion.

## Project format on disk

[architecture.md](architecture.md#the-on-disk-project-format) gives the layout,
the Markdown dialect and the Golden Rule.

**Open.** `readProject` in `editor/project/application/projectOpener.ts`
checks these in order. The first failure refuses the open.

1. The properties file.
2. The snapshot catalogue. A missing catalogue is never read as empty.
3. The structure yaml and the Golden Rule.
4. The records of each node.
5. The files in `document/` against the records.


- A file with a newer `schemaVersion` than the build is refused. The reader
  keeps only the fields that it knows, so a write would drop the rest.
- Do not add a `part--*.md` or `section--*.md` file to `document/` by hand. No
  record names it, so the open is refused.
- The app never writes into a folder that it refuses.
- Add a new yaml field to the type, `readEntry` and `toPlain` together. They
  are in `project/structure.ts`. A field that one of them lacks is erased by
  the next write.

**Write order.** `commitChange` in `editor/project/application/commitFunnel.ts`
is the only path for a structural change.

- `applyFiles` moves the files first. The yaml, the catalogue and the
  properties follow.
- If a step fails, the funnel tries to put back each write that landed. A put
  back can fail too, and the result says so (`restored`).
- An undo writes the metadata first, then calls `revertFiles`. It never runs
  `applyFiles` again, because a recreated file would overwrite newer prose.
- If an undo fails, the metadata goes forward again. If that write also fails,
  the undo throws `RollbackIncomplete`.
- Keep `revertFiles` the inverse of `applyFiles`. The rollback and the undo
  both use it.

**Drag and drop** in the structure tree uses pointer events, not HTML5 drag
and drop. A drag starts only from a mouse, after 4 px. `canDropAll` in
`project/mutations.ts` decides what is legal. Esc cancels and writes
nothing.

**Test without a folder picker.** `/app/editor/demo` opens a fixture project
from `storage/memoryProvider.ts`. On that path, `window.__demo` holds
its files. Damage a file there to reach the refusal states. Never expose a
real storage handle or token through that probe.

## Settings synchronization

The merge is in `profile/portableDoc.ts`.
[architecture.md](architecture.md#patterns) gives its principle.

- An installation is one browser profile on one origin. All writer accounts in
  that browser share its id.
- On equal stamps, the larger installation id wins. Compare stamps as times,
  never as text.
- Only library rows have tombstones, and they are never pruned. A read keeps
  the first 5,000 valid rows.
- An entry stamped more than 5 minutes ahead of this clock waits. A slow clock
  can lose edits to older edits from other devices; that is an accepted limit.
- Add each new portable preference to `DOMAIN` in `portableDoc.ts`, or no
  other installation imports it.

## The app's log

The log is in `web/src/log`. `appLog` is its only entry for the rest of the
app; `App.tsx` alone imports the page from `log/page.ts`.
[CONTRIBUTING.md](../CONTRIBUTING.md#rules-the-gates-cannot-fully-check)
says when code writes a line.

- A line is redacted when it is made, never later. `redact.ts` replaces:
  - email and IP addresses, but not a product's version such as
    `Chrome/131.0.0.0`;
  - `dedyn.io` names and the secrets in a query;
  - the values that the writer registry knows: the Google name, the emails,
    the Google `sub`, the photo address and the Drive connection id;
  - each word of the Google name, as a whole word, as Google gives it and
    with a capital. In lower case it is the ordinary word: "will" is not
    "Will".
- Redaction cannot know a title, a folder name or a sentence of the
  manuscript. Code keeps them out of a line:
  - An error whose message can hold one has `toLog()`, which gives the safe
    fields in its place, as `StorageError` and `ModelRunError` do.
  - A project goes in a line as `refForLog(ref)` (`project/logRef.ts`): the
    provider and the project uuid. `ref.key` is a folder name that the
    writer chose.
  - `describeError` keeps the frames of a stack and drops the header that
    repeats the message. It keeps only the name of a `SyntaxError`, whose
    message quotes the text that `JSON.parse` read.
- Lines wait 1 second and go to IndexedDB together; an `error` line goes at
  once. At `pagehide`, the lines that wait and the batches that IndexedDB has
  not confirmed go to `localStorage`, which writes at once. The next start
  writes them first. A line can then appear twice.
- The store keeps the size of all the lines in one record, at id 0, and
  changes it in the same transaction as the lines. A prune reads only the
  lines that it removes: those past 14 days, then the oldest while the
  lines are past `MAX_SIZE` characters, down to `TRIM_TO`
  (`domain/retention.ts`).
- The demo site keeps no log. Its build replaces `log/index.ts` and
  `project/logRef.ts` with twins that do nothing, and its gate refuses the
  rest of `log/` (`build/demoBuild.ts`, `build/demoBoundary.ts`).
- The store is one for each browser, not for each writer account. Each
  line carries the writer account id, so a line tells which account wrote
  it. A sign-out that cleans this browser, and so an account deletion,
  empties the whole store, the lines of other accounts included. The store
  keeps 14 days and 10 MiB of text.

## Costs of the shape

[architecture.md](architecture.md#security-posture) gives the other costs.

| Decision | What it buys | Its cost |
| --- | --- | --- |
| One library per computer | One origin holds the saved work and the folder permissions | That computer always opens `localhost`, never the home-network name |
| Strict reading of the format | The app never guesses the shape of a manuscript | A file added by hand refuses the open until the writer fixes it |
| `identity` as a separate binary, supervised by the desktop program | No shared code; the service also runs alone in development | A second binary, a second port and a supervisor |
