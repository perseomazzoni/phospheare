// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useTranslation } from "react-i18next";

import Dots from "./Dots";

// The editor, arriving: the wait for the editor's chunk, in the shape of what
// is being waited for.
//
// The frame is there when the chunk lands and only the content fills in: the
// panel down the left carries the tree's waiting voice (the three dots), and
// the measure in the middle stands in for the prose. The command bar has no
// stand-in, because an empty bar reads as a broken one; it renders once the
// editor exists.
//
// It lives in `ui/` because a stylesheet shipped with the editor cannot dress
// the wait for its own arrival. The numbers are repeated here because
// `--panel-w` and its siblings arrive with that same chunk.

/** One paragraph's worth of ragged line lengths, as percentages. */
const LINES = [92, 100, 84, 96, 70];

export default function EditorSkeleton() {
  const { t } = useTranslation();
  return (
    <div className="ed-skeleton">
      <div className="ed-skeleton-panel">
        {/* The one announcement: the dots say what the frame cannot. */}
        <Dots label={t("app.loading")} />
      </div>
      <div className="ed-skeleton-measure" aria-hidden="true">
        {/* Uneven: a stack of identical bars reads as a table, and prose has
            a ragged right edge. */}
        {LINES.map((width, i) => (
          <span
            key={i}
            className="ui-skeleton"
            style={{ width: `${width}%` }}
          />
        ))}
      </div>
    </div>
  );
}
