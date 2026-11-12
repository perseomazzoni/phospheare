// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import type { SVGProps } from "react";

// The icon set, local rather than a dependency: six glyphs name things only
// this app has.
//
// Every glyph is drawn on a 24 grid with a 1.5 stroke and round joins, and
// uses `currentColor`, so one glyph works on any row or button without
// variants. `bold` and `italic` are letterforms drawn as paths, not `<text>`,
// so they do not change with the interface's font.

export type IconName =
  | "mark"
  | "page"
  | "part"
  | "section"
  | "golden"
  | "disk"
  | "drive"
  | "custody"
  | "info"
  | "plus"
  | "search"
  | "split"
  | "join"
  | "upload"
  | "palette"
  | "gear"
  | "keyboard"
  | "user"
  | "dots"
  | "grid"
  | "rows"
  | "tick"
  | "x"
  | "pencil"
  | "comment"
  | "copy"
  | "out"
  | "down"
  | "chevron"
  | "chevronUp"
  | "move"
  | "driveOff"
  | "diskOff"
  | "trash"
  | "contrast"
  | "lang"
  | "list"
  | "unlist"
  // The editor's formatting set
  | "bold"
  | "italic"
  | "monospace"
  | "normalText"
  | "textSmall"
  | "textMedium"
  | "textLarge"
  | "changeCase"
  | "heading1"
  | "heading2"
  | "body"
  | "pageBreak"
  | "alignLeft"
  | "alignCenter"
  | "alignRight"
  | "alignJustify"
  | "undo"
  | "redo"
  | "save"
  | "spark"
  | "sparkOff"
  | "stop"
  | "pause"
  | "play"
  | "camera"
  | "snapshot"
  | "wholeWord"
  | "backToLibrary"
  | "chevronBack"
  | "at"
  | "alarm"
  | "unsent"
  | "pending"
  | "cloud"
  | "send"
  | "disc"
  | "halfDisc"
  | "ring"
  | "dashedRing";

