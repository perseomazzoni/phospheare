// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Loading dots, in the kit rather than the editor: the fallback shown while
// the editor's chunk downloads cannot use a style from the editor's
// stylesheet, which arrives with that chunk.

interface Props {
  /**
   * What is being waited for, for anyone who cannot see the dots. Without
   * one the dots are decoration: a line that already has its own live region
   * elsewhere (the assistant's run line) must not become a second one.
   */
  label?: string;
}

export default function Dots({ label }: Props) {
  return label === undefined ? (
    <span className="ui-dots" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  ) : (
    <span className="ui-dots" role="status" aria-label={label}>
      <i />
      <i />
      <i />
    </span>
  );
}
