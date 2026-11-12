// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Files in the order a person would put them: "Chapter 2.md" before
// "Chapter 10.md". The operating system's picker hands files over in whatever
// order it likes, and a plain string sort puts chapter ten second, the
// multi-file complaint writers make most. Digits compare as
// numbers, letters by the locale's collation ignoring case and accents.

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

export function naturalCompare(a: string, b: string): number {
  return collator.compare(a, b);
}

/** A copy of `items`, sorted by `name` naturally. Stable for equal names. */
export function naturalSort<T>(
  items: readonly T[],
  name: (item: T) => string,
): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) => naturalCompare(name(a.item), name(b.item)) || a.index - b.index,
    )
    .map(({ item }) => item);
}
