// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// ── The keys the landing page shows ──────────────────────────────────────────
//
// The typographic keystrokes and accented capitals of the editor's table
// (`editor/views/shortcuts.ts`), copied because the web application may not
// import the editor (`webapp/boundaries.test.ts`). `keys.test.ts` holds each
// entry equal to the editor's, so the page cannot promise a key the editor
// does not have.

export interface Key {
  modifier: "mod" | "alt";
  key: string;
  /** What the keystroke writes. */
  char: string;
}

const mod = (key: string, char: string): Key => ({
  modifier: "mod",
  key,
  char,
});

export const KEYS = {
  apostrophe: mod("'", "’"),
  emDash: mod("-", "—"),
  enDash: { modifier: "alt", key: "-", char: "–" },
  ellipsis: mod(".", "…"),
  leftGuillemet: mod("1", "«"),
  rightGuillemet: mod("2", "»"),
  openDoubleQuote: mod("3", "“"),
  closeDoubleQuote: mod("4", "”"),
  À: mod("à", "À"),
  È: mod("è", "È"),
  É: mod("é", "É"),
  Ì: mod("ì", "Ì"),
  Ò: mod("ò", "Ò"),
  Ù: mod("ù", "Ù"),
  Â: mod("â", "Â"),
  Ê: mod("ê", "Ê"),
  Î: mod("î", "Î"),
  Ô: mod("ô", "Ô"),
  Û: mod("û", "Û"),
  Ë: mod("ë", "Ë"),
  Ï: mod("ï", "Ï"),
  Ü: mod("ü", "Ü"),
} satisfies Record<string, Key>;

export type KeyId = keyof typeof KEYS;

export const isKeyId = (id: string): id is KeyId => id in KEYS;

/** The accented capitals, in the editor's order. */
export const CAPITALS = Object.values(KEYS)
  .map((key) => key.char)
  .filter((char) => /^\p{Lu}$/u.test(char));

/** Whether the key labels are a Mac's: `⌘` and `⌥`, with no "+". */
export const isMac = () =>
  typeof navigator !== "undefined" &&
  /Mac|iPod|iPhone|iPad/.test(navigator.userAgent);

/** A key as the editor labels it: `Ctrl+è` elsewhere, `⌘è` on a Mac. */
export function keyLabel(id: KeyId): string {
  const { modifier, key } = KEYS[id];
  const mac = isMac();
  const held = modifier === "mod" ? (mac ? "⌘" : "Ctrl") : mac ? "⌥" : "Alt";
  return mac ? `${held}${key}` : `${held}+${key}`;
}
