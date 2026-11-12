// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The four crop marks at the corners of the scroll frame, where the page's
// edge would be cut. Decoration only: hidden from assistive technology, and
// they take no pointer, so the prose under them stays pressable.
export function CropMarks() {
  return (
    <div className="crop-frame" aria-hidden="true">
      <i className="crop crop-tl" />
      <i className="crop crop-tr" />
      <i className="crop crop-bl" />
      <i className="crop crop-br" />
    </div>
  );
}
