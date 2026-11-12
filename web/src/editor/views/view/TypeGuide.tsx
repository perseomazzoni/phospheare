// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { ViewHost } from "./port";

// The type guide: two inward chevrons flanking the station. It carries
// nothing optional and has no Return control: a writer scrolled away types
// their way back.
//
// `EditorCore` writes `data-state` and `style.top` imperatively from its
// measure loop, never through props, because the state changes on every
// caret move. The horizontal position is pinned to the measure's edges, never
// the ragged text edge, which would move a finger on every keystroke.

export default function TypeGuide({
  guideRef,
  mark,
}: {
  guideRef: React.RefObject<HTMLDivElement | null>;
  /** The host's glyph for the two fingers. */
  mark: ViewHost["guideMark"];
}) {
  return (
    <div ref={guideRef} className="type-guide" data-state="rest" hidden>
      {mark("type-guide-finger type-guide-finger-left")}
      {mark("type-guide-finger type-guide-finger-right")}
    </div>
  );
}
