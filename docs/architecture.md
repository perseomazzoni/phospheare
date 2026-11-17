# Architecture

How Phospheare is put together: the web app and its platform layer, the
accounts and connections, where the manuscript lives and where it does not,
the patterns the code follows, the on-disk project format and the security
posture.

Other documents hold the detail:

- [CONTRIBUTING.md](../CONTRIBUTING.md): setup, tests and the rules for
  anyone who changes the code;
- [identity-contract.md](identity-contract.md): the identity service's routes,
  cookies and flows;
- [ai.md](ai.md): how the assistant reaches OpenRouter, Wikipedia and Ollama;
- [GLOSSARY.md](../GLOSSARY.md): the terms for accounts, sessions and
  connections.

## The shape

```
your browser
  React 19 SPA
     │  same origin, /identity/*
     ▼
once-dark-studio-desktop (Go, localhost:47821)
  serves the SPA and, through the identity
  service, seals Drive refresh tokens and a
  remembered OpenRouter key in HttpOnly cookies
     │
     └──────────► Google (sign-in, Drive token exchange and refresh)

From the SPA directly:
  · the device's disk       (File System Access API)
  · Google Drive            (Drive v3 REST, with a one-hour token from the platform layer)
  · OpenRouter              (the writer's own key: approval, chat, catalogue, search)
  · Wikipedia               (keyless search, in the book's language)
  · a local Ollama          (loopback only)
```

The product is one SPA, served by one program on the writer's computer.
Nothing in it talks to a server run by the author; there is none.
Manuscripts travel between the device and the writer's folder or Google
Drive. AI requests go from the device to OpenRouter or a local Ollama.
Searches go from the device to Wikipedia or OpenRouter.

The author distributes source code through GitHub, in tagged releases that
hold no program, and keeps only a static website that links to the
repository. Users build and run each installation, and own its Google Cloud
project. The privacy notice in the app
(`/privacy`) states the data flows for users.

| Piece | Tech | Job |
|---|---|---|
| `web/` | React 19, react-router 8, TypeScript (strict), Vite 8, i18next | The whole product: accounts, library, editor, assistant, import and export. `src/platform/` is the only code that knows whether the identity service is there |
| `identity/` | Go 1.26, standard library only | The identity service, needed for Google sign-in and Remote Storage: the `/identity/*` routes. It holds the Google Web client secret for the code exchange and refresh, binds the writer session and seals Drive refresh tokens and a remembered OpenRouter key into cookies. It serves nothing else |
| `desktop/` | Go 1.26: the standard library, `x/crypto`, `x/sys`, `fyne.io/systray`, `godbus/dbus` and `rsc.io/qr` | `once-dark-studio-desktop`, a convenience for the writer: it embeds the SPA, runs the `identity` binary shipped beside it as a supervised child, serves both on `http://localhost:47821`, serves the setup page and, on request, serves the home network over HTTPS |

The two servers are written in Go because Go cross-compiles to every target
system, and has TLS, ACME and HTTP in its standard library and `x/crypto`.

### How `once-dark-studio-desktop` runs

- **Package.** The `once-dark-studio-desktop` executable (`desktop/`, Go)
  with the built SPA embedded, beside the `identity` binary (`identity/`).
- **Start.** It serves the SPA on `http://localhost:47821`, runs the identity
  service on a loopback port and passes `/identity/` to it, then opens the
  default browser.
- **Google client type.** Web application (confidential). The desktop program
  saves the secret on this computer, and only the identity service uses it.
- **Refresh credential.** Sealed into an `HttpOnly` cookie in the browser
  that authorized it. Only the identity service can open it.
- **Other home devices.** An optional home-network listener on HTTPS, with a
  real host name.

