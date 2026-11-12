// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { CSSProperties } from "react";
import type { SpineRules as Rules } from "../domain/spineRules";

// The spine's rules: the Parts' numbers over their columns, each column's
// Sections as ink rules with the room left as a leader after them, and the
// Parts' words under them. One image to assistive technology, described as
// the spine describes itself.

const pct = (share: number) => `${share * 100}%`;

export default function SpineRules({
  rules,
  title,
}: {
  rules: Rules;
  /** Names the book, for the description a screen reader is given. */
  title?: string;
}) {
  // Each Part's column takes its share of the whole, as the spine's do, but
  // never less than 32px, the width of the widest count ("84.1k"), so a
  // short Part's number and count do not run into its neighbour's.
  const columns: CSSProperties = {
    gridTemplateColumns: rules.parts
      .map((part) => `minmax(32px, ${part.share}fr)`)
      .join(" "),
  };
  return (
    <div
      className="spine-rules"
      role="img"
      aria-label={title ? `${title}: ${rules.description}` : rules.description}
    >
      <div className="sr-nums" style={columns} aria-hidden="true">
        {rules.parts.map((part) => (
          <span key={part.nodeId} data-current={part.current ? "1" : undefined}>
            {part.label}
          </span>
        ))}
      </div>
      <div className="sr-parts" style={columns} aria-hidden="true">
        {rules.parts.map((part) => (
          <div key={part.nodeId} className="sr-part" title={part.title}>
            {part.rules.map((rule) => (
              <i
                key={rule.nodeId}
                className="sr-rule"
                data-empty={rule.empty ? "1" : undefined}
                data-mark={rule.mark ?? undefined}
                title={`${rule.title} — ${rule.words.toLocaleString()}`}
                style={{ flexBasis: pct(rule.share), opacity: rule.ink }}
              />
            ))}
            {part.room > 0 && <i className="sr-room" />}
          </div>
        ))}
      </div>
      <div className="sr-counts" style={columns} aria-hidden="true">
        {rules.parts.map((part) => (
          <span key={part.nodeId}>{part.count}</span>
        ))}
      </div>
    </div>
  );
}
