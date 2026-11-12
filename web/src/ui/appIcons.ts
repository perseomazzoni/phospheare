// Copyright (C) 2026 Perseo Mazzoni
// SPDX-License-Identifier: AGPL-3.0-or-later
// Free software under the GNU Affero General Public License, version 3 or
// later; the full text is in `LICENSE`.

import { type IconName } from "./icons";

/** The app's icon registry: a key names a command, its value the glyph. */
export const appIcons = {
  local: "disk" as IconName,
  localOff: "diskOff" as IconName,
  /**
   * Reached over the network rather than on this machine. The key names the
   * kind, never the backend; the glyph is a cloud because it marks remote
   * models only, where model pickers draw one.
   */
  remote: "cloud" as IconName,
  send: "send" as IconName,
  drive: "drive" as IconName,
  driveOff: "driveOff" as IconName,
  about: "info" as IconName,
  part: "part" as IconName,
  section: "section" as IconName,
  structure: "golden" as IconName,
  search: "search" as IconName,
  // Must not share the magnifier with `search`: the palette is not a search.
  palette: "palette" as IconName,
  close: "x" as IconName,
  menu: "dots" as IconName,
  back: "out" as IconName,
  // Only for a link that leaves the app in a new tab; a row that opens inside
  // the app draws no glyph.
  external: "out" as IconName,
  expand: "chevron" as IconName,
  add: "plus" as IconName,
  // Not the down arrow, which reads as download.
  importFile: "upload" as IconName,
  edit: "pencil" as IconName,
  comment: "comment" as IconName,
  previousComment: "chevronUp" as IconName,
  nextComment: "chevron" as IconName,
  move: "move" as IconName,
  copy: "copy" as IconName,
  delete: "trash" as IconName,
  confirm: "tick" as IconName,
  // The only alarm the app draws.
  alarm: "alarm" as IconName,

  pending: "pending" as IconName,
  // Queued for the remote; drawn static, and it names no destination.
  unsent: "unsent" as IconName,
  look: "contrast" as IconName,
  words: "custody" as IconName,
  info: "info" as IconName,
  account: "user" as IconName,
  settings: "gear" as IconName,
  shortcuts: "keyboard" as IconName,
  grid: "grid" as IconName,
  list: "rows" as IconName,
  unlist: "unlist" as IconName,

  bold: "bold" as IconName,
  italic: "italic" as IconName,
  monospace: "monospace" as IconName,
  normalText: "normalText" as IconName,
  textSmall: "textSmall" as IconName,
  textMedium: "textMedium" as IconName,
  textLarge: "textLarge" as IconName,
  changeCase: "changeCase" as IconName,
  title: "heading1" as IconName,
  subtitle: "heading2" as IconName,
  body: "body" as IconName,
  pageBreak: "pageBreak" as IconName,
  alignLeft: "alignLeft" as IconName,
  alignCenter: "alignCenter" as IconName,
  alignRight: "alignRight" as IconName,
  alignJustify: "alignJustify" as IconName,
  undo: "undo" as IconName,
  redo: "redo" as IconName,
  save: "save" as IconName,
  export: "down" as IconName,
  assistant: "spark" as IconName,
  assistantOff: "sparkOff" as IconName,
  stop: "stop" as IconName,
  pauseMotion: "pause" as IconName,
  playMotion: "play" as IconName,
  context: "at" as IconName,
  // The clock glyph is named `snapshot` in the set, so `history` points at it
  // and `snapshot` draws the camera.
  snapshot: "camera" as IconName,
  history: "snapshot" as IconName,
  wholeWord: "wholeWord" as IconName,
  backToLibrary: "backToLibrary" as IconName,
  backToLibraryBare: "chevronBack" as IconName,
  fitFull: "disc" as IconName,
  fitPartly: "halfDisc" as IconName,
  fitNone: "ring" as IconName,
  // A cut ring for "can't tell", so it never reads as "implausible" by colour
  // alone.
  verdictPlausible: "disc" as IconName,
  verdictDoubtful: "halfDisc" as IconName,
  verdictImplausible: "ring" as IconName,
  verdictUnsettled: "dashedRing" as IconName,
} as const;
