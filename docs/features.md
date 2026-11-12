# Features

The full list of what Phospheare does today, grouped by area. The README
keeps the short version; this is the long one. "Drive" below is Google Drive,
which the app calls Remote Storage.

## How it runs

- **On your computer.** `once-dark-studio-desktop`, one program for Windows,
  macOS and Linux, serves the app on `http://localhost:47821` and opens the
  default browser. Its setup page at `/desktop/setup/` holds the Google
  client, home-network access, start at login and the update check.
- **Phones and tablets at home**, optionally, over HTTPS at a free
  `dedyn.io` name ([home-network.md](home-network.md)).
- **Without the identity service**, as under the Vite dev server, the app
  works with the account without Google, folders and this device only.

[architecture.md](architecture.md) describes how the pieces fit together and
where each kind of data goes.

## Library and projects

- **Shelf.** Project cards with word count, percent of goal, last edited and a
  spine glyph: a small bar figure sized by words. Grid or list density, an
  accent-insensitive filter and a command palette (Ctrl/⌘K) over projects and
  commands.
- **Create wizard.** Choose where the project lives (a device folder or Google
  Drive), a starting structure (none, Three Acts, Kishōtenketsu, Freytag's
  Pyramid or Hero's Journey); a type with a word goal (Novel, Epic Novel,
  Novella, Short Story, Flash Fiction or your own); up to two of nine genres;
  a reader age category; up to eight tropes; a project language (English,
  Spanish, Portuguese, French, German or Italian); then the title and author.
- **From the card:** properties, duplicate and export. Retitling a Drive
  project renames its folder.
- **Three storage modes.** Device only, Drive only and a device folder paired
  with Drive ("synced"). An in-memory demo project exists beside them.
- **Sync.** Per-file change detection against stored baselines, automatic pull
  and push when nothing conflicts and whole-project conflict resolution: keep
  the device version or the Drive version. The losing side is backed up to
  disk first.
- **Move between storages.** Move to Drive or to the device with a
  copy-then-verify flow and a progress dialog. Delete sends a Drive folder to
  Drive's bin. Forget removes a card and deletes nothing.
- **First run and empty states** explain the options instead of showing a
  blank screen.

## Writing

- **Two views: scroll and typewriter.** The typewriter view holds the current
  line at the visual centre, ratchets one line per wheel notch and eases the
  scroll.
- **Focus mode** (off, line or paragraph), a **smooth caret** and three prose
  sizes.
- **Henosis mode.** After a few seconds of writing the controls fade out and
  the prose widens. Mouse movement, Esc, a pause or a dialog brings them back.
  Its three timings are configurable.
- **Formatting.** Bold, italic and monospace; change case; Title, Subtitle and
  Body blocks; page breaks; left, centre, right and justified alignment; a
  special-characters panel.
- **Typographic keys.** Curly quotes, guillemets, em and en dashes, an
  ellipsis and accented capitals.
- **Keyboard.** A generated shortcut sheet (`?` or Ctrl+/) and a command board
  (Ctrl/⌘K), which is also the route to every panel on a phone.
- **Find and replace** with case, whole-word and hyphen options, and queries
  that can include a paragraph break.
- **Project-wide search** over titles, body text, the bin, reference documents
  and chat turns. A result lands on the exact occurrence.
- **Selection tools.** A floating bubble, touch edge bars and a context menu.
- **Autosave**, on by default every 30 seconds, with a delay from 5 seconds
  to 5 minutes, and a guard against leaving with unsaved text.
- **The desk.** The screen shown when no file is open: your last paragraph, the
  shape of the book, what changed since your last session and the open
  thread, taken from the latest `TODO`, `??`, `TK` or `XXX` marker.
- **A save gutter** marks unsaved and failed paragraphs.
- **Responsive.** Below 1016 px the dock lies over the prose as a sheet, and
  the structure panel starts folded. At 720 px and below, the controls move to
  the bottom edge, above the soft keyboard.
- **A demo editor** at `/app/editor/demo` opens without a writer. Its
  assistant answers from ShAIne, a built-in demo model with fixed sample
  replies that never touches the network.

## Structure and history

- **Structure tree.** Add, rename (F2), a per-row menu, word counts, comment
  bubbles and save glyphs. It collapses to a rail and resizes.
