// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { browserPlatform } from "../engine";

type Modifier = "mod" | "ctrl" | "shift" | "alt";

/** Which section of the shortcut sheet a binding belongs under. */
export type ShortcutGroup =
  "format" | "block" | "align" | "edit" | "file" | "chars";

export interface ShortcutDef {
  modifiers: Modifier[];
  key: string;
  label: string;
  action?: string;
  /** Where the sheet files it. Absent means the typographic inserts. */
  group?: ShortcutGroup;
}

export const SHORTCUTS: Record<string, ShortcutDef> = {
  bold: { modifiers: ["mod"], key: "b", label: "Bold", group: "format" },
  italic: { modifiers: ["mod"], key: "i", label: "Italic", group: "format" },
  monospaceInline: {
    modifiers: ["mod"],
    key: "e",
    label: "Monospace",
    group: "format",
  },
  undo: { modifiers: ["mod"], key: "z", label: "Undo", group: "edit" },
  redo: { modifiers: ["mod", "shift"], key: "z", label: "Redo", group: "edit" },
  // `mod+shift+h` and `mod+shift+d` are free on every layout Phospheare ships
  // for.
  rail: {
    modifiers: ["mod", "shift"],
    key: "h",
    label: "Revision rail",
    group: "edit",
  },
  snapshot: {
    modifiers: ["mod", "shift"],
    key: "d",
    label: "Snapshot",
    group: "edit",
  },

  // Cut, copy and paste are handled as the browser's own events; these
  // entries exist so the shortcut sheet can teach them.
  cut: { modifiers: ["mod"], key: "x", label: "Cut", group: "edit" },
  copy: { modifiers: ["mod"], key: "c", label: "Copy", group: "edit" },
  paste: { modifiers: ["mod"], key: "v", label: "Paste", group: "edit" },
  pastePlain: {
    modifiers: ["mod", "shift"],
    key: "v",
    label: "Paste without formatting",
    group: "edit",
  },
  selectAll: {
    modifiers: ["mod"],
    key: "a",
    label: "Select all",
    group: "edit",
  },

  setNormalText: {
    modifiers: ["mod"],
    key: "0",
    label: "Normal text",
    group: "format",
  },
  pageBreak: {
    modifiers: ["mod"],
    key: "Enter",
    label: "Page break",
    group: "block",
  },

  save: { modifiers: ["mod"], key: "s", label: "Save", group: "file" },
  find: { modifiers: ["mod"], key: "f", label: "Find", group: "file" },
  toggleCase: {
    modifiers: ["shift"],
    key: "f3",
    label: "Change case",
    group: "format",
  },

  // ── Block styles and alignment ─────────────────────────────────────────────
  //
  // These controls sit behind a hover in the bar, so each has a binding.
  // `mod+alt` because `mod+1..4` belong to the guillemets and the double
  // quotes, and an existing binding never moves to make room.
  setTitle: {
    modifiers: ["mod", "alt"],
    key: "1",
    label: "Title",
    group: "block",
  },
  setSubtitle: {
    modifiers: ["mod", "alt"],
    key: "2",
    label: "Subtitle",
    group: "block",
  },
  setBody: {
    modifiers: ["mod", "alt"],
    key: "3",
    label: "Body",
    group: "block",
  },

  // `c` for centre rather than `e`: on Windows AltGr is Ctrl+Alt, and AltGr+E
  // is the euro sign on the Italian layout.
  alignLeft: {
    modifiers: ["mod", "alt"],
    key: "l",
    label: "Align left",
    group: "align",
  },
  alignCenter: {
    modifiers: ["mod", "alt"],
    key: "c",
    label: "Align centre",
    group: "align",
  },
  alignRight: {
    modifiers: ["mod", "alt"],
    key: "r",
    label: "Align right",
    group: "align",
  },
  alignJustify: {
    modifiers: ["mod", "alt"],
    key: "j",
    label: "Justify",
    group: "align",
  },

  apostrophe: {
    modifiers: ["mod"],
    key: "'",
    label: "Apostrophe",
    action: "’",
  },
  emDash: { modifiers: ["mod"], key: "-", label: "Em dash", action: "—" },
  ellipsis: { modifiers: ["mod"], key: ".", label: "Ellipsis", action: "…" },
  leftGuillemet: {
    modifiers: ["mod"],
    key: "1",
    label: "Left guillemet «",
    action: "«",
  },
  rightGuillemet: {
    modifiers: ["mod"],
    key: "2",
    label: "Right guillemet »",
    action: "»",
  },
  openDoubleQuote: {
    modifiers: ["mod"],
    key: "3",
    label: "Open double quote",
    action: "“",
  },
  closeDoubleQuote: {
    modifiers: ["mod"],
    key: "4",
    label: "Close double quote",
    action: "”",
  },
  enDash: { modifiers: ["alt"], key: "-", label: "En dash", action: "–" },

  À: { modifiers: ["mod"], key: "à", label: "À", action: "À" },
  È: { modifiers: ["mod"], key: "è", label: "È", action: "È" },
  É: { modifiers: ["mod"], key: "é", label: "É", action: "É" },
  Ì: { modifiers: ["mod"], key: "ì", label: "Ì", action: "Ì" },
  Ò: { modifiers: ["mod"], key: "ò", label: "Ò", action: "Ò" },
  Ù: { modifiers: ["mod"], key: "ù", label: "Ù", action: "Ù" },
  Â: { modifiers: ["mod"], key: "â", label: "Â", action: "Â" },
  Ê: { modifiers: ["mod"], key: "ê", label: "Ê", action: "Ê" },
  Î: { modifiers: ["mod"], key: "î", label: "Î", action: "Î" },
  Ô: { modifiers: ["mod"], key: "ô", label: "Ô", action: "Ô" },
  Û: { modifiers: ["mod"], key: "û", label: "Û", action: "Û" },
  Ë: { modifiers: ["mod"], key: "ë", label: "Ë", action: "Ë" },
  Ï: { modifiers: ["mod"], key: "ï", label: "Ï", action: "Ï" },
  Ü: { modifiers: ["mod"], key: "ü", label: "Ü", action: "Ü" },
};

