// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Release versions, ordered by the rules the desktop's setup page uses
// (`desktop/internal/domain/version.go`), so the app and the desktop program
// never disagree on whether a release is newer.

interface Version {
  core: [number, number, number];
  /** The pre-release's dot-separated identifiers, empty for a release. */
  pre: string[];
}

const NUMBER = /^\d+$/;

function parse(raw: string): Version | null {
  let v = raw.trim().replace(/^v/, "");
  const build = v.indexOf("+");
  if (build >= 0) v = v.slice(0, build);
  let pre: string[] = [];
  const dash = v.indexOf("-");
  if (dash >= 0) {
    if (dash === v.length - 1) return null;
    pre = v.slice(dash + 1).split(".");
    v = v.slice(0, dash);
  }
  const parts = v.split(".");
  if (parts.length !== 3 || !parts.every((p) => NUMBER.test(p))) return null;
  return { core: parts.map(Number) as [number, number, number], pre };
}

/**
 * Orders two pre-releases of one version as Semantic Versioning does: none is
 * above any; otherwise identifier by identifier, numbers by value and below
 * words, which compare as text, and a shorter list below a longer one it
 * begins.
 */
function comparePre(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return b.length - a.length;
  for (let i = 0; i < a.length && i < b.length; i++) {
    const x = NUMBER.test(a[i]);
    const y = NUMBER.test(b[i]);
    if (x && y) {
      const d = Number(a[i]) - Number(b[i]);
      if (d !== 0) return d;
    } else if (x !== y) {
      return x ? -1 : 1;
    } else if (a[i] !== b[i]) {
      return a[i] < b[i] ? -1 : 1;
    }
  }
  return a.length - b.length;
}

/**
 * Whether release tag `latest` is newer than `current`. `known` is false when
 * either is not a `major.minor.patch` version. A pre-release (`1.2.0-rc.1`)
 * sorts below its final release, so a copy running it is told when the
 * release is out.
 */
export function newerRelease(
  latest: string,
  current: string,
): { newer: boolean; known: boolean } {
  const l = parse(latest);
  const c = parse(current);
  if (!l || !c) return { newer: false, known: false };
  for (let i = 0; i < 3; i++)
    if (l.core[i] !== c.core[i])
      return { newer: l.core[i] > c.core[i], known: true };
  return { newer: comparePre(l.pre, c.pre) > 0, known: true };
}

/** The version as a writer reads it: the tag without its `v`. */
export function versionLabel(tag: string): string {
  return tag.trim().replace(/^v/, "");
}
