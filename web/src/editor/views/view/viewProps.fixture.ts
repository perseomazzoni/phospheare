// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

// Shared props for the view contract and the adapter suites. Each needs a
// plausible `WritingViewProps` for a fresh engine; one builder and one default
// search and selection state keep the suites from drifting apart on what a
// default view session looks like. The host is the app's own: the Trusted
// Types sink and the kit's chevron, on a desktop with no keyboard up.

import { setInnerHtml } from "../../../security/trustedHtml";
import { guideMark } from "../../viewHost";
import { EditorEngine } from "../engine";
import type {
  ViewHost,
  ViewSearchState,
  ViewSelectionState,
  WritingViewProps,
} from "./port";

export const testHost: ViewHost = {
  phone: false,
  keyboardInset: 0,
  setHtml: setInnerHtml,
  guideMark,
};

export const searched: ViewSearchState = {
  query: null,
  currentIndex: 0,
  caseSensitive: false,
  wholeWord: false,
  hyphensJoinWords: false,
};

export const selectionBase: ViewSelectionState = {
  text: null,
  exactText: null,
  showRepetitions: true,
};

export function propsFor(
  engine: EditorEngine,
  extra: Partial<WritingViewProps> = {},
): WritingViewProps {
  return {
    engine,
    host: testHost,
    proseSize: 19,
    focus: "off",
    smoothCaret: false,
    search: searched,
    selection: selectionBase,
    searchOpen: false,
    ...extra,
  };
}
