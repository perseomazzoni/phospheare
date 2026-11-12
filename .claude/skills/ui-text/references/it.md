# Italian interface text

## Voice

- Address the writer with "tu", never "Lei".
- Write Italian that a native editor would write. Do not keep the English word
  order or the English length. A shorter Italian sentence is often better.
- Use sentence case. Product terms keep their capitals: Parte, Sezione,
  Scrivania.
- Buttons use the imperative: "Salva", "Elimina la cartella".
- A confirmation title is a question in the infinitive: "Eliminare la cartella
  di questo progetto?", "Uscire?".
- A progress or status label is a noun: "Salvataggio", "Lettura del
  progetto…".
- The assistant speaks in the first person, masculine: "Non sono riuscito…".
- Put curly quotes “ ” around a name that the writer gave. Keep « » for the
  quoted lines of a persona and for legal text.
- Keep the English loanwords that the app already uses: account, chat, editor,
  offline, AI, browser, demo, token, link. Do not add new loanwords when a
  common Italian word exists.

## Product voice

- Never describe the assistant as a reader of the book.
- Do not sell "l'assistente non scrive nel libro" as a feature.
- Lumi is a beta reader, "lettrice beta" (feminine). Say so plainly.
- Never call the product "studio completo".
- Claim only what the code does.
- On the public pages, "Libero e open source" stays beside every button that
  starts the app.

## Fixed words

| Thing | Word | Example key |
| --- | --- | --- |
| Project | progetto | `library.newProject` |
| Parts of a project | Parte, Sezione (capital; lowercase in counts) | `tree.addPart` |
| The list of projects | libreria | `library.title` |
| Groups of reference sheets | scaffale | `dock.pickReference` |
| Remote Storage | spazio di archiviazione remoto; short: spazio remoto | `library.connectDrive`, `library.syncToDrive` |
| Local Storage | spazio locale, in locale, sul tuo dispositivo | `library.setup.localName` |
| Snapshot | istantanea; adottare | `snapshots.add`, `snapshots.adopt` |
| Comment | commento; the verb is commentare | `comments.add` |
| Comment actions | Rispondi, Risolvi, Tieni, Scarta | `comments.dismiss` |
| The AI | assistente; the button is Illumina! | `toolbar.assistant` |
| Persona roles | Direttore editoriale, Revisione dello stile, Struttura e personaggi, Lettrice beta | `landing.team.lumi.role` |
| Account entry | Accedi, accesso; Esci, uscita | `library.signOut` |
| Window of options | Impostazioni; writing options are preferenze | `settings.title` |
| Destroy | Elimina | `library.deleteFolder` |
| Take off the list | Rimuovi | `library.remove` |
| Bin | cestino; Sposta nel cestino; cestino di `{{storage}}` | `tree.remove`, `library.deleted` |
| Storage and AI links | Collega, Scollega | `library.connect` |
| Save states | Salvato, Salvataggio, Non salvato, Salvataggio non riuscito, Salvataggio automatico | `toolbar.saving` |
| Sync states | Sincronizza, Sincronizzato, In attesa di sincronizzazione | `library.syncPending` |
| Look | Tema; Chiaro o scuro | `settings.theme` |
| Places | la Scrivania, il pannello (the dock), Modalità Henosis | `titlebar.toDesk`, `dock.close` |
| Chat kinds | Stesura, Lettore alpha, Lettore beta, Revisione editoriale | `dock.chatKind.beta-reader` |
| Look for text | Cerca, Filtra | `toolbar.search`, `library.findLabel` |
| AI access | chiave; connessione (test), collegamento (approval) | `settings.aiRemoteReconnect` |

## Known inconsistencies

Do not copy these into new text. Report them if you work near them.

- "Scollega" means both "Forget" (a local folder) and "Disconnect".
- Straight and curly apostrophes are mixed. Match the neighbouring keys.
- One string uses straight quotes (`library.alreadyInLibrary`).
- "Libreria" and "Istantanea" are capitalized in a few places.
