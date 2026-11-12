// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { CSSProperties } from "react";
import { appIcons } from "../../ui/appIcons";
import type { Theme } from "../../theme";
import { Icon } from "../../ui";

/**
 * A theme, drawn as itself: a small screen of the app, painted by the
 * variant's own tokens.
 *
 * The tokens are set on the tile's face as custom properties, so every rule
 * inside it (`var(--ground)`, `var(--grain)`, `var(--glass)`,
 * `var(--shadow-accent)`) resolves to this variant, not to the page's theme.
 * Paper, ink and one accent stripe are not enough: those three are nearly
 * the same in every theme, and two tiles that look alike tell a writer
 * nothing. What tells themes apart is the ground under the page
 * (Matte's tint and grain, Shine's lit points and grid), the frosted or
 * solid glass, and whether the accent glows, and those are tokens too.
 *
 * The screen is laid out at a real size and scaled down (`.tile-screen`),
 * because a ground is drawn in real pixels: Shine's points sit at fixed
 * positions, and a 96px grid drawn at preview size would be a wall of lines.
 * The face carries the tokens and the button does not, so the selection
 * ring stays in the page's own accent.
 */
export default function ThemeTile({
  theme,
  name,
  on,
  onChoose,
}: {
  theme: Theme;
  /** The theme's name: the family's, not the variant's. */
  name: string;
  on: boolean;
  onChoose: () => void;
}) {
  return (
    <button
      type="button"
      className="tile"
      data-on={on ? "1" : "0"}
      aria-pressed={on}
      onClick={onChoose}
    >
      {/* The whole of the theme's tokens, its own with its contract's: a
          contract token may read one of its own (`--f-chrome` reading
          `--f-ui`), which would otherwise resolve to the page's theme. */}
      <span
        className="tile-face"
        style={{ ...theme.own, ...theme.tokens } as CSSProperties}
      >
        <span className="tile-mini" aria-hidden>
          <span className="tile-screen">
            <span className="tile-panel">
              <span className="tile-label" />
              <span className="tile-row" />
              <span className="tile-row" data-on="1" />
              <span className="tile-row" />
              <span className="tile-row" />
              <span className="tile-row" />
            </span>
            <span className="tile-bar">
              <span className="tile-key" />
              <span className="tile-key" data-on="1" />
              <span className="tile-key" />
              <span className="tile-key" />
            </span>
            <span className="tile-page">
              <span className="tile-label" />
              <span className="tile-title" />
              <span className="tile-line" />
              <span className="tile-line" />
              <span className="tile-line" />
              <span className="tile-cta" />
              <span className="tile-spine">
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
              </span>
            </span>
          </span>
        </span>
        <span className="tile-name">
          {name}
          <span className="tile-tick">
            <Icon name={appIcons.confirm} size={14} />
          </span>
        </span>
      </span>
    </button>
  );
}
