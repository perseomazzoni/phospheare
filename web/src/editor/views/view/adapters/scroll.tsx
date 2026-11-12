// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The default view: the shared core with the keep-in-band strategy. Each view
// owns its surface element, so `data-view` and the prose size are set here
// and the core never learns which view it is in.

import { forwardRef } from "react";
import { EditorCore } from "../EditorCore";
import { keepInView } from "../scrollStrategy";
import type { WritingViewHandle, WritingViewProps } from "../port";
import { prosePixels } from "../prosePixels";

export const ScrollView = forwardRef<WritingViewHandle, WritingViewProps>(
  function ScrollView(props, ref) {
    return (
      <div
        className="editor-surface"
        data-view="scroll"
        data-desk={props.desk ? "1" : "0"}
        style={
          { "--prose-size": `${prosePixels(props)}px` } as React.CSSProperties
        }
      >
        {props.desk}
        {props.frame?.head}
        <EditorCore {...props} scroller={keepInView} ref={ref} />
        {props.frame?.foot}
      </div>
    );
  },
);
