// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The web application: everything around the writing. The page that greets a
// visitor who has not signed in, the Library that shelves their projects, and
// the settings sheet that opens over it. None of it knows how a document is
// edited.
import "./frame.css";

export { default as Landing } from "./entry/landing/Landing";
export { useAccountEntry } from "./entry/landing/accountEntry";
export { default as ConnectPopup } from "./ai/ConnectPopup";
export { default as Library } from "./library/Library";
export { default as SettingsSheet } from "./shell/SettingsSheet";
export { default as SessionGate } from "./shell/SessionGate";
