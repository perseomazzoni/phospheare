// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { describe, expect, it } from "vitest";
import { SHORTCUTS, formatShortcut } from "../../../editor/views/shortcuts";
import { KEYS, keyLabel, type KeyId } from "./keys";

// The landing page's copy of the editor's keys stays the editor's.

describe("the landing's keys", () => {
  it.each(Object.keys(KEYS) as KeyId[])(
    "%s is the editor's keystroke",
    (id) => {
      const editor = SHORTCUTS[id];
      expect(editor.modifiers).toEqual([KEYS[id].modifier]);
      expect(editor.key).toBe(KEYS[id].key);
      expect(editor.action).toBe(KEYS[id].char);
      expect(keyLabel(id)).toBe(formatShortcut(id));
    },
  );
});
