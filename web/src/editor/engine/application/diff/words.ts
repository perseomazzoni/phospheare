// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The token-level diff: two token lists in, a script of keep, delete and
// insert ops out, by an LCS walk. A paragraph is the unit of work, so the
// O(n·m) table stays small; the callers cap its size.

export type TokenOp =
  /** The token exists in both, indexed in the right side. */
  | { kind: "keep"; target: number }
  /** The token exists only in the left side: spliced in and struck. */
  | { kind: "delete"; base: number }
  /** The token exists only in the right side: marked. */
  | { kind: "insert"; target: number };

/**
 * The LCS lengths table, row-major over base (n+1) by target (m+1), filled
 * from the end so each cell holds the LCS of the two suffixes.
 */
export function lcsTable(
  base: readonly string[],
  target: readonly string[],
): Int32Array {
  const n = base.length;
  const m = target.length;
  const table = new Int32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const at = i * (m + 1) + j;
      table[at] =
        base[i] === target[j]
          ? table[(i + 1) * (m + 1) + (j + 1)] + 1
          : Math.max(
              table[(i + 1) * (m + 1) + j],
              table[i * (m + 1) + (j + 1)],
            );
    }
  }
  return table;
}

/**
 * The LCS-based script from the left side's tokens (`base`) to the right
 * side's (`target`), in target order.
 */
export function diffTokens(base: string[], target: string[]): TokenOp[] {
  const n = base.length;
  const m = target.length;
  const table = lcsTable(base, target);

  // On a tie between a delete and an insert, the insert wins: a delete-first
  // tie can eat a common word the equal-length paths disagree about and bury
  // a real change.
  const ops: TokenOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (base[i] === target[j]) {
      ops.push({ kind: "keep", target: j });
      i++;
      j++;
    } else if (table[i * (m + 1) + (j + 1)] >= table[(i + 1) * (m + 1) + j]) {
      ops.push({ kind: "insert", target: j });
      j++;
    } else {
      ops.push({ kind: "delete", base: i });
      i++;
    }
  }
  while (i < n) {
    ops.push({ kind: "delete", base: i });
    i++;
  }
  while (j < m) {
    ops.push({ kind: "insert", target: j });
    j++;
  }
  return ops;
}
