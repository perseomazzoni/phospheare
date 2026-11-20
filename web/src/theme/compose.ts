// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { createChoices } from "./application/choice";
import { documentPage } from "./page";
import { browserDevice } from "./device";
import { preferences } from "../preferences/compose";

// The theme's composition root: the application's choices over the document,
// the app's account and this browser's storage. The provider reads these;
// nothing else wires an adapter.

export const page = documentPage;
// What a theme writes on a page, for a build that writes it into HTML.
export { themeMarkup, type ThemeMarkup } from "./page";
export const account = preferences;
export const choices = createChoices({
  page: documentPage,
  account: preferences,
  device: browserDevice,
});
