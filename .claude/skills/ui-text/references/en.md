# English interface text

## Voice

- Address the writer as "you". Speak about the writer's work, not about the
  app.
- Use sentence case for buttons, titles and labels. Product terms keep their
  capitals: Part, Section, Remote Storage, Local Storage, the Desk.
- Labels and buttons have no full stop. A message that is a sentence ends with
  one.
- Put curly quotes “ ” around a name that the writer gave, such as
  `Rename “{{title}}”`.
- Use the ellipsis character …, not three full stops.
- New text uses British spelling with the Oxford "-ize", as in the docs.

## Product voice

- Never describe the assistant as a reader of the book.
- Do not sell "the assistant does not write in your book" as a feature.
- Lumi is a beta reader. Say so plainly.
- Never call the product a "complete studio".
- Claim only what the code does. Summaries and checks run when the writer asks.
- On the public pages, "Free and open source" stays beside every button that
  starts the app.

## Fixed words

| Thing | Word | Example key |
| --- | --- | --- |
| The object a writer works on | project ("book" only in landing prose) | `library.newProject` |
| Parts of a project | Part, Section (capital; lowercase in counts) | `tree.addPart`, `tree.addSection` |
| A section of a reference sheet | section (lowercase, another thing) | `reference.addSection` |
| The list of projects | library | `library.title` |
| Groups of reference sheets | shelf | `dock.pickReference` |
| Storage | Remote Storage, Local Storage; the vendor only as `{{storage}}` | `library.connectDrive` |
| A saved copy of a node | snapshot; adopt | `snapshots.add`, `snapshots.adopt` |
| Notes in the margin | comment; a persona's is a suggested comment | `comments.add`, `comments.ghostLabel` |
| Comment actions | Reply, Resolve, Keep, Dismiss | `comments.resolve` |
| The AI | assistant; the button is Enlighten! | `toolbar.assistant` |
| Personas | persona; their names come from the persona files | `dock.choosePersona` |
| Account entry | sign in, sign out ("Log in" only on the landing) | `library.signOut` |
| Window of options | Settings; writing options are preferences | `settings.title`, `tree.writingPreferences` |
| Destroy | Delete (goes to the bin of the storage) | `library.deleteFolder` |
| Take off the list | Remove (deletes nothing) | `library.remove` |
| Parts and Sections | Move to the bin | `tree.remove` |
| A local folder link | Forget | `library.forgetLocalFolder` |
| Storage and AI links | Connect, Disconnect | `library.connect` |
| Save states | Saved, Saving, Unsaved, Save failed, Autosave | `toolbar.saved` |
| Sync states | Sync, Synced, Sync pending | `library.synced` |
| Look | Theme; Light or dark | `settings.theme` |
| Places | the Desk, the dock (lowercase in strings), Henosis mode | `titlebar.toDesk`, `dock.close`, `henosis.full` |
| Look for text | Search (text, web), Find (in a project), Filter (lists) | `toolbar.search`, `tree.findLabel`, `library.findLabel` |
| AI access | key, connection | `settings.aiRemoteReconnect` |

## Interpolation

- Double braces only: `{{name}}`. The defaults are `{{product}}`,
  `{{storage}}`, `{{searchProvider}}` and `{{localProvider}}`
  (`web/src/locales/i18nOptions.ts`).
- Plurals use `_one` and `_other` with `{{count}}`. A `_one` form writes
  `{{count}}`, never the literal digit 1. No base key sits beside its plural forms.
- A context `_plain` serves a writer account without a name, as in
  `library.greetingWelcome_plain`.

## Known inconsistencies

Do not copy these into new text. Report them if you work near them.

- "Log in" on the landing page, "sign in" in the app.
- Spelling is mixed: American "Align center" and "license" (the noun), and
  "summarise" with "-ise".
- Straight and curly apostrophes are mixed.
- "Library" and "Snapshot" are capitalized in a few sentences.
