// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { Fragment, type ReactNode } from "react";

// A translated sentence with elements inside it (a keyword in ink, a name
// the writer typed in `<bdi>`) without handing the locale file any markup:
// each slot is interpolated as a mark, and the text is cut at the marks. The
// words stay in the locale file and the elements stay in React, so nothing a
// writer typed is ever read as markup.

const MARK = "\u0001";

/**
 * `translate(key)` with each of `slots` put where its `{{name}}` sits. A slot
 * the sentence does not use is not drawn; `values` fill the rest as
 * plain text.
 */
export function slotted(
  translate: (key: string, values: Record<string, unknown>) => string,
  key: string,
  slots: Readonly<Record<string, ReactNode>>,
  values: Readonly<Record<string, unknown>> = {},
): ReactNode[] {
  const marks = Object.fromEntries(
    Object.keys(slots).map((name) => [name, `${MARK}${name}${MARK}`]),
  );
  return translate(key, { ...values, ...marks })
    .split(MARK)
    .map((part, index) =>
      // Odd pieces sat between two marks: a slot's name. The writer's text
      // is never interpolated here (it arrives as a slot's child), so it
      // cannot forge a mark.
      index % 2 === 1 && Object.prototype.hasOwnProperty.call(slots, part) ? (
        <Fragment key={index}>{slots[part]}</Fragment>
      ) : (
        part
      ),
    );
}
