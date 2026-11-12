// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { Device } from "./application/choice";

// The choice this browser last wore for a signed-in writer, in local storage.
// The writer's own choice lives in their synced preferences, which are read
// per writer, and the writer is not known until a session is adopted; without
// this the first paint is the app's default and the writer's theme arrives
// later, behind a fade.

// Neutral, like everything the browser keeps.
const KEY = "theme";

export const browserDevice: Device = {
  lastChoice() {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
  keepChoice(choice) {
    try {
      if (choice) localStorage.setItem(KEY, choice);
      else localStorage.removeItem(KEY);
    } catch {
      // Storage refused (a private window, a full quota): the next first
      // paint is the default, and the account corrects it.
    }
  },
};