export type ShortcutId = keyof typeof SHORTCUTS;

export function formatShortcut(id: ShortcutId): string {
  const def = SHORTCUTS[id];
  const parts: string[] = [];

  for (const mod of def.modifiers) {
    switch (mod) {
      case "mod":
        parts.push(browserPlatform.modLabel());
        break;
      case "ctrl":
        parts.push(browserPlatform.ctrlLabel());
        break;
      case "shift":
        parts.push(browserPlatform.shiftLabel());
        break;
      case "alt":
        parts.push(browserPlatform.altLabel());
        break;
    }
  }

  const displayKey =
    def.key.length === 1 && def.key >= "a" && def.key <= "z"
      ? def.key.toUpperCase()
      : def.key;
  parts.push(displayKey);
  return parts.join(browserPlatform.isMac() ? "" : "+");
}

/**
 * Whether an event is this shortcut. The match is exact in both directions:
 * every listed modifier must be held and every other must not, or `Mod+Alt+1`
 * would also fire `Mod+1`, and `AltGr+-` on a European layout would type an
 * en dash instead of the layout's own character.
 */
export function matchesShortcut(id: ShortcutId, e: KeyboardEvent): boolean {
  const def = SHORTCUTS[id];

  const wantMod = def.modifiers.includes("mod");
  const wantCtrl = def.modifiers.includes("ctrl");
  const wantShift = def.modifiers.includes("shift");
  const wantAlt = def.modifiers.includes("alt");

  const isMac = browserPlatform.isMac();
  const modActive = isMac ? e.metaKey : e.ctrlKey;
  // On a non-mac, `mod` and `ctrl` are the same physical key, so a shortcut
  // asking for `mod` is already asking for ctrl and must not also refuse it.
  const ctrlIsMod = wantMod && !isMac;

  if (wantMod !== modActive) return false;
  if (!ctrlIsMod && wantCtrl !== e.ctrlKey) return false;
  if (wantShift !== e.shiftKey) return false;
  if (wantAlt !== e.altKey) return false;

  // The other platform's modifier is never part of a binding here, so holding
  // it means the writer asked for something else entirely.
  if (isMac ? e.ctrlKey && !wantCtrl : e.metaKey) return false;

  // Case-insensitive on both sides: the table stores "Enter", so folding only
  // the event's side would leave the Ctrl+Enter binding unreachable.
  return e.key.toLowerCase() === def.key.toLowerCase();
}
