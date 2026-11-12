// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The editor: a writing surface, the document tree beside it, and the chrome
// over both. Everything under this directory belongs to it. Outside `App.tsx`,
// code reaches it through this file or the lazy loaders in `editorChunk.ts`;
// the web app may also import the two leaf modules `webapp/boundaries.test.ts`
// allows.
//
// What it shares with the rest of the application:
//
//   project/  the project model: what a Part is, what makes a structure
//             valid. The editor changes documents; the webapp finds and
//             creates them. Neither owns the format.
//   storage/  where a project lives. The editor asks for bytes by path and
//             does not know whether they come from a disk or from Remote
//             Storage.
//   theme/    the tokens it draws with. ui/ the controls it shares.
//   services/ what the mounting route lends it: the face, the models, the
//             sync queue (`services/port.ts`). The editor imports no
//             account or sync module; `ProjectRoute.tsx` and
//             `services/account.ts` are the full program's, behind their
//             own lazy loader.
//
// Importing this module pulls the engine, every component and the stylesheet,
// so `App.tsx` reaches it only through a dynamic import. That keeps the editor
// out of the bundle a visitor downloads to read the homepage.
//
// Do not re-export `projectPath` here. The workspace builds editor links
// without loading the editor, and a re-export would undo the split. It lives
// in `./path`, which imports nothing.
import "./frame.css";

export { EditorScreen } from "./EditorRoute";
export { EditorServicesProvider } from "./services/context";