const PATHS: Record<IconName, React.ReactNode> = {
  // The wordmark.
  mark: (
    <>
      <path d="M12 2.5 L12 21.5" />
      <path
        d="M12 2.5 C16.5 6 18.5 9 18.5 12 C18.5 15.6 15.6 18.5 12 18.5 C8.4 18.5 5.5 15.6 5.5 12 C5.5 9 7.5 6 12 2.5 Z"
        fill="var(--accent)"
        fillOpacity="0.16"
      />
    </>
  ),
  page: (
    <>
      <path d="M6.5 3.5H14l3.5 3.5v13.5h-11Z" />
      <path d="M14 3.5V7h3.5" />
    </>
  ),

  part: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M3.5 9.5 H20.5" />
      <path d="M8 14 H16" />
    </>
  ),

  section: (
    <>
      <path d="M6.5 3.5 H14 L17.5 7 V20.5 H6.5 Z" />
      <path d="M14 3.5 V7 H17.5" />
      <path d="M9.5 12.5 H14.5" />
      <path d="M9.5 16 H13" />
    </>
  ),

  // The Golden Rule: a spine that may branch one way or the other, never both.
  // The filled node is the branch taken; the hollow one is the branch refused.
  golden: (
    <>
      <path d="M12 3.5 V20.5" />
      <path d="M12 8 H18.5" />
      <path d="M12 8 H5.5" />
      <circle cx="19" cy="8" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="5" cy="8" r="1.6" fill="none" />
      <path d="M8.5 14.5 H12" />
      <path d="M8.5 18 H12" />
    </>
  ),

  disk: (
    <>
      <rect x="2.5" y="5.5" width="19" height="13" rx="2" />
      <path d="M7 18.5 V21" />
      <path d="M17 18.5 V21" />
      <path d="M5.5 21 H18.5" />
      <circle cx="18" cy="9" r="1" fill="currentColor" stroke="none" />
    </>
  ),

  // The disk, barred: this device has no live store right now (no root
  // chosen).
  diskOff: (
    <>
      <rect x="2.5" y="5.5" width="19" height="13" rx="2" />
      <path d="M7 18.5 V21" />
      <path d="M17 18.5 V21" />
      <path d="M5.5 21 H18.5" />
      <circle cx="18" cy="9" r="1" fill="currentColor" stroke="none" />
      <path d="M3.5 3.5 L20.5 20.5" />
    </>
  ),

  drive: (
    <>
      <path d="M9.5 3.5 H14.5 L21.5 15.5 H16.5 Z" />
      <path d="M9.5 3.5 L2.5 15.5 L5 20 L12 8 Z" />
      <path d="M5 20 H16.5 L19 15.5 H7.5 Z" />
    </>
  ),

  // The stroke is drawn last so it crosses the plates.
  driveOff: (
    <>
      <path d="M9.5 3.5 H14.5 L21.5 15.5 H16.5 Z" />
      <path d="M9.5 3.5 L2.5 15.5 L5 20 L12 8 Z" />
      <path d="M5 20 H16.5 L19 15.5 H7.5 Z" />
      <path d="M3.5 3.5 L20.5 20.5" />
    </>
  ),

  // Custody: what the app promises about the bytes.
  custody: (
    <>
      <path d="M12 2.5 L20 6 V12 C20 16.5 16.6 20.3 12 21.5 C7.4 20.3 4 16.5 4 12 V6 Z" />
      <path d="M9 12 L11 14 L15.5 9.5" />
    </>
  ),

  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8 v5" />
      <path d="M12 16 h.01" />
    </>
  ),

  plus: (
    <>
      <path d="M12 5 V19" />
      <path d="M5 12 H19" />
    </>
  ),

  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5 L20.5 20.5" />
    </>
  ),

  split: (
    <>
      <circle cx="6" cy="6.5" r="2.75" />
      <circle cx="6" cy="17.5" r="2.75" />
      <path d="M8.2 15.8 L20 5" />
      <path d="M8.2 8.2 L11.4 11.2" />
      <path d="M13.8 13.4 L20 19" />
    </>
  ),

  // Tails are left off and the heads flattened, so the glyph is short enough
  // for the seam's dashes to show above and below it between two beads.
  join: (
    <>
      <path d="M3 12 H21" />
      <path d="M7 5.5 L12 9.5 L17 5.5" />
      <path d="M7 18.5 L12 14.5 L17 18.5" />
    </>
  ),

  palette: (
    <>
      <path d="M12.6 3.3C7.4 3 3.2 6.9 3.2 11.8c0 4.7 3.9 8.5 8.6 8.5 1.2 0 2-.9 1.9-1.9-.1-.9-.8-1.4-.8-2.2 0-1 .8-1.8 1.8-1.8h1.9c2.8 0 5.1-2.3 5.1-5.1 0-3.4-3.6-5.9-9.1-6Z" />
      <circle cx="7.9" cy="9.3" r=".95" />
      <circle cx="12.4" cy="7.6" r=".95" />
      <circle cx="16.6" cy="9.8" r=".95" />
      <circle cx="7.2" cy="14" r=".95" />
    </>
  ),

  gear: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.5 v2.6 M12 18.9 v2.6 M21.5 12 h-2.6 M5.1 12 H2.5 M18.7 5.3 l-1.8 1.8 M7.1 16.9 l-1.8 1.8 M18.7 18.7 l-1.8-1.8 M7.1 7.1 L5.3 5.3" />
    </>
  ),

  keyboard: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <path d="M6 10 h1.5 M9.5 10 h1.5 M13 10 h1.5 M16.5 10 h1.5" />
      <path d="M8 14 H16" />
    </>
  ),

  user: (
    <>
      <circle cx="12" cy="8.5" r="3.8" />
      <path d="M4.5 20.5 c0-3.9 3.4-6.5 7.5-6.5 s7.5 2.6 7.5 6.5" />
    </>
  ),

  dots: (
    <>
      <circle cx="12" cy="5.5" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="18.5" r="1.5" fill="currentColor" stroke="none" />
    </>
  ),

  grid: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </>
  ),

  rows: (
    <>
      <rect x="3.5" y="4.5" width="17" height="4" rx="1.5" />
      <rect x="3.5" y="10" width="17" height="4" rx="1.5" />
      <rect x="3.5" y="15.5" width="17" height="4" rx="1.5" />
    </>
  ),

  tick: <path d="M4.5 12.5 L9.5 17.5 L19.5 6.5" />,

  // A path, not `<text>`. The surround is one arc left open at the lower
  // right, which keeps it an `@`: closed, it reads as a record button.
  at: (
    <>
      <circle cx="12" cy="12" r="3.9" />
      <path d="M15.9 8.1v5.4a3 3 0 0 0 6 0v-1.5a9.9 9.9 0 1 0-3.9 7.86" />
    </>
  ),

  // Never spins: the writer may sit in this state for hours, and nothing
  // loops except a real wait (`base.css`). Not a cloud, a disk or any vendor's
  // mark: the state is about the kind of destination, never which one.
  unsent: (
    <>
      <path d="M5 12 a7 7 0 0 1 11.9 -4.9" />
      <path d="M17 3.5 v3.9 h-3.9" />
      <path d="M19 12 a7 7 0 0 1 -11.9 4.9" />
      <path d="M7 20.5 v-3.9 h3.9" />
    </>
  ),

  // The one alarm in the set, for the save chip's `failed`. A stroke and a
  // point, not a triangle: at 13px a triangle's corners round off into a blob.
  // Shape carries the meaning, not colour.
  alarm: (
    <>
      <path d="M12 4.5 v9" />
      <path d="M12 18 v0.01" />
    </>
  ),

  // A dot with no reading of its own. Not a save glyph, which would picture
  // the button rather than the state.
  pending: <circle cx="12" cy="12" r="5.5" fill="currentColor" stroke="none" />,

  // Degree of fit (Harvey balls): full, half, empty; shape alone carries the
  // degree. Drawn for 12px: the ring's stroke is 3 on the grid so it lands at
  // 1.5px, and the disc fills to the ring's outer edge (7 + 1.5) so the three
  // read as one size.
  disc: <circle cx="12" cy="12" r="8.5" fill="currentColor" stroke="none" />,
  halfDisc: (
    <>
      <circle cx="12" cy="12" r="7" strokeWidth={3} />
      <path
        d="M12 3.5 A8.5 8.5 0 0 1 12 20.5 Z"
        fill="currentColor"
        stroke="none"
      />
    </>
  ),
  ring: <circle cx="12" cy="12" r="7" strokeWidth={3} />,
  // The ring, cut: `/verify`'s "not settled". Four equal dashes and gaps
  // (2πr/8 each), offset by half a dash so the notches sit on the diagonals;
  // more dashes read as a loading spinner, and gaps on the cardinals as a
  // crosshair. The caps must be butt: the wrapper's round cap would narrow
  // every gap toward the plain ring, "implausible". Never a pending mark.
  dashedRing: (
    <circle
      cx="12"
      cy="12"
      r="7"
      strokeWidth={3}
      strokeLinecap="butt"
      strokeDasharray="5.498"
      strokeDashoffset={2.749}
    />
  ),

  // AI side only. Storage refuses a cloud (`unsent`), where it would read as
  // a vendor's sync.
  cloud: (
    <path d="M7 18.5 h10 a4 4 0 0 0 0.6-7.95 A5.5 5.5 0 0 0 6.9 9.6 A4.5 4.5 0 0 0 7 18.5 Z" />
  ),

  send: (
    <>
      <path d="M12 19 V5.5" />
      <path d="M6.5 11 L12 5.5 L17.5 11" />
    </>
  ),

  x: (
    <>
      <path d="M5.5 5.5 L18.5 18.5" />
      <path d="M18.5 5.5 L5.5 18.5" />
    </>
  ),

  pencil: (
    <>
      <path d="M4 20 v-4 L16.5 3.5 l4 4 L8 20 Z" />
      <path d="M14 6 l4 4" />
    </>
  ),

  comment: (
    <>
      <path d="M4.5 5.5 h15 a1 1 0 0 1 1 1 v9 a1 1 0 0 1 -1 1 H10 l-4.5 3.5 V16.5 h-1 a1 1 0 0 1 -1 -1 v-9 a1 1 0 0 1 1 -1 Z" />
      <path d="M8 10 h8" />
      <path d="M8 13 h5" />
    </>
  ),

  copy: (
    <>
      <rect x="8.5" y="8.5" width="12" height="12" rx="2" />
      <path d="M15.5 5.5 h-9 a2 2 0 0 0-2 2 v9" />
    </>
  ),

  out: (
    <>
      <path d="M13.5 4.5 H19.5 V10.5" />
      <path d="M19.5 4.5 L11 13" />
      <path d="M18 14 v4.5 a2 2 0 0 1-2 2 H6 a2 2 0 0 1-2-2 V8 a2 2 0 0 1 2-2 h4.5" />
    </>
  ),

  down: (
    <>
      <path d="M12 4 v11" />
      <path d="M7.5 10.5 L12 15 L16.5 10.5" />
      <path d="M4.5 19.5 H19.5" />
    </>
  ),

  upload: (
    <>
      <path d="M12 15.5 V4.5" />
      <path d="M7.5 9 L12 4.5 L16.5 9" />
      <path d="M4.5 14.5 V18 a1.5 1.5 0 0 0 1.5 1.5 H18 a1.5 1.5 0 0 0 1.5 -1.5 V14.5" />
    </>
  ),

  // Says only which way a thing opens; `down` is the download.
  chevron: <path d="M7 10 L12 15 L17 10" />,
  chevronUp: <path d="M7 14 L12 9 L17 14" />,

  // Not the four-way drag cross: nothing here is dragged, and a glyph
  // promising a gesture the tree does not accept on touch would mislead.
  move: (
    <>
      <path d="M12 4.5 v15" />
      <path d="M8 8.5 L12 4.5 L16 8.5" />
      <path d="M8 15.5 L12 19.5 L16 15.5" />
    </>
  ),

  trash: (
    <>
      <path d="M4.5 6.5 H19.5" />
      <path d="M9.5 6.5 V4.5 h5 v2" />
      <path d="M6.5 6.5 L7.5 20.5 h9 L17.5 6.5" />
    </>
  ),

  contrast: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path
        d="M12 3.5 a8.5 8.5 0 0 0 0 17 Z"
        fill="currentColor"
        stroke="none"
      />
    </>
  ),

  lang: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12 H20.5" />
      <path d="M12 3.5 c2.6 2.6 2.6 14.4 0 17 c-2.6-2.6-2.6-14.4 0-17" />
    </>
  ),

  list: (
    <>
      <path d="M4.5 6.5 H19.5" />
      <path d="M4.5 12 H19.5" />
      <path d="M4.5 17.5 H12" />
    </>
  ),

  unlist: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
      <path d="M8 12 H16" />
    </>
  ),

  // The editor's formatting set.

  // A B with two bowls. Stroked rather than filled, so it sits at the same
  // weight as its neighbours instead of reading as the one heavy glyph.
  bold: (
    <>
      <path d="M7.5 4.5 H13.5 a3.75 3.75 0 0 1 0 7.5 H7.5 Z" />
      <path d="M7.5 12 H14.5 a3.75 3.75 0 0 1 0 7.5 H7.5 Z" />
    </>
  ),

  italic: (
    <>
      <path d="M10 4.5 H17.5" />
      <path d="M6.5 19.5 H14" />
      <path d="M14 4.5 L10 19.5" />
    </>
  ),

  monospace: (
    <>
      <path d="M8.5 6.5 L4 12 l4.5 5.5" />
      <path d="M15.5 6.5 L20 12 l-4.5 5.5" />
      <path d="M13.5 4.5 L10.5 19.5" />
    </>
  ),

  // `alignLeft` minus its short last line.
  normalText: (
    <>
      <path d="M5 6 H19" />
      <path d="M5 12 H19" />
      <path d="M5 18 H19" />
    </>
  ),

  textSmall: (
    <>
      <path d="M9 17 L11.5 9 L14 17" />
      <path d="M9.8 14.5 H13.2" />
    </>
  ),

  textMedium: (
    <>
      <path d="M7.5 18 L12 7 L16.5 18" />
      <path d="M8.8 14.5 H15.2" />
    </>
  ),

  textLarge: (
    <>
      <path d="M6 19 L12 5 L18 19" />
      <path d="M7.8 14 H16.2" />
    </>
  ),

  changeCase: (
    <>
      <path d="M3 19 L7.5 5 L12 19" />
      <path d="M4.6 14.5 H10.4" />
      <path d="M20.5 12.5 a3 3 0 0 0-6 0" />
      <path d="M20.5 12.5 V19" />
      <path d="M20.5 15.5 h-3 a1.9 1.9 0 0 0 0 3.8 h3" />
    </>
  ),

  // One bar for a Title, two for a Subtitle: countable, so it survives a
  // translation where "H1" does not.
  heading1: (
    <>
      <path d="M5 6.5 H19" />
      <path d="M5 12.5 H13" />
      <path d="M5 17.5 H9.5" />
    </>
  ),

  heading2: (
    <>
      <path d="M8 6.5 H19" />
      <path d="M8 12.5 H15" />
      <path d="M8 17.5 H11.5" />
      <path d="M4.5 5 V19" />
    </>
  ),

  body: (
    <>
      <path d="M13 4.5 V19.5" />
      <path d="M17 4.5 V19.5" />
      <path d="M13 4.5 H9.5 a4 4 0 0 0 0 8 H13" />
      <path d="M17 4.5 H13" />
    </>
  ),

  pageBreak: (
    <>
      <path d="M4 5.5 H20" />
      <path d="M4 18.5 H20" />
      <path d="M12 9 V15" />
      <path d="M9.5 12.5 L12 15 l2.5-2.5" />
    </>
  ),

  alignLeft: (
    <>
      <path d="M4 6 H20" />
      <path d="M4 12 H14" />
      <path d="M4 18 H17" />
    </>
  ),

  alignCenter: (
    <>
      <path d="M4 6 H20" />
      <path d="M7 12 H17" />
      <path d="M5.5 18 H18.5" />
    </>
  ),

  alignRight: (
    <>
      <path d="M4 6 H20" />
      <path d="M10 12 H20" />
      <path d="M7 18 H20" />
    </>
  ),

  alignJustify: (
    <>
      <path d="M4 6 H20" />
      <path d="M4 12 H20" />
      <path d="M4 18 H20" />
    </>
  ),

  undo: (
    <>
      <path d="M4 9 H14 a5 5 0 0 1 0 10 H9" />
      <path d="M4 9 L8 5" />
      <path d="M4 9 l4 4" />
    </>
  ),

  redo: (
    <>
      <path d="M20 9 H10 a5 5 0 0 0 0 10 h5" />
      <path d="M20 9 L16 5" />
      <path d="M20 9 l-4 4" />
    </>
  ),

  save: (
    <>
      <path d="M4.5 5.5 a1 1 0 0 1 1-1 H16 l3.5 3.5 V18.5 a1 1 0 0 1-1 1 H5.5 a1 1 0 0 1-1-1 Z" />
      <path d="M8 4.5 V9 h7 V4.5" />
      <path d="M7.5 19.5 V13.5 h9 V19.5" />
    </>
  ),

  // A small second star, because a single one reads as a favourite. The
  // pair's ink is centred in the box (3.5 to 20.5 on both axes), not the big
  // star alone, or beside a word the glyph sits visibly off centre.
  spark: (
    <>
      <path d="M11 2.5 12.8 8.4 18.5 10 12.8 11.6 11 17.5 9.2 11.6 3.5 10 9.2 8.4 Z" />
      <path d="M17.5 15.5 18.2 17.8 20.5 18.5 18.2 19.2 17.5 21.5 16.8 19.2 14.5 18.5 16.8 17.8 Z" />
    </>
  ),

  // The small star is dropped: at 13px a slash across both leaves neither
  // legible.
  sparkOff: (
    <>
      <path d="M12 3.5 13.8 9.4 19.5 11 13.8 12.6 12 18.5 10.2 12.6 4.5 11 10.2 9.4 Z" />
      <path d="M3.5 3.5 L20.5 20.5" />
    </>
  ),

  // Filled, not outlined: at 13px an outlined square reads as an empty
  // checkbox.
  stop: (
    <rect
      x="7.5"
      y="7.5"
      width="9"
      height="9"
      rx="1.6"
      fill="currentColor"
      stroke="none"
    />
  ),

  // Filled for the same reason as `stop`.
  pause: (
    <>
      <rect
        x="7"
        y="6.5"
        width="3.6"
        height="11"
        rx="1.2"
        fill="currentColor"
        stroke="none"
      />
      <rect
        x="13.4"
        y="6.5"
        width="3.6"
        height="11"
        rx="1.2"
        fill="currentColor"
        stroke="none"
      />
    </>
  ),

  play: <path d="M8.5 6.5 L17.5 12 L8.5 17.5 Z" fill="currentColor" />,

  camera: (
    <>
      <rect x="3.5" y="8.5" width="17" height="11.5" rx="2" />
      <path d="M9 8.5 10.2 5.5 h3.6 L15 8.5" />
      <circle cx="12" cy="14" r="3.4" />
    </>
  ),

  // Named `snapshot` so that `history` names the feature, not this drawing.
  // No arrow, so it stays quiet at 16px.
  snapshot: (
    <>
      <circle cx="12" cy="11" r="7.5" />
      <path d="M12 11 V6.5" />
      <path d="M12 11 L8.8 13.1" />
    </>
  ),

  wholeWord: (
    <>
      <path d="M4.5 6 V18" />
      <path d="M19.5 6 V18" />
      <path d="M8.5 12 H15.5" />
    </>
  ),

  backToLibrary: (
    <>
      <path d="M20 12 H4.5" />
      <path d="M9.5 5.5 L4.5 12 L9.5 18.5" />
    </>
  ),
  chevronBack: <path d="M15 4.5 L7.5 12 L15 19.5" />,
};

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  /** Rendered edge length in px. The grid is 24, so anything scales cleanly. */
  size?: number;
  /**
   * What a screen reader calls it. Supply it only where the glyph is the whole
   * control and no visible text says the same.
   */
  title?: string;
}

export function Icon({ name, size = 16, title, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {PATHS[name]}
    </svg>
  );
}

export const ICON_NAMES = Object.keys(PATHS) as IconName[];