The SPA reaches the identity service only through `web/src/platform/`. It
needs the service on its own origin. Without the service, or without a Google
client, the writer writes in Local Storage. The app then does not offer Google
sign-in, and Remote Storage stays unavailable. The demo editor calls none of
it and still runs. The SPA never asks where it is served from. In
development, Vite proxies `/identity` to the identity service that
`npm run dev:full` (or `npm run dev:identity`) starts on `127.0.0.1:47821`,
so every identity call stays same-origin.

Four files are the best entry points to the code:

- `web/src/editor/engine/index.ts`, the engine's only public entry;
- `web/src/storage/types.ts`, the storage port;
- `web/src/editor/views/view/port.ts`, the writing-view port;
- `web/src/platform/types.ts`, the platform port.

## Accounts, sessions and connections

These are separate things with separate lifetimes.

- A **writer account** is a record in this site's local storage: one per
  Google account that signed in to this browser, and at most one without
  Google. It holds a random 128-bit id and the verified Google identity
  (issuer and subject), matched on its subject. Every per-person store
  (preferences, library, folder handles, sync manifests, the write queue, the
  working copy, AI settings) is keyed by the account id. A second entry marks
  the account that is signed in.
- **Signing in** uses Google. *Log in with Google* on the landing page runs
  Google sign-in in a popup, and the button shows only while the identity
  service answers. *Continue without an account* opens the account without
  Google instead.
- **Every tab knows who is signed in from its first render**, because the
  signed-in mark is local. A sign-out in one tab signs out the others too. A
  sign-in as another account reloads them, so that no editor switches
  accounts while it is open.
- **Signing out** writes the open text, then either leaves everything for the
  account's next entry, or cleans the account's local data and its record
  from this browser. Both kinds of account may choose either, and other tabs
  follow the same choice. While unsent work remains, the question says how
  many files it is in.
- A **Google identity** belongs to one account: its subject never changes.
  Drive authorization is optional and separate. Local manuscripts do not need
  Drive permission.
- A **Drive connection** belongs to one account and must use the same Google
  account. The identity service checks the subject (`sub`) in the ID token
  returned with the Drive grant, and refuses another account before it stores
  anything. A lost or revoked grant pauses synchronization; it never signs the
  account out. The connection asks for `drive.file` and `drive.appdata`
  together: the settings copy and the manuscript storage do not have
  separate grants.
- An **AI connection** is the writer's OpenRouter key. It belongs to one
  account and is kept by the platform's vault. It is never part of the
  synchronized preferences.

Signing in with Google does not encrypt local storage. Anyone who uses the
same unlocked operating-system or browser account can read the files and use
any open Google session. Only separate operating-system accounts, with screen
locks, keep people's work apart. Signing out of the app does not sign out of
Google. Signing in needs a connection to Google; an account that is already
signed in can continue local work offline.

## Where the manuscript lives, and where it does not

The manuscript is the writer's file. It lives in a folder the writer chose or
in an app folder of their own Google Drive, and its bytes travel only between
the device and that place.

Apart from the files, what the app keeps about a project is the library card.
The `CardContent` type in `web/src/profile/profileStore.ts` is its
boundary. While Drive is connected, it is also what the account's Drive copy
of its profile holds about each book, so adding a field to it widens that copy
too:

- the project folder name (or Drive file id), the project title and the title
  of every Part and Section;
- the type label (free text if the writer chose "Other"), the word goal, word
  counts and the file name adopted for each node, which is a slug of its
  title;
- the opened, last-seen and last-edited timestamps, including a last-edit time
  for each Section.

It holds no body text, snapshots, summaries, comments or chats. Body-text
search runs in the tab and never leaves it.

**A remote model receives text through OpenRouter.** The assistant assembles
passages, the conversation and the writer's instructions in the browser, and
sends them from the device to OpenRouter on the writer's own key.
[ai.md](ai.md) says where they go from there and which routing the app asks
for. A local Ollama model sends nothing off the machine, except the query of
a web search that the writer approves.

Seven kinds of data are stored, and they behave differently:

| | Data | Where |
|---|---|---|
| a | Project folders (Markdown, YAML, JSON) | The writer's chosen folder, or an app folder in their Drive |
| b | Accounts and the signed-in mark | This site's local storage (the browser's storage for the app's address) |
| c | Preferences, library, card content | One `profile.<accountId>` entry per account in this site's local storage; while Drive is connected, merged with each installation's copy in the account's Drive `appDataFolder` |
| d | Folder handles, sync manifests, the write queue | Local IndexedDB. Handles cannot leave the machine; the queue holds writes bound for the writer's own Drive |
| e | Working copy of projects that have a remote | OPFS, disposable at any moment |
| f | Credentials: Drive refresh tokens, a remembered OpenRouter key | Sealed in `HttpOnly` cookies that only the identity service can open; a key that is not remembered stays in the tab's memory |
| g | The log, with no personal data ([internals.md](internals.md#the-apps-log)) | The app's: IndexedDB `writer-log` in this browser, and the lines not yet written in local storage while a tab closes. The desktop program's and the identity service's: files in the data folder's `logs` |

The working copy and the queue hold plain-text prose on the device. A sign-out
that cleans removes them with the rest of the account's local data, and first
says how many files the queue still holds; a sign-out that leaves everything
keeps them.

## Patterns

[internals.md](internals.md) gives the rules behind these patterns that the
code cannot state.

**Hexagonal (ports and adapters), enforced by tests.** A feature module keeps
its rules in a pure core, and its boundary tests fail on illegal imports. A
module gets `ports` and `adapters` where they isolate more than one real
adapter, a slow or volatile outside dependency, or a trust boundary, as in the
modules below.

- **Editor engine** (`web/src/editor/engine`) is DOM-free and imports nothing
  outside itself. It has ports for `Codec`, `HistoryStore`, `SearchProvider`,
  `Renderer`, `ClipboardCodec`, `Platform` and `EventBus`, and every port has a
  contract test suite that all its adapters must pass. `views/engine.ts` is the
  composition root that injects the production adapters, so swapping one is a
  one-line change. Edits are commands run through a command bus.
- **Writing views** are a port. The scroll and typewriter views share one core
  and differ only in a `Scroller` strategy.
- **The editor core** is the engine and the writing views
  (`web/src/editor/engine` and `web/src/editor/views`). It imports nothing
  outside itself: a view reaches the engine only through `engine/index.ts`,
  and what a view needs of the app (the keyboard, the HTML sink, the
  station's glyph) comes in through `ViewHost` in `views/view/port.ts`. Its
  boundary tests keep it ready to become a package of its own.
- **Storage** sits behind `StorageProvider`: local disk, Google Drive and an
  in-memory demo provider, with mirrored and OPFS-cache adapters on top. App
  code branches on a provider's `kind` (`device` or `remote`), never on its
  id. The storage and view registries are lookup-only: neither has an "all
  providers" or "all views" call, so every screen names the choices it
  offers.
- **The identity service** sits behind `Platform` (`web/src/platform/`):
  Google sign-in, the Drive grant and its tokens, the credential vault and the
  session binding. It has one implementation, the identity service's wire,
  and no other code fetches `/identity/`.
- **AI** (`web/src/ai`) has `domain`, `ports`, `adapters` and `application`,
  and `host` for the connections the app makes for it. Model providers, web
  search, project sources, comments and evidence are all ports. The
  `Assistant` in `application/assistant.ts` holds a project's chats and its
  one running request. Each workflow (the reviews, `/map`, `/where`,
  `/summarise`, `/verify`, the beta reader, the margin replies) is a module of
  functions over a host, and the `Assistant` gives each one as a feature
  object: `assistant.reviews.run(…)`, `assistant.chats.create(…)`.
- **Export and import** follow the same layering, with their writers and
  readers as adapters. **Comments** have a pure domain and an application
  layer, and no ports: they have one store, the project's own
  (`editor/comments/host/projectStore.ts`).
- **Shared text helpers** (`web/src/text`) are pure functions shared by modules
  whose boundaries forbid importing one another: regex escaping, the Windows
  device names and the content hash. They import nothing.

**Lazy seams.** `App.tsx` is the only file that knows that both the web app
and the editor exist. The editor, the export window and the import window are
dynamically imported chunks. Each export writer and import reader is its own
chunk, so `pdfmake` loads with the first PDF, and the zip code loads with the
first docx, odt or epub.

**A custom text engine over an immutable model.** A document is `Paragraph[]`.
A paragraph is `{ runs, alignment, blockType }`, and a run is text plus bold,
italic and monospace flags. Edits are pure functions with structural sharing.
The view layer owns the `contentEditable` surface: typing, deletion, IME
composition and undo arrive through `beforeinput`; the clipboard and shortcuts
have their own dispatchers; the native caret is hidden and drawn separately;
and the DOM is patched one paragraph at a time.

**History is a tree.** In memory, each state shares structure with the
previous one, so undo and redo are reference swaps and snapshots are cheap.
Deltas exist to serialize and replay the timeline. Editing after an undo
keeps the abandoned future on a side branch instead of deleting it. Each
snapshot file keeps its own timeline in `history/<file>.json`, capped at 2,000
steps or 5 MB.

**Local-first working copy.** A project paired with a device folder writes
`disk → OPFS working copy → IndexedDB queue → remote`. A Drive-only project
writes `working copy → queue → remote`. A device-only project writes directly
to disk, with no cache and no queue. The queue never silently discards a
failed operation: it stops at it, keeps it and says so. The save indicator
tells *saved* apart from *cached, not yet at the remote*, and signing out
shows how many files are still held only on this device.

**A profile per account.** Preferences and library membership live in the
account's profile on this device, with their clocks and the tombstones of
forgotten projects. Writes go to the local profile synchronously. While Drive
is connected, each installation writes only its own
`profile-<installation>.json` in the writer's Drive `appDataFolder` and
merges everyone else's per key: the newest `updatedAt` wins a preference, the
installation id breaks ties, and a removal wins a membership only when it is
strictly newer than the add. No installation overwrites another's file.
Copies read from Drive are validated against the preference domain
before use. The library row is the shelf's single source, and a removal is a
tombstone, so a reload never brings back a deleted project.

**The assistant runs in the browser.** Context assembly, retrieval, tools and
prompts all run in the tab, against the writer's own files, and requests go
from the device to OpenRouter or Ollama. The OpenRouter key is read from the
vault for each request, and its spend verdict is read from the vendor before a
request leaves. Whether a provider counts as `device` or `remote` comes from
where the bytes go, never from the provider's own claim.

**Prompts are files.** Personas, skills (slash commands), craft lenses, genre
packs and reference templates are Markdown files, loaded at build time and
validated at module load.

**Typed themes.** A theme must supply every contract token (listed in
`web/src/theme/domain/tokens.ts`), or it does not typecheck.

## The on-disk project format

```
<project>/
  document-properties.json    metadata, stats, snapshot hashes, UI state
  document-structure.yaml     the tree of Parts and Sections, and the bin
  snapshots-catalogue.json    which files are snapshots, live and binned
  document/                   flat folder of Markdown, one file per snapshot
  recyclebin/                 removed files
  reference/                  guidebook--*, character--*, arc--*, world--*, summary--*, notes--*
  comments/<nodeId>.json      margin threads, one file per node
  assistant/                  chat--*.json, plus a memory folder of summaries and review state
  history/<file>.json         the undo journals, one file per snapshot
  export/                     files produced by Export
  .<product>/conflicts/       backups of the losing side of a sync conflict (device folders only)
```

- Manuscript files have names such as `section--the_storm.EL3.01.md`. `EL3` is
  the node's stable id and `01` is the snapshot; the YAML names the adopted
  snapshot. Renaming a title renames the files and never breaks a reference.
- Files use a CommonMark dialect. Page breaks are `{pagebreak}`, and alignment
  is an `{align:center}` style directive. Typed text is escaped, so it can
  never turn into a directive.
- Every list of children, the root included, is all Parts or all Sections. The
  code calls this the Golden Rule. A Part also has text of its own.
- Opening is strict about the live tree and the three manifest files: invalid
  metadata, a missing catalogue or a structure that disagrees with the
  `document/` folder, makes the app refuse the project. The bin is read leniently, and a changed content
  hash only gives a warning, because writers edit in other tools. `reference/`
  and `assistant/` are free-form, with only file-name prefixes. Part 6 of
  [install.md](install.md#your-books-in-other-programs) tells writers what is
  safe to change outside the app and how to recover a refused project.

## Security posture

- **No state on the server side.** The identity service has no database.
  Every flow, writer session, Drive connection and kept credential is sealed
  with AES-256-GCM into an `HttpOnly` cookie of the browser it belongs to, so
  there is nothing to back up but the seal keys. Replacing the seal keys
  ("Disconnect Google Drive and OpenRouter everywhere") invalidates every such
  cookie. The cost is that no one can list or end one account's sessions:
  a session exists only on its device.
- **Sessions.** The session is local to the browser profile. The identity
  service binds every token operation to it with a session cookie and a proof
  that the SPA keeps in its own origin's storage. A browser sends localhost
  cookies to every port of the host, so the cookies alone open nothing. Every
  non-GET identity route requires a custom header and a same-origin fetch, so
  another site cannot call them. An OAuth flow records the session that
  started it, and a flow whose session ended or changed account cannot
  finish. The setup page is served only on the loopback listener.
  [identity-contract.md](identity-contract.md) gives every rule.
- **Drive.** The scopes are `openid`, `userinfo.email`, `userinfo.profile`,
  `drive.file` and `drive.appdata`: the files the app created or the writer
  opened with it, plus its own hidden settings folder. The refresh token is
  sealed into a cookie scoped to `/identity/google`. The SPA holds one-hour
  access tokens in memory. Connecting Drive requires the writer's bound Google
  identity. The household's Google client stays in Testing, because
  publishing it needs a home page, a privacy policy and an authorized domain
  that a household does not have. In Testing, Google ends Drive refresh
  tokens after seven days, so Drive asks to reconnect every week.
- **AI keys.** The OpenRouter key is the writer's own, approved with OAuth
  PKCE and accepted only with a spend limit of at most $5 set at OpenRouter.
  The limit, not an expiry, is what bounds a copied key. A remembered key is
  sealed by the identity service. [ai.md](ai.md#the-key) says what this
  protects and what it does not.
- **Browser.** The Content-Security-Policy is a `<meta>` tag in the built HTML.
  It allows connections only to the app's own origin, the Google Drive API,
  OpenRouter, Wikipedia in each language and loopback, and it loads Google
  avatar images. A `<meta>` policy cannot carry `frame-ancestors` or violation
  reporting. Rendered Markdown goes through a hardened renderer with no raw
  HTML, and search results and imported text are treated as data. The policy
  also requires Trusted Types: in a browser with the API, markup reaches the
  DOM only through one named policy, so every `innerHTML` and `DOMParser` sink
  in the app can be listed, and a string from anywhere else is refused.
- **Search.** Only the query the writer approved leaves the device
  ([ai.md](ai.md#web-search)).
- **Home network.** `once-dark-studio-desktop` serves other devices only over
  HTTPS, at a free `dedyn.io` name from deSEC, with a Let's Encrypt
  certificate obtained through a DNS-01 challenge on that name. Plain HTTP on a
  private address, public tunnels and relays are not offered. Answers on the
  home network carry `Strict-Transport-Security`.
  [home-network.md](home-network.md) explains why and gives the steps.