- **Drag and move.** Pointer drag with an insertion line, multi-select of one
  kind and a "Move…" dialog for touch.
- **Recycle bin** for Parts, Sections, reference documents and snapshots.
- **Snapshots.** Add, adopt, rename, delete, preview and compare as an inline
  diff with per-hunk accept, by word, sentence or paragraph.
- **Revision rail.** A margin hairline that walks the undo timeline as a
  preview; "Revert to here" applies one undoable step.
- **Reference panel.** Guidebook, characters with arcs, summaries,
  worldbuilding and free notes, with English and Italian templates.
- **Margin comments.** Anchored by quote and context, re-anchored when the
  text moves. Threads are proposed, open or resolved, with markers, cards and
  navigation.

## AI assistant

- **Providers.** A local Ollama model (loopback only), or remote models through
  OpenRouter with the writer's own key, called straight from the device, with
  live key status and a curated set of models. Settings and the chat bar name
  the vendor, and commands that send summaries or whole Sections say so before
  you press Enter.
- **The OpenRouter key.** Approved on the writer's own OpenRouter account,
  and accepted only with a spend limit of $5 or less set there. The writer
  keeps it in the tab, or lets the computer remember it. Settings shows the
  limit and, when the key has one, the expiry; the assistant's meter shows
  what has been spent. [ai.md](ai.md) explains how the key is kept and
  checked.
- **Chat kinds.** General, Drafting, Alpha reader, Beta reader and Editorial.
  Each chat also has a persona, a model and a mode slider from Creative to
  Standard that sets temperature and reasoning effort.
- **Personas.** Phos (editor-in-chief), Nova (line editor), Spark (story
  editor) and Lumi (the reader). Each has focus presets built from a catalogue
  of craft concerns: structure, character, point of view, prose, dialogue,
  continuity, authenticity and more.
- **Craft pre-pass.** Ten deterministic detectors run in the browser with no
  model: perception verbs, sentence rhythm, word echoes, hedges, attempt verbs,
  manner adverbs, dialogue tags, dialogue runs, numbers in narration, and
  dialogue marks. Their output is offered as candidates, and the model judges
  fault versus choice.
- **24 slash commands, by the chat that offers them.**
  - Every chat except the readers': `/where` (find a described moment), `/map`
    (place Parts or Sections on a story structure and draw it), `/verify`
    (check a real-world claim on the web), `/how-to-say` (ways to phrase a
    meaning).
  - Drafting adds `/unstick`, `/what-if` and `/scene-plan`.
  - Editorial adds the reviews `/unresolved`, `/continuity`, `/canon`,
    `/structure-and-motivation`, `/line-editing` and `/sensitivity`, plus
    `/summarise`, `/letter`, `/first-pages` and `/genre`.
  - Beta reader: `/read-on`, `/predict`, `/put-down`, `/review`, `/blurb`.
  - Alpha reader: `/heart`, `/intent`.
- **Reviews** are resumable and checkpointed. Quoted evidence is verified
  against the text. Verified findings that sit in one chapter become margin
  comments proposed for you to keep, answer or dismiss.
- **Editorial letter.** `/letter` also weighs what the reader chats and
  drafting chats found, and produces a Must/Should/Could revision plan you can
  tick off.
- **Fact-checking** (`/canon` and `/continuity`). Quoted claims are extracted
  into per-section ledgers. Plain code finds disagreements (names, numbers,
  calendar, years, travel, reference sheets). A small model judges the most
  likely ones and reports how many it could not judge. A separate pass checks
  the rules and the who-knows-what notes written in the reference sheets.
- **Web search** with per-search approval of the exact query, which you can
  edit. At most three searches per answer: Wikipedia is always available, in
  the book's language and with no key, and OpenRouter's search tool, with
  Exa as its engine, is used when the writer has a ready key. Results reach the model as data, never as
  instructions. Reader chats never search.
- **Beta-reader journal** with an attention curve and a prediction ledger.
- **Margin replies.** `@mention` a persona in a comment thread and it answers
  there. A drafting chat's "for later" notes become proposed comments in the
  Section.
- **Privacy controls.** Keep any reference sheet, note or summary from the
  assistant, in every chat, with the button on its row. The manuscript's
  Sections cannot be kept out, because reading them is the assistant's job.
  Reader personas see the book only up to the point the reader has reached.
