// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useTranslation } from "react-i18next";
import { anyCounted, type CommentCounts } from "../domain/counts";
import { inkOn, type PersonaFace } from "./faces";

// A chapter's comments, counted on its row (`countsOf`). One filled circle
// per persona, in the persona's own colour, holds only the number, because
// the colour is the name. One clear circle counts everyone else's threads. A
// thread by a persona that is not installed has no colour to use, so it is
// counted in the clear circle rather than drawn in a colour that names
// nobody.
//
// The circles are one image to a screen reader, whose label says what the
// colours say to the eye: who, and how many.

export default function CommentBubbles({
  counts,
  personas,
}: {
  counts: CommentCounts;
  personas: readonly PersonaFace[];
}) {
  const { t } = useTranslation();
  if (!anyCounted(counts)) return null;
  // In the personas' own order, so a row's circles never reshuffle as
  // threads come and go.
  const known = personas.filter((p) => (counts.personas[p.id] ?? 0) > 0);
  const unknown = Object.entries(counts.personas)
    .filter(([id]) => !personas.some((p) => p.id === id))
    .reduce((sum, [, n]) => sum + n, 0);
  const others = counts.others + unknown;

  const label = [
    ...known.map((p) =>
      t("comments.countBy", { count: counts.personas[p.id], name: p.name }),
    ),
    ...(others > 0 ? [t("comments.countOthers", { count: others })] : []),
  ].join(", ");

  return (
    <span
      className="cm-bubbles"
      role="img"
      aria-label={t("comments.countLabel", { list: label })}
    >
      {known.map((p) => (
        <span
          key={p.id}
          className="cm-bubble"
          style={{ background: p.color, color: inkOn(p.color) }}
          aria-hidden
        >
          {counts.personas[p.id]}
        </span>
      ))}
      {others > 0 && (
        <span className="cm-bubble cm-bubble-others" aria-hidden>
          {others}
        </span>
      )}
    </span>
  );
}
