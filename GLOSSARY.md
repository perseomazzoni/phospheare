# Glossary

The vocabulary of accounts, sessions, connections and storage. These terms
keep the person who uses Phospheare apart from the services that identify them
or hold their work.

## Terms

**Writer account**:
The local Phospheare record of one Google account in one browser, or of the
browser's one account without Google. Preferences, the library, connections
and pending work belong to it. No server holds it
([docs/architecture.md](docs/architecture.md)). Remote Storage needs a Google
account and remains optional.
_Avoid_: "account" without qualification; "Google account" as a synonym

**Writer session**:
The period from signing in to a writer account in a browser until signing out
there.
_Avoid_: "Google session" or "Drive connection" as a synonym

**Sign-in identity**:
An identity vouched for by an external provider, such as Google, that
identifies the writer who enters Phospheare.
_Avoid_: "storage account" or "email address" as a synonym

**Storage connection**:
Authorized access to a particular storage account and to the resources that
its owner has allowed Phospheare to use.
_Avoid_: "Phospheare login" or "Google sign-in" as a synonym

**Settings synchronization**:
The exchange of a writer's portable preferences and library between
installations through Remote Storage, while it is connected.
_Avoid_: "sign-in" or "manuscript synchronization" as a synonym

**Manuscript storage**:
The chosen location that holds a project's writing and its project data:
Local Storage, Remote Storage or both.
_Avoid_: "identity provider" or "settings destination" as a synonym

**AI connection**:
Authorized use of an AI service under a particular account and spending
policy.
_Avoid_: "storage connection" or "writer session" as a synonym

**Private installation**:
Phospheare run on one computer by `once-dark-studio-desktop`, for one writer
or one household, with their own Google Cloud project.
_Avoid_: "static Phospheare"

## Words in the code

The code names some of its things with a word of its own. Each is defined
once, at the module that owns the thing; this list gives the plain meaning.

**Room**:
A kind of chat (General, Drafting, a reader, a reviewer), with its own job
and its own personas (`web/src/ai/domain/chat.ts`). In the AI budgets, the
word also means the characters left in a model's context window.

**Horizon**:
A reader chat's limit: the last Section it may read.

**Ledger**:
The facts read from one Section or one reference sheet, kept under that
Section's revision for the fact check (`web/src/ai/domain/ledger.ts`).

**Ghost comment**:
A comment a persona left in the margin that the writer has not kept yet: a
thread in the `proposed` state (`web/src/editor/comments/domain/model.ts`).

**Lane**:
A first-in, first-out queue of writes to one file. Writes in a lane land one
after another (`web/src/editor/project/application/metadataLanes.ts`).

**Latch**:
A flag that, once set, stays set until an explicit reset: the cache's purge
latch, a connection's latch, a provider latched off for the rest of a run.

**Funnel**:
The one path a structural change takes to land in the open project: files
first, metadata second, and the undo that takes both back
(`web/src/editor/project/application/commitFunnel.ts`).

**Station**:
In the typewriter view, the fixed line where the caret stays while the page
moves under it (`web/src/editor/views/writing/station.ts`).

**Glide**:
An animated scroll of the page to a new position, one in flight at a time
(`web/src/editor/views/writing/scrollGlide.ts`).

**Wash**:
A faint tint of a colour, drawn as a ground behind text or a mark. The word
is in the token names (`--wash`, `--wash-subtle`, `--mark-diff-wash-add`);
comments say "tint".

**Spine**:
The drawing of a project's shape: one group per Part, one bar per Section
(`web/src/ui/spineLayout.ts`).

**Face**:
One of the Dock's panels: the assistant, the reference, the notes, the
snapshots. In the diff, a block's kind and formatting.

**Beat, fit**:
Story-craft terms the `/map` command uses. A beat is one stage of a
story structure, such as the setup of a three-act arc. The fit is which
structure a stretch of the book follows, and why
(`web/src/ai/domain/structureShapes.ts`).

**Widening**:
Letting a run read the Sections it skipped, by summarising them first. The
widening block offers it (`web/src/editor/components/Widen.tsx`).

**Port, seam**:
A port is an interface the application calls and an adapter implements. A
seam is the one place where two representations of a thing are converted.

**The Desk, the Dock, Henosis, Enlighten!**:
Product names. The Desk is a book's front page: the last lines written, one
button to carry on, the shape of every Part. The Dock is the editor's side
panel. Henosis is the mode in which the controls fade while the writer writes.
Enlighten! is the assistant.
