// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// The shared core with the station's scroller, the paper feed and the type
// guide. "Typewriter on" means this view is mounted in place of `ScrollView`,
// never a boolean in the shared component. The arrival dock happens in the
// core's `settleOnMount`.

import { forwardRef, useEffect, useRef } from "react";
import { EditorCore } from "../EditorCore";
import { typewriterScroller } from "./typewriterScroller";
import { feedDepths } from "../../writing/station";
import type { WritingViewHandle, WritingViewProps } from "../port";
import { prosePixels } from "../prosePixels";
import "./typewriter.css";

export const TypewriterView = forwardRef<WritingViewHandle, WritingViewProps>(
  function TypewriterView(props, ref) {
    const surfaceRef = useRef<HTMLDivElement>(null);
    const guideRef = useRef<HTMLDivElement>(null);

    // The paper feed exists only while this view is mounted.
    useEffect(() => {
      const surface = surfaceRef.current;
      if (!surface) return;
      const applyFeeds = () => {
        const { top, bottom } = feedDepths(surface.clientHeight);
        surface.style.setProperty("--feed-top", `${top}px`);
        surface.style.setProperty("--feed-bottom", `${bottom}px`);
      };
      applyFeeds();
      // jsdom has no ResizeObserver.
      const ro =
        typeof ResizeObserver !== "undefined"
          ? new ResizeObserver(applyFeeds)
          : null;
      ro?.observe(surface);
      return () => {
        ro?.disconnect();
        surface.style.removeProperty("--feed-top");
        surface.style.removeProperty("--feed-bottom");
      };
    }, []);

    return (
      <div
        ref={surfaceRef}
        className="editor-surface"
        data-view="typewriter"
        data-desk={props.desk ? "1" : "0"}
        style={
          { "--prose-size": `${prosePixels(props)}px` } as React.CSSProperties
        }
      >
        {props.desk}
        {props.frame?.head}
        <EditorCore
          {...props}
          scroller={typewriterScroller}
          settleOnMount
          guide={{ el: guideRef }}
          ref={ref}
        />
        {props.frame?.foot}
      </div>
    );
  },
);
