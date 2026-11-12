// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { useTheme } from "../../../theme";
import shots from "./shots.json";
import { shown, useInView } from "./useInView";

/** A screen the landing pictures (`scripts/shots/surfaces.ts`). */
export type ShotId = keyof typeof shots.surfaces;

/** The rig's device pixel ratio (`DPR` in `scripts/shots/surfaces.ts`). */
const DPR = 2;

interface ShotProps {
  id: ShotId;
  /** What the picture shows, for a visitor who cannot see it. */
  alt: string;
  className?: string;
  /** On screen when the page opens, so it loads at once, not lazily. */
  priority?: boolean;
}

/**
 * A screenshot in the theme the visitor uses, named
 * `<family>-<variant>-<surface>.webp`, so a theme switch swaps the picture
 * with the page. A surface the page shows in part is captured as that part
 * alone (`crop` in `scripts/shots/surfaces.ts`). Its shape is set before it
 * loads, so nothing below it moves, and it lights up when the visitor
 * reaches it. It is never drawn larger than the app draws it: a small window
 * blown up past that reads as a magnifier.
 */
export default function Shot({
  id,
  alt,
  className,
  priority = false,
}: ShotProps) {
  const { theme } = useTheme();
  const [ref, seen] = useInView<HTMLElement>();
  const { width, height } = shots.surfaces[id];
  return (
    <figure
      ref={ref}
      className={["landing-shot", className].filter(Boolean).join(" ")}
      style={{ maxWidth: `${width / DPR}px` }}
      {...shown(seen)}
    >
      <img
        src={`/landing/${theme.id}-${id}.webp`}
        width={width}
        height={height}
        alt={alt}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : undefined}
        decoding="async"
      />
    </figure>
  );
}
