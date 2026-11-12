// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import {
  DEFAULT_AUTOSAVE_DELAY_S,
  DEFAULT_HENOSIS_AFTER_S,
  DEFAULT_HENOSIS_FADE_S,
  DEFAULT_HENOSIS_PAUSE_S,
  DEFAULT_PROSE_SIZE,
  type DocumentProperties,
  type FocusMode,
  type ProseSize,
} from "../project/types";
import { preferences } from "../preferences/compose";

// Writing preferences: how a project is written. Three layers decide the
// effective value:
//
//   1. The project's own `ui` block in `document-properties.json`. A non-null
//      value is an override; the settings panel on the tree writes here.
//   2. The user's global Editor Settings, kept in the app's preferences
//      (`preferences/compose.ts`): the default every project inherits.
//   3. The built-in default, `BUILT_IN_PREFS`.
//
// The project file is the only place a project stores a value. `null` means
// inherit, and a project stores only real overrides (`overrideOf`).

/** What the stored, possibly null, prefs resolve to. */
export interface ResolvedPrefs {
  proseSize: ProseSize;
  typewriter: boolean;
  focus: FocusMode;
  smoothCaret: boolean;
  autosave: boolean;
  autosaveDelay: number;
  henosis: boolean;
  henosisAfter: number;
  henosisFade: number;
  henosisPause: number;
}

/** The user's global Editor Settings, as a partial resolved set. */
export type GlobalEditorSettings = Partial<ResolvedPrefs>;

/**
 * The global Editor Settings from the prefs store. Every key reads with a
 * null fallback, so an unset global is `undefined`, absent rather than a
 * value, and resolution falls through to the built-in default.
 */
export function loadGlobalEditorSettings(): GlobalEditorSettings {
  return {
    proseSize:
      preferences.getPref<ProseSize | null>("proseSize", null) ?? undefined,
    typewriter:
      preferences.getPref<boolean | null>("typewriter", null) ?? undefined,
    focus: preferences.getPref<FocusMode | null>("focus", null) ?? undefined,
    smoothCaret:
      preferences.getPref<boolean | null>("smoothCaret", null) ?? undefined,
    autosave:
      preferences.getPref<boolean | null>("autosave", null) ?? undefined,
    autosaveDelay:
      preferences.getPref<number | null>("autosaveDelay", null) ?? undefined,
    henosis: preferences.getPref<boolean | null>("henosis", null) ?? undefined,
    henosisAfter:
      preferences.getPref<number | null>("henosisAfter", null) ?? undefined,
    henosisFade:
      preferences.getPref<number | null>("henosisFade", null) ?? undefined,
    henosisPause:
      preferences.getPref<number | null>("henosisPause", null) ?? undefined,
  };
}

/** The built-in defaults: what a setting resolves to when neither the project
 *  nor the writer's globals set it. Shared by `settingsOf`'s fallbacks and
 *  `overrideOf`'s normalization target. */
export const BUILT_IN_PREFS: ResolvedPrefs = {
  proseSize: DEFAULT_PROSE_SIZE,
  typewriter: false,
  focus: "off",
  smoothCaret: false,
  autosave: true,
  autosaveDelay: DEFAULT_AUTOSAVE_DELAY_S,
  henosis: false,
  henosisAfter: DEFAULT_HENOSIS_AFTER_S,
  henosisFade: DEFAULT_HENOSIS_FADE_S,
  henosisPause: DEFAULT_HENOSIS_PAUSE_S,
};

/**
 * The three preferences the phone plane does not honour, whatever the project
 * or the writer's globals say.
 *
 * Typewriter centring, with a soft keyboard up, re-docks a band of a few
 * lines on every keystroke; the scroll view's keep-in-band
 * (`views/scrollStrategy.ts`) serves the same intent. Focus dimming on a
 * six-line screen costs the sentence before, the scarcest thing there.
 * Henosis has nothing to take away: on a phone the chrome is already a strip
 * at the foot, and the soft keyboard fills the rest.
 *
 * Ignored, never rewritten: the stored value is in force at the writer's
 * desk, and one project file is synced across both. The panel keeps showing
 * what they chose and says why it is not in effect here.
 */
export function forPlane(prefs: ResolvedPrefs, phone: boolean): ResolvedPrefs {
  return phone
    ? { ...prefs, typewriter: false, focus: "off", henosis: false }
    : prefs;
}

/** The preferences that answer "not here" on a phone, named once. */
export const DESKTOP_ONLY_PREFS = ["typewriter", "focus", "henosis"] as const;

/**
 * What to store for a project setting whose new value the writer just picked:
 * the value itself when it diverges from the resolved default, `null`
 * (inherit) when it matches. A setting that equals the default is not a
 * project fact, and storing it would freeze the project against a later
 * change of that default.
 *
 * The resolved default is the global when one is set, the built-in otherwise:
 * an unset global is not "no default". With nothing configured, toggling
 * back to the built-in returns to the default rather than arming a "for this
 * project only" toast for a divergence that does not exist.
 */
export function overrideOf<T>(
  value: T,
  global: T | undefined,
  builtIn: T,
): T | null {
  return value === (global ?? builtIn) ? null : value;
}

/**
 * Resolve a project's stored preferences against the user's global Editor
 * Settings and then the built-in defaults.
 *
 * A project with no `ui` resolves to the writer's globals, or the built-in
 * default where they set none. The settings panel configures only the project
 * on screen, so a setting meant for one project never leaks into another, but
 * a project with no value of its own inherits the writer's.
 */
export function settingsOf(
  props: DocumentProperties | null,
  globals: GlobalEditorSettings = {},
): ResolvedPrefs {
  const ui = props?.ui;
  return {
    proseSize: ui?.proseSize ?? globals.proseSize ?? BUILT_IN_PREFS.proseSize,
    typewriter:
      ui?.typewriter ?? globals.typewriter ?? BUILT_IN_PREFS.typewriter,
    focus: ui?.focus ?? globals.focus ?? BUILT_IN_PREFS.focus,
    smoothCaret:
      ui?.smoothCaret ?? globals.smoothCaret ?? BUILT_IN_PREFS.smoothCaret,
    autosave: ui?.autosave ?? globals.autosave ?? BUILT_IN_PREFS.autosave,
    autosaveDelay:
      ui?.autosaveDelay ??
      globals.autosaveDelay ??
      BUILT_IN_PREFS.autosaveDelay,
    henosis: ui?.henosis ?? globals.henosis ?? BUILT_IN_PREFS.henosis,
    henosisAfter:
      ui?.henosisAfter ?? globals.henosisAfter ?? BUILT_IN_PREFS.henosisAfter,
    henosisFade:
      ui?.henosisFade ?? globals.henosisFade ?? BUILT_IN_PREFS.henosisFade,
    henosisPause:
      ui?.henosisPause ?? globals.henosisPause ?? BUILT_IN_PREFS.henosisPause,
  };
}
