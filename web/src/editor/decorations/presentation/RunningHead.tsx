// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { RunningHead as Head } from "../domain/runningHead";

// The page's running head and its folio, as a printed page carries them:
// the book and the Part over the text with the page's number at the right,
// and the number again at the foot. Both repeat what the title bar says, so
// they are hidden from assistive technology. The separator and the folio's
// number stand in elements of their own, for a theme to paint.

export function RunningHead({ head }: { head: Head }) {
  return (
    <header className="ed-runhead" aria-hidden="true">
      <span>
        {head.book}
        {head.part && (
          <>
            <span className="ed-runhead-sep"> · </span>
            <span className="ed-runhead-part">{head.part}</span>
          </>
        )}
      </span>
      {head.folio !== null && <b>{head.folio}</b>}
    </header>
  );
}

export function Folio({ head }: { head: Head }) {
  if (head.folio === null) return null;
  return (
    <footer className="ed-folio" aria-hidden="true">
      <span>{head.folio}</span>
    </footer>
  );
}