- **Chat management.** Chats are JSON files in the project. Rename, delete,
  search, copy, edit-and-undo, queue, stop, retry and continue in a new chat.
  Older turns are summarized to fit the model's window.
- **Evidence in the UI.** Clickable quotes that jump to the text, a folded
  trace of each step and meters for context-window use and key credit.

## Import and export

- **Export** (8 formats): docx, odt, pdf, rtf, epub, html, Markdown and text.
  Choose what goes in (manuscript, references, notes), a layout (Book,
  Manuscript modern or classic, Review copy), a page size (A4, Letter, Trade
  6×9 in, Digest 5×8 in), author and contact details, a running header, a
  title page, a facts page and a table of contents. Files land in `export/`
  in every home the project has and are never overwritten. DOCX, ODT and RTF
  are written by hand with named styles; PDF uses pdfmake; the zip formats use
  fflate.
- **Import** (7 formats): docx, odt, rtf, Markdown, text, HTML and EPUB,
  detected from the bytes. Chapter-splitting rules (headings, numbered titles,
  bold or centred lines, page breaks, files, a separator you type),
  chapter-title patterns in six languages, table-of-contents and
  front-matter and back-matter detection and a chapters step to include,
  rename, split, merge and re-level. Review comments from docx, odt, rtf, epub
  and html become margin threads with replies and resolved state. Footnotes,
  pictures and text boxes are not kept, and the app says so. Files are
  bounded against oversized and zip-bomb input.

## Writers and settings

- **Sign in with Google.** While the identity service answers, the landing
  page offers *Log in with Google*, which opens Google in a popup. Without the
  service, the landing page offers only the way in without an account, and
  *Start writing* takes that way. A sign-in that does not finish says why and
  offers to try again.
- **One record per Google account.** Each browser keeps a record for every
  Google account that signed in to it, and the same account finds its shelf
  again at the next sign-in, unless it cleaned this browser when it signed
  out. Connecting Drive with a different account is refused before anything
  is kept. A revoked or expired Drive grant pauses sync and asks to
  reconnect.
- **Without an account.** *Continue without an account* opens this browser's
  one account without Google: its shelf and settings live on this device
  only, and Remote Storage needs a Google account.
- **Sign out.** Sign out writes the open text, then asks one question, the
  same for both kinds of account: *Leave everything as it is* for the next
  sign-in, or *Clean everything from this browser*. A clean removes the shelf
  and settings copy, folder access, the working copy, a kept key and this
  browser's Remote Storage connection, without revoking it elsewhere. While
  changes are still waiting for Remote Storage, the sign-out says how many
  files they are in. Every tab of a browser profile follows a sign-out made in
  another, and writes its open text first.
- **Disconnect Remote Storage.** From this browser only, or from every device,
  which revokes the app's access at Google; disconnecting from every device
  can also delete the settings and library kept there.
- **Delete your account.** Settings deletes the account's settings and library
  from this browser and, while Remote Storage is connected, from Remote Storage,
  and revokes the app's access at Google. If a step fails, the deletion stops
  there and says what was done. Projects are not touched.
- **Settings and shelf in Remote Storage.** While Remote Storage is
  connected, preferences and the shelf (never book text, never keys) are
  kept in the account's Drive, so they follow the account to other devices
  and survive a sign-out
  ([architecture.md](architecture.md#patterns), "A profile per account"). This pauses when the device is offline or
  Drive needs reconnecting, and the app says so.
- **Licence and data-flow notices.** The privacy notice, licence notes and
  legal notice are pages to read at `/privacy`, `/terms` and `/legal`,
  linked from the landing and Settings; nothing asks to accept them.
- **Not offered.** There is no list of signed-in devices with remote sign-out:
  a session exists only on its device.
- A settings sheet with six panes: How it looks, Where words live, How you
  write, Set up your AI, Who you are and About. The About pane states the
  licence.
- Four theme families, Matte, Radiant, Shine and Vision, each with a light
  and a dark variant.
- UI in English and Italian, with a parity test between them.
- Installable as a PWA. The program starts on the computer with no
  connection. There is no service worker, so a phone or tablet opens the app
  only while it can reach that computer on the home network.
- Accessibility: focus traps and layered Escape, live regions for status,
  reduced motion, safe-area insets, 44 px touch targets and a platform back
  gesture that closes overlays.
