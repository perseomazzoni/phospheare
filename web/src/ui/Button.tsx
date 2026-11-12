// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { forwardRef } from "react";
import Dots from "./Dots";

// The kit's one button, so a new theme is kept in step in one place. The
// toolbar's formatting buttons and the search card's toggles are not here:
// they carry active state, an `aria-pressed` contract and tooltip behaviour a
// generic `Button` would have to grow to hold.

export type ButtonVariant =
  | "primary"
  | "outline"
  | "ghost"
  | "attention"
  | "soft"
  | "danger"
  | "quiet"
  | "link"
  | "icon";

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * The web application's, at 36px: `primary` (an ink fill, never the accent,
   * which is light in this design and never paint), `outline` for the second
   * action beside a first, `ghost` for the third and the one in a bar, and
   * `attention`, the one remedy of an attention state, paired with
   * `ui-btn-sm` inside a `Banner tone="attention"`.
   *
   * The editor's, at 27px, the size the tree panel is built around: `soft`
   * for a panel state's one action, `danger` for what cannot be taken back,
   * then `quiet`, `link` and `icon`.
   */
  variant?: ButtonVariant;
  block?: boolean;
  /**
   * Working: the dialog confirm's busy face, dots over the label in one grid
   * cell, so the button keeps its size and its accessible name.
   */
  loading?: boolean;
}

const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  {
    variant = "quiet",
    block = false,
    loading = false,
    className,
    type = "button",
    children,
    ...rest
  },
  ref,
) {
  const classes = [
    "ui-btn",
    `ui-btn-${variant}`,
    block ? "ui-btn-block" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      ref={ref}
      type={type}
      className={classes}
      aria-busy={loading || undefined}
      data-loading={loading ? "1" : undefined}
      {...rest}
    >
      {loading ? (
        <span className="ui-btn-load">
          <span className="ui-btn-load-label">{children}</span>
          <span className="ui-btn-load-dots" aria-hidden>
            <Dots />
          </span>
        </span>
      ) : (
        children
      )}
    </button>
  );
});

export default Button;
