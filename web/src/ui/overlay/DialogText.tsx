// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// A dialog's explanation as a sentence, the things it is about and what
// follows from them. A consequence that names four things reads at a glance
// as a list and not at all as a clause of four commas, so the things are
// list items and every sentence stays short.

export interface DialogTextProps {
  /** The element the dialog names in `aria-describedby`. */
  id?: string;
  /** The sentence the list completes, ending in a colon when one follows. */
  lead: string;
  items?: readonly string[];
  /** Sentences after the list, each its own paragraph. */
  after?: readonly string[];
}

export default function DialogText({
  id,
  lead,
  items = [],
  after = [],
}: DialogTextProps) {
  return (
    <div id={id} className="ui-alert-body">
      <p>{lead}</p>
      {items.length > 0 && (
        <ul className="ui-alert-list">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
      {after.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>
  );
}
